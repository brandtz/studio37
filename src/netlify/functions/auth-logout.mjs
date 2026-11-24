// POST /api/auth/logout
// Revoke this session server-side; other sessions remain signed in.

import { authJson, getSession, revokeSession } from './_lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return authJson({ error: 'method_not_allowed' }, 405);
  const { error, session } = await getSession(req);
  if (error) return error;
  try {
    await revokeSession(session);
    return authJson({ ok: true });
  } catch {
    console.error('[auth] session revocation failed');
    return authJson({ error: 'logout_unavailable' }, 503);
  }
};

export const config = { path: '/.netlify/functions/auth-logout' };
