// POST /api/seed-products
// One-shot bootstrap: load `_lib/products.seed.json` into the products blob store.
// Auth: X-Admin-Key. Refuses to run if the store is non-empty unless `?force=1`.

import { ensureProductSeeded, json, requireAdmin } from './_lib/store.mjs';

export default async (req) => {
  const auth = requireAdmin(req);
  if (auth) return auth;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  const result = await ensureProductSeeded(force);
  if (!result.seeded && !force) {
    return json({
      error: 'store_not_empty',
      message: `Refusing to seed — ${result.count} products already present. Re-run with ?force=1 to overwrite.`,
    }, 409);
  }

  return json({ ok: true, written: result.written });
};

export const config = { path: '/.netlify/functions/seed-products' };
