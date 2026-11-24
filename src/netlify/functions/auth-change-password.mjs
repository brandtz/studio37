// POST /api/auth/change-password
// Body: { currentPassword, newPassword }
// Authenticated: requires a valid session token. Verifies current password, hashes new one, persists.

import { json, userStore, nowIso } from './_lib/store.mjs';
import { getSession, hashPassword, verifyPassword, revokeUserTokens, authJson } from './_lib/auth.mjs';

async function handle(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const { user, error } = await getSession(req);
  if (error) return error;

  const body = await req.json().catch(() => null);
  const currentPassword = String(body?.currentPassword || '');
  const newPassword = String(body?.newPassword || '');

  if (newPassword.length < 8) {
    return json({ error: 'password_too_short', message: 'Use at least 8 characters.' }, 400);
  }
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    return authJson({ error: 'password_too_long', message: 'Use at most 72 UTF-8 bytes.' }, 400);
  }
  if (newPassword === currentPassword) {
    return json({ error: 'password_unchanged', message: 'New password must differ from current.' }, 400);
  }

  const store = userStore();
  const fresh = await store.get(user.email, { type: 'json' });
  if (!fresh || fresh.status !== 'approved' || !fresh.passwordHash) return json({ error: 'unauthorized' }, 401);

  const ok = await verifyPassword(currentPassword, fresh.passwordHash);
  if (!ok) return json({ error: 'invalid_current_password' }, 401);

  const hash = await hashPassword(newPassword);
  // Revalidate the original session after bcrypt; reset/disable/logout/another
  // password change while hashing must not be overwritten by this snapshot.
  const current = await getSession(req);
  if (current.error) return current.error;
  const authVersion = await revokeUserTokens(current.user);
  await store.setJSON(user.email, {
    ...current.user,
    authVersion,
    passwordHash: hash,
    passwordSet: true,
    password_changed_at: nowIso(),
  });

  return authJson({ ok: true, reauthenticate: true });
}

export default async (req) => {
  try {
    return await handle(req);
  } catch {
    console.error('[auth] password change failed');
    return authJson({ error: 'password_change_unavailable', message: 'Could not change password. Sign in again or contact the site owner.' }, 503);
  }
};

export const config = { path: '/.netlify/functions/auth-change-password' };
