// GET /api/admin/orders
// Returns persisted orders (from Stripe webhook) most-recent first.
// Session-gated.

import { json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import { orderStore } from './_lib/stripe.mjs';

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const store = orderStore();
  const { blobs } = await store.list();
  const orders = await Promise.all(
    (blobs || [])
      .filter((b) => !b.key.startsWith('_'))
      .map((b) => store.get(b.key, { type: 'json' })),
  );
  orders.sort((a, b) => (b?.created_at || '').localeCompare(a?.created_at || ''));
  return json(orders.filter(Boolean));
};

export const config = { path: '/.netlify/functions/admin-orders' };
