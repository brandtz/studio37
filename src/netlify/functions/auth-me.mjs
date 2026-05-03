// GET /api/auth/me
// Returns the current session user, or 401.

import { json } from './_lib/store.mjs';
import { getSession } from './_lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const { user, error } = await getSession(req);
  if (error) return error;
  return json({
    email: user.email,
    role: user.role,
    status: user.status,
  });
};

export const config = { path: '/.netlify/functions/auth-me' };
