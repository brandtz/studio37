// Auth helpers — JWT session tokens (jose) + bcryptjs password hashing.
// Tokens are passed via Authorization: Bearer <token> from the admin SPA.

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { json, userStore, ensureUserSeeded, nowIso } from './store.mjs';

const SESSION_TTL = '7d';
const SETUP_TTL = '15m';
const ISSUER = 'studio37';
const AUD_SESSION = 'studio37-session';
const AUD_SETUP = 'studio37-setup';

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET env var missing or too short (need 16+ chars).');
  }
  return new TextEncoder().encode(s);
}

export async function signSession(user) {
  return await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUD_SESSION)
    .setExpirationTime(SESSION_TTL)
    .sign(getSecret());
}

export async function signSetupToken(email) {
  return await new SignJWT({ email, purpose: 'setup' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUD_SETUP)
    .setExpirationTime(SETUP_TTL)
    .sign(getSecret());
}

export async function verifySetupToken(token) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUD_SETUP,
    });
    if (payload.purpose !== 'setup') return null;
    return payload;
  } catch {
    return null;
  }
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
    });
    payload = v.payload;
  } catch {
    return { error: json({ error: 'unauthorized' }, 401) };
  }

  await ensureUserSeeded();
  const store = userStore();
  const user = await store.get(String(payload.email).toLowerCase(), { type: 'json' });
  if (!user || user.status !== 'approved') {
    return { error: json({ error: 'unauthorized' }, 401) };
  }
  return { user };
}

/**
 * Higher-order helper used by admin-* functions.
 * Returns Response on failure or { user } on success.
 * Falls back to legacy ADMIN_KEY header for transition (only if LEGACY_ADMIN_KEY_FALLBACK !== 'off').
 */
export async function requireSession(req, { minRole = 'admin' } = {}) {
  const { user, error } = await getSession(req);
  if (user) {
    if (minRole === 'super' && user.role !== 'super') {
      return { error: json({ error: 'forbidden' }, 403) };
    }
    return { user };
  }

  // Legacy fallback: X-Admin-Key matches ADMIN_KEY env var.
  if (process.env.LEGACY_ADMIN_KEY_FALLBACK !== 'off') {
    const expected = process.env.ADMIN_KEY;
    const got = req.headers.get('x-admin-key');
    if (expected && got === expected) {
      return { user: { email: 'legacy-admin', role: 'super', status: 'approved' } };
    }
  }
  return { error };
}

export { nowIso };
