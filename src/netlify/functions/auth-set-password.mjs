// POST /api/auth/set-password
// Body: { setupToken, password }
// Accepts only new email-delivered, short-lived setup tokens; old login tokens fail.

import { userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';
import { authJson, verifySetupToken, hashPassword, signSession, matchesSetupUser, consumeSetupToken, checkSetupRateLimit, revokeUserTokens } from './_lib/auth.mjs';
import { clientIp } from './_lib/rate-limit.mjs';

export default async (req) => {
  if (req.method !== 'POST') return authJson({ error: 'method_not_allowed' }, 405);

  try {
    const limit = await checkSetupRateLimit({ key: `redeem:ip:${clientIp(req)}`, limit: 10, windowMs: 60_000 });
    if (!limit.allowed) return authJson({ error: 'too_many_attempts', message: 'Too many attempts. Try again later.' }, 429,
      { 'retry-after': String(limit.retryAfterSec) });
    await ensureUserSeeded();

    const body = await req.json().catch(() => null);
    const setupToken = String(body?.setupToken || '');
    const password = String(body?.password || '');

    if (!setupToken) return authJson({ error: 'setup_token_required' }, 400);
    if (password.length < 8) return authJson({ error: 'password_too_short', message: 'Use at least 8 characters.' }, 400);
    if (Buffer.byteLength(password, 'utf8') > 72) return authJson({ error: 'password_too_long', message: 'Use at most 72 UTF-8 bytes.' }, 400);

    const payload = await verifySetupToken(setupToken);
    if (!payload?.email) return authJson({ error: 'invalid_or_expired_token' }, 401);

    const email = String(payload.email).toLowerCase();
    const store = userStore();
    let user = await store.get(email, { type: 'json' });
    if (!matchesSetupUser(user, payload)) return authJson({ error: 'invalid_or_expired_token' }, 401);

    const hash = await hashPassword(password);
    if (!await consumeSetupToken(setupToken, payload)) return authJson({ error: 'invalid_or_expired_token' }, 401);
    // Re-read after bcrypt and consumption so a disable/reset/change during hashing
    // cannot be overwritten from the earlier snapshot. This is still not a CAS.
    user = await store.get(email, { type: 'json' });
    if (!matchesSetupUser(user, payload)) return authJson({ error: 'invalid_or_expired_token' }, 401);
    const updated = {
      ...user,
      authVersion: await revokeUserTokens(user),
      passwordHash: hash,
      passwordSet: true,
      last_login: nowIso(),
    };
    await store.setJSON(email, updated);

    const fresh = await store.get(email, { type: 'json' });
    if (!fresh || fresh.status !== 'approved' || fresh.passwordHash !== hash) {
      return authJson({ error: 'invalid_or_expired_token' }, 401);
    }
    const token = await signSession(fresh);
    return authJson({ token, user: { email: fresh.email, role: fresh.role } });
  } catch {
    console.error('[auth] password setup failed');
    return authJson({ error: 'setup_unavailable', message: 'Could not complete setup. Try signing in; if setup is still needed, contact the site owner to reset your account.' }, 503);
  }
};

export const config = { path: '/.netlify/functions/auth-set-password' };
