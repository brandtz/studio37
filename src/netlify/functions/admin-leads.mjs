// GET /api/admin/leads
// Returns all submitted quote-request leads (most recent first).
// Auth: X-Admin-Key header.

import { leadStore, json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const store = leadStore();
  const { blobs } = await store.list();
  const leads = await Promise.all(
    (blobs || []).map((b) => store.get(b.key, { type: 'json' })),
  );
  leads.sort((a, b) => (b?.created_at || '').localeCompare(a?.created_at || ''));
  return json(leads.filter(Boolean));
};

export const config = { path: '/.netlify/functions/admin-leads' };
