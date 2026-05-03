// /api/admin/users[?email=:email][&action=approve|disable|enable|reset-password]
// Session-gated. Only `super` users can modify other users.
//   GET    list all users (passwordHash redacted)
//   POST   ?email=:email&action=approve   set status=approved
//   POST   ?email=:email&action=disable   set status=disabled
//   POST   ?email=:email&action=enable    set status=approved
//   POST   ?email=:email&action=reset-password   clear passwordHash so user re-sets on next login
//   POST   (body: { email, role? })       create a user directly (super only)
//   DELETE ?email=:email                  remove user

import { json, userStore, ensureUserSeeded, nowIso } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

function redact(u) {
  if (!u) return u;
  const { passwordHash, ...rest } = u;
  return { ...rest, passwordSet: !!passwordHash };
}

export default async (req) => {
  const auth = await requireSession(req, { minRole: 'super' });
  if (auth.error) return auth.error;
  const me = auth.user;

  await ensureUserSeeded();
  const store = userStore();

  const url = new URL(req.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  const action = url.searchParams.get('action');

  if (req.method === 'GET') {
    const out = [];
    const { blobs } = await store.list();
    for (const b of blobs) {
      if (b.key.startsWith('_')) continue;
      const u = await store.get(b.key, { type: 'json' });
      if (u) out.push(redact(u));
    }
    out.sort((a, b) => {
      const order = { pending: 0, approved: 1, disabled: 2 };
      const sa = order[a.status] ?? 99;
      const sb = order[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
      return (a.email || '').localeCompare(b.email || '');
    });
    return json(out);
  }

  if (req.method === 'POST') {
    // Create user directly (without a request-access flow).
    if (!email && !action) {
      const body = await req.json().catch(() => null);
      const newEmail = String(body?.email || '').trim().toLowerCase();
      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return json({ error: 'invalid_email' }, 400);
      }
      const existing = await store.get(newEmail, { type: 'json' });
      if (existing) return json({ error: 'already_exists' }, 409);
      const role = body?.role === 'super' ? 'super' : 'admin';
      const user = {
        email: newEmail,
        status: 'approved',
        role,
        passwordHash: null,
        passwordSet: false,
        created_at: nowIso(),
        approved_at: nowIso(),
        approved_by: me.email,
        last_login: null,
      };
      await store.setJSON(newEmail, user);
      return json(redact(user), 201);
    }

    if (!email) return json({ error: 'email_required' }, 400);
    const user = await store.get(email, { type: 'json' });
    if (!user) return json({ error: 'not_found' }, 404);

    let updated = { ...user };
    if (action === 'approve') {
      updated.status = 'approved';
      updated.approved_at = nowIso();
      updated.approved_by = me.email;
    } else if (action === 'disable') {
      if (user.role === 'super') return json({ error: 'cannot_disable_super' }, 400);
      updated.status = 'disabled';
    } else if (action === 'enable') {
      updated.status = 'approved';
    } else if (action === 'reset-password') {
      updated.passwordHash = null;
      updated.passwordSet = false;
    } else if (action === 'role') {
      const body = await req.json().catch(() => null);
      const role = body?.role === 'super' ? 'super' : 'admin';
      updated.role = role;
    } else {
      return json({ error: 'unknown_action' }, 400);
    }
    await store.setJSON(email, updated);
    return json(redact(updated));
  }

  if (req.method === 'DELETE') {
    if (!email) return json({ error: 'email_required' }, 400);
    const user = await store.get(email, { type: 'json' });
    if (!user) return json({ error: 'not_found' }, 404);
    if (user.role === 'super') return json({ error: 'cannot_delete_super' }, 400);
    if (user.email === me.email) return json({ error: 'cannot_delete_self' }, 400);
    await store.delete(email);
    return json({ ok: true });
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/.netlify/functions/admin-users' };
