// POST /api/auth/logout
// Stateless JWT — the client just discards the token. This endpoint exists
// so the SPA can fire-and-forget without needing a special case.

import { json } from './_lib/store.mjs';

export default async () => json({ ok: true });

export const config = { path: '/.netlify/functions/auth-logout' };
