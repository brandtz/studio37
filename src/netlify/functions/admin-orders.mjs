// GET  /api/admin/orders            -> list (most recent first)
// GET  /api/admin/orders/:id        -> single order
// PATCH /api/admin/orders/:id       -> { lifecycle?, tracking_number?, tracking_carrier?, internal_notes? }
// Session-gated.

import { json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import { orderStore } from './_lib/stripe.mjs';

// Allowed lifecycle stages (Epic 4). Linear progression is enforced softly
// in the UI; the API accepts any transition so admins can correct mistakes.
const LIFECYCLE_STAGES = new Set([
  'new',
  'in_production',
  'ready_to_ship',
  'shipped',
  'delivered',
  'complete',
  'cancelled',
  'refunded',
]);

function extractIdFromPath(req) {
  const url = new URL(req.url);
  // Preferred: ?id=... (set by the _redirects splat rule).
  const qid = url.searchParams.get('id');
  if (qid) return qid;
  const parts = url.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === 'admin-orders' || last === 'orders') return null;
  return last;
}

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  const store = orderStore();
  const id = extractIdFromPath(req);

  if (req.method === 'GET') {
    if (id) {
      const order = await store.get(id, { type: 'json' });
      if (!order) return json({ error: 'not_found' }, 404);
      return json(order);
    }
    const { blobs } = await store.list();
    const orders = await Promise.all(
      (blobs || [])
        .filter((b) => !b.key.startsWith('_'))
        .map((b) => store.get(b.key, { type: 'json' })),
    );
    orders.sort((a, b) => (b?.created_at || '').localeCompare(a?.created_at || ''));
    return json(orders.filter(Boolean));
  }

  if (req.method === 'PATCH') {
    if (!id) return json({ error: 'id_required' }, 400);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);

    const order = await store.get(id, { type: 'json' });
    if (!order) return json({ error: 'not_found' }, 404);

    const next = { ...order };
    const nowIso = new Date().toISOString();
    const history = Array.isArray(order.status_history) ? [...order.status_history] : [];
    let stageChanged = false;

    if (typeof body.lifecycle === 'string') {
      if (!LIFECYCLE_STAGES.has(body.lifecycle)) {
        return json({ error: 'invalid_lifecycle' }, 400);
      }
      if (body.lifecycle !== order.lifecycle) {
        next.lifecycle = body.lifecycle;
        next.lifecycle_at = nowIso;
        history.push({ stage: body.lifecycle, at: nowIso, by: auth.user?.email || 'admin' });
        stageChanged = true;
      }
    }
    if (typeof body.tracking_number === 'string') {
      next.tracking_number = body.tracking_number.trim().slice(0, 80) || null;
    }
    if (typeof body.tracking_carrier === 'string') {
      next.tracking_carrier = body.tracking_carrier.trim().slice(0, 40) || null;
    }
    if (typeof body.internal_notes === 'string') {
      next.internal_notes = body.internal_notes.slice(0, 5000);
    }

    if (stageChanged) next.status_history = history;
    next.updated_at = nowIso;
    next.updated_by = auth.user?.email || 'admin';

    await store.setJSON(id, next);
    return json(next);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/.netlify/functions/admin-orders' };
