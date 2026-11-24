// Auth helpers — JWT session tokens (jose) + bcryptjs password hashing.
// Tokens are passed via Authorization: Bearer <token> from the admin SPA.

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { json, userStore, ensureUserSeeded, nowIso } from './store.mjs';

const SESSION_TTL = '9h'; // Matches 8hr client hard-expiry with buffer; see SEC-03
const SETUP_TTL = '15m';
const ISSUER = 'studio37';
// Legacy session JWTs have no revocation binding and are rejected at rollout.
const AUD_SESSION = 'studio37-session-v3';
// A new audience invalidates every setup JWT issued by the old login flow.
const AUD_SETUP = 'studio37-email-setup-v2';

// Operational limits: Blobs v8 provides no compare-and-swap/transaction. Rate
// buckets, link rotation/consumption, and user writes can race across instances;
// rechecks below reduce, but cannot eliminate, concurrent replay/status overwrite.
// Revoked account epochs are immutable tombstones: stale user writes cannot
// resurrect a revoked epoch. Do not delete these records while restoring users.
// Revocation precedes account writes and fails closed; a failed write may leave
// the old account epoch unusable until an administrator retries the mutation.
// Concurrent account mutations still need transactions to prevent lost updates.
// Previously compromised passwords require operator reset, not just JWT revocation.
const digest = (value) => createHash('sha256').update(value).digest('hex');
const setupStore = () => getStore({ name: 'auth_password_setup_v2', consistency: 'strong' });
const setupKey = (email) => `account/${digest(email)}`;
const userState = (user) => digest(JSON.stringify(user));
const keyedDigest = (value) => createHmac('sha256', getSecret()).update(JSON.stringify(value)).digest('hex');
const accountEpoch = (user) => keyedDigest([user.email, user.authVersion || 'legacy-v3']);
const sessionContext = (user) => keyedDigest([
  accountEpoch(user), user.passwordHash, user.passwordSet, user.role, user.status,
]);
export const newAuthVersion = () => randomBytes(32).toString('base64url');

async function epochRevoked(epoch) {
  return !!await setupStore().get(`revoked-account/${epoch}`, { type: 'json' });
}

export async function revokeUserTokens(user) {
  // Append-only revocations are separate from last-write-wins user snapshots.
  await setupStore().setJSON(`revoked-account/${accountEpoch(user)}`, { revokedAt: nowIso() });
  return newAuthVersion();
}

export async function revokeSession(session) {
  await setupStore().setJSON(`revoked-session/${session.jti}`, { expiresAt: session.exp * 1000 });
}
export const needsPasswordSetup = (user) =>
  !!user && user.status === 'approved' && !user.passwordHash && !user.passwordSet;

export const authJson = (body, status = 200, headers = {}) =>
  json(body, status, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers });

// Unlike the general-purpose limiter, setup must fail closed on storage errors.
// Blobs v8 has no conditional writes: concurrent requests can exceed this limit.
export async function checkSetupRateLimit({ key, limit, windowMs }) {
  const store = setupStore();
  const storageKey = `rate/${digest(key)}`;
  const now = Date.now();
  let bucket = await store.get(storageKey, { type: 'json' });
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { count: 0, windowStart: now };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)) };
  }
  await store.setJSON(storageKey, { ...bucket, count: bucket.count + 1 });
  return { allowed: true };
}

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET env var missing or too short (need 16+ chars).');
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user) {
  if (user.status !== 'approved' || !user.passwordHash || !user.passwordSet
      || await epochRevoked(accountEpoch(user))) throw new Error('Account not eligible for session');
  return await new SignJWT({
    email: user.email, role: user.role, epoch: accountEpoch(user), ctx: sessionContext(user),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(newAuthVersion())
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUD_SESSION)
    .setExpirationTime(SESSION_TTL)
    .sign(getSecret());
}

// Only the email-request endpoint may call this; never return its result to a client.
// The digest lives in a separate store, not the user record exposed by admin/users.
export async function signSetupToken(user) {
  if (!needsPasswordSetup(user) || await epochRevoked(accountEpoch(user))) throw new Error('Account not eligible for setup');
  const email = user.email.toLowerCase();
  const token = await new SignJWT({ email, purpose: 'email-setup-v2', epoch: accountEpoch(user) })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomBytes(32).toString('base64url'))
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUD_SETUP)
    .setExpirationTime(SETUP_TTL)
    .sign(getSecret());
  await setupStore().setJSON(setupKey(email), {
    digest: digest(token), userState: userState(user), expiresAt: Date.now() + 15 * 60_000,
  });
  return token;
}

export async function verifySetupToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUD_SETUP,
      algorithms: ['HS256'],
      requiredClaims: ['exp', 'iat', 'jti', 'email', 'epoch'],
      maxTokenAge: '15m',
    }));
  } catch {
    return null;
  }
  if (payload.purpose !== 'email-setup-v2' || typeof payload.email !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)
      || !/^[a-f0-9]{64}$/.test(payload.epoch) || await epochRevoked(payload.epoch)) return null;
  const record = await setupStore().get(setupKey(payload.email), { type: 'json' });
  if (!record || record.expiresAt <= Date.now() || typeof record.digest !== 'string'
      || record.digest.length !== 64
      || !timingSafeEqual(Buffer.from(record.digest), Buffer.from(digest(token)))) return null;
  return { email: payload.email, epoch: payload.epoch, userState: record.userState };
}

export function matchesSetupUser(user, payload) {
  return needsPasswordSetup(user) && user.email === payload.email
    && accountEpoch(user) === payload.epoch
    && userState(user) === payload.userState;
}

export async function consumeSetupToken(token, payload) {
  // Recheck immediately before deleting. Sequential replays and older links fail.
  // This is not an atomic claim: separate server instances can race (Blobs v8).
  const current = await verifySetupToken(token);
  if (!current || current.userState !== payload.userState) return false;
  await setupStore().delete(setupKey(payload.email));
  return true;
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

function getBearer(req) {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

/**
 * Verify the current request's session.
 * @returns {Promise<{user, error}>} user on success; error Response on failure
 */
export async function getSession(req) {
  const token = getBearer(req);
  if (!token) return { error: json({ error: 'unauthorized' }, 401) };
  let payload;
  try {
    const v = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUD_SESSION,
      algorithms: ['HS256'],
      requiredClaims: ['email', 'exp', 'iat', 'epoch', 'ctx', 'jti'],
    });
    payload = v.payload;
    if (typeof payload.email !== 'string' || payload.email !== payload.email.toLowerCase()
        || !/^[a-f0-9]{64}$/.test(payload.epoch) || !/^[a-f0-9]{64}$/.test(payload.ctx)
        || !/^[A-Za-z0-9_-]{43}$/.test(payload.jti)) throw new Error('Invalid session claims');
  } catch {
    return { error: json({ error: 'unauthorized' }, 401) };
  }

  try {
    await ensureUserSeeded();
    const store = userStore();
    const user = await store.get(payload.email, { type: 'json' });
    if (!user || user.status !== 'approved' || !user.passwordHash || !user.passwordSet
        || payload.epoch !== accountEpoch(user) || payload.ctx !== sessionContext(user)
        || await epochRevoked(payload.epoch)
        || await setupStore().get(`revoked-session/${payload.jti}`, { type: 'json' })) {
      return { error: authJson({ error: 'unauthorized' }, 401) };
    }
    return { user, session: payload };
  } catch {
    console.error('[auth] session storage unavailable');
    return { error: authJson({ error: 'auth_unavailable' }, 503) };
  }
}

/**
 * Higher-order helper used by admin-* functions.
 * Returns Response on failure or { user } on success.
 */
export async function requireSession(req, { minRole = 'admin' } = {}) {
  const { user, error } = await getSession(req);
  if (user) {
    if (minRole === 'super' && user.role !== 'super') {
      return { error: json({ error: 'forbidden' }, 403) };
    }
    return { user };
  }
  return { error };
}

export { nowIso };
