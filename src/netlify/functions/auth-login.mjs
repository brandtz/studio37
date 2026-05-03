// POST /api/auth/login
// Body: { email, password }
// Responses:
//   200 { firstLogin: true, setupToken } — user must set a password
//   200 { token, user } — session token issued
//   401 { error: 'invalid_credentials' }
//   403 { error: 'pending' | 'disabled' }

import { json, userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';
import { signSession, signSetupToken, verifyPassword } from './_lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  await ensureUserSeeded();

  const body = await req.json().catch(() => null);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!email) return json({ error: 'email_required' }, 400);

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

  // First-login flow: user is approved but has not set a password yet.
  if (!user.passwordSet || !user.passwordHash) {
    const setupToken = await signSetupToken(email);
    return json({ firstLogin: true, setupToken, email });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return json({ error: 'invalid_credentials' }, 401);

  await store.setJSON(email, { ...user, last_login: nowIso() });
  const token = await signSession(user);
  return json({
    token,
    user: { email: user.email, role: user.role },
  });
};

export const config = { path: '/.netlify/functions/auth-login' };
