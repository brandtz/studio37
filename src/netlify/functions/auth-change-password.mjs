// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// Authenticated: requires a valid session token. Verifies current password, hashes new one, persists.

import { json, userStore, nowIso } from './_lib/store.mjs';
import { getSession, hashPassword, verifyPassword } from './_lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const { user, error } = await getSession(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');

  if (newPassword.length < 8) {
    return json({ error: 'password_too_short', message: 'Use at least 8 characters.' }, 400);
  }
  if (newPassword === currentPassword) {
    return json({ error: 'password_unchanged', message: 'New password must differ from current.' }, 400);
  }

  const store = userStore();
  const fresh = await store.get(user.email, { type: 'json' });
  if (!fresh) return json({ error: 'unauthorized' }, 401);

  // If a password is already set, the current one must match. If none is set
  // (edge case where session was issued before initial password), allow setting.
  if (fresh.passwordHash) {
    const ok = await verifyPassword(currentPassword, fresh.passwordHash);
    if (!ok) return json({ error: 'invalid_current_password' }, 401);
  }

  const hash = await hashPassword(newPassword);
  await store.setJSON(user.email, {
    ...fresh,
    passwordHash: hash,
    passwordSet: true,
    password_changed_at: nowIso(),
  });

  return json({ ok: true });
};

export const config = { path: '/.netlify/functions/auth-change-password' };
