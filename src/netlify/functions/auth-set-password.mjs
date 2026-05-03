// POST /api/auth/set-password
// Body: { setupToken, password }
// Verifies the short-lived setup token issued by /api/auth/login (firstLogin flow),
// hashes & stores the password, and returns a session token.

import { json, userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';
import { verifySetupToken, hashPassword, signSession } from './_lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  await ensureUserSeeded();

  const body = await req.json().catch(() => null);
  const setupToken = String(body?.setupToken || '');
  const password = String(body?.password || '');

  if (!setupToken) return json({ error: 'setup_token_required' }, 400);
  if (password.length < 8) return json({ error: 'password_too_short', message: 'Use at least 8 characters.' }, 400);

  const payload = await verifySetupToken(setupToken);
  if (!payload?.email) return json({ error: 'invalid_or_expired_token' }, 401);

  const email = String(payload.email).toLowerCase();
  const store = userStore();
  const user = await store.get(email, { type: 'json' });
  if (!user || user.status !== 'approved') return json({ error: 'invalid_or_expired_token' }, 401);

  // Only allow setting a password if it has not been set already.
  if (user.passwordSet && user.passwordHash) {
    return json({ error: 'password_already_set' }, 409);
  }

  const hash = await hashPassword(password);
  const updated = {
    ...user,
    passwordHash: hash,
    passwordSet: true,
    last_login: nowIso(),
  };
  await store.setJSON(email, updated);

  const token = await signSession(updated);
  return json({ token, user: { email: updated.email, role: updated.role } });
};

export const config = { path: '/.netlify/functions/auth-set-password' };
