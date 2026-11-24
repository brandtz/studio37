// POST /api/auth/login
// Body: { email, password }
// Responses:
//   200 { token, user } — session token issued
//   401 { error: 'invalid_credentials' }
//   403 { error: 'pending' | 'disabled' }

import { json, userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';
import { signSession, verifyPassword, authJson } from './_lib/auth.mjs';
import { checkRateLimit, clientIp } from './_lib/rate-limit.mjs';

async function handle(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Per-IP rate limit: 5 attempts / minute. Blunts password brute force.
  const ip = clientIp(req);
  const ipRl = await checkRateLimit({ key: `login:ip:${ip}`, limit: 5, windowMs: 60_000 });
  if (!ipRl.allowed) {
    return json(
      { error: 'too_many_attempts', message: 'Too many attempts. Try again in a minute.', retry_after: ipRl.retryAfterSec },
      429,
      { 'retry-after': String(ipRl.retryAfterSec) },
    );
  }

  await ensureUserSeeded();

  const body = await req.json().catch(() => null);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email) return json({ error: 'email_required' }, 400);
  if (!password) return json({ error: 'password_required', message: 'Password is required.' }, 400);

  // Per-email rate limit: 10 attempts / 10 minutes. Stops slow distributed guessing.
  const emailRl = await checkRateLimit({ key: `login:email:${email}`, limit: 10, windowMs: 10 * 60_000 });
  if (!emailRl.allowed) {
    return json(
      { error: 'too_many_attempts', message: 'Account temporarily locked. Try again later.', retry_after: emailRl.retryAfterSec },
      429,
      { 'retry-after': String(emailRl.retryAfterSec) },
    );
  }

  const store = userStore();
  const user = await store.get(email, { type: 'json' });

  // Generic 401 for unknown users (avoid email enumeration).
  if (!user) return json({ error: 'invalid_credentials' }, 401);

  if (user.status === 'pending') {
    return json({ error: 'pending', message: 'Account pending approval.' }, 403);
  }
  if (user.status === 'disabled') {
    return json({ error: 'disabled', message: 'Account disabled.' }, 403);
  }
  if (user.status !== 'approved') {
    return json({ error: 'invalid_credentials' }, 401);
  }

  // Knowing an email (or submitting any password) is not proof of inbox ownership.
  if (!user.passwordSet || !user.passwordHash) return json({ error: 'invalid_credentials' }, 401);

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return json({ error: 'invalid_credentials' }, 401);

  // Do not issue using a password/status snapshot changed while bcrypt ran.
  const fresh = await store.get(email, { type: 'json' });
  if (!fresh || fresh.status !== 'approved' || !fresh.passwordSet
      || fresh.passwordHash !== user.passwordHash || fresh.authVersion !== user.authVersion) {
    return authJson({ error: 'invalid_credentials' }, 401);
  }
  const token = await signSession(fresh);
  await store.setJSON(email, { ...fresh, last_login: nowIso() });
  return authJson({
    token,
    user: { email: user.email, role: user.role },
  });
}

export default async (req) => {
  try {
    return await handle(req);
  } catch {
    console.error('[auth] login failed');
    return authJson({ error: 'login_unavailable', message: 'Sign-in is unavailable. Try again later or contact the site owner.' }, 503);
  }
};

export const config = { path: '/.netlify/functions/auth-login' };
