// POST /api/auth/request-access
// Body: { email, name?, message? }
// Creates a pending user record. Idempotent — re-submitting the same email
// while pending returns 200 without changing anything. Already-approved users
// also receive 200 (no enumeration / no clobbering).

import { json, userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  await ensureUserSeeded();

  const body = await req.json().catch(() => null);
  const email = String(body?.email || '').trim().toLowerCase();
  const name = String(body?.name || '').trim().slice(0, 120);
  const message = String(body?.message || '').trim().slice(0, 500);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'invalid_email' }, 400);
  }

  const store = userStore();
  const existing = await store.get(email, { type: 'json' });

  if (!existing) {
    await store.setJSON(email, {
      email,
      status: 'pending',
      role: 'admin',
      passwordHash: null,
      passwordSet: false,
      created_at: nowIso(),
      approved_at: null,
      approved_by: null,
      last_login: null,
      request_name: name || null,
      request_message: message || null,
    });
    // TODO: send Drew an SMS / email notification here once SMTP is wired.
  }

  return json({ ok: true, message: 'Request received. You will be notified once approved.' });
};

export const config = { path: '/.netlify/functions/auth-request-access' };
