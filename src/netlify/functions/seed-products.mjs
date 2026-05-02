// POST /api/seed-products
// One-shot bootstrap: load `_lib/products.seed.json` into the products blob store.
// Auth: X-Admin-Key. Refuses to run if the store is non-empty unless `?force=1`.

import { productStore, json, requireAdmin, nowIso } from './_lib/store.mjs';
import seed from './_lib/products.seed.json' with { type: 'json' };

export default async (req) => {
  const auth = requireAdmin(req);
  if (auth) return auth;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  const store = productStore();
  const existing = await store.list();
  if (existing.blobs?.length && !force) {
    return json({
      error: 'store_not_empty',
      message: `Refusing to seed — ${existing.blobs.length} products already present. Re-run with ?force=1 to overwrite.`,
    }, 409);
  }

  let written = 0;
  const now = nowIso();
  for (const p of seed) {
    await store.setJSON(p.id, { ...p, created_at: now, updated_at: now });
    written++;
  }

  return json({ ok: true, written });
};

export const config = { path: '/.netlify/functions/seed-products' };
