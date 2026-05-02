// GET /api/products             -> list non-archived products (public)
// GET /api/products/:id         -> single product (Snipcart product validation format)
//
// Snipcart hits the per-product URL on every checkout to verify price integrity.
// We respond with Snipcart's expected schema (decimal dollars, image url, etc.).

import { ensureProductSeeded, productStore, json, toSnipcartProduct } from './_lib/store.mjs';
import seedProducts from './_lib/products.seed.json' with { type: 'json' };

export default async (req) => {
  const url = new URL(req.url);
  // ?id=... is set by the netlify.toml redirect for /api/products/:id
  const id = url.searchParams.get('id') || (url.pathname.split('/').filter(Boolean).pop());

  // Try to seed Blobs on first run; if Blobs is unavailable we fall back to seed data below.
  let blobsAvailable = true;
  try {
    await ensureProductSeeded();
  } catch (err) {
    console.warn('[products] Blobs seed failed, falling back to static seed data:', err?.message);
    blobsAvailable = false;
  }

  // Single-product (Snipcart validation format).
  if (id && id !== 'products') {
    if (!blobsAvailable) {
      const p = seedProducts.find((x) => x.id === id);
      if (!p || p.status === 'archived') return json({ error: 'not_found' }, 404);
      const baseUrl = `${url.protocol}//${url.host}`;
      return json(toSnipcartProduct(p, baseUrl));
    }
    const store = productStore();
    const p = await store.get(id, { type: 'json' });
    if (!p || p.status === 'archived') return json({ error: 'not_found' }, 404);
    const baseUrl = `${url.protocol}//${url.host}`;
    return json(toSnipcartProduct(p, baseUrl));
  }

  // List view: return non-archived, raw shape (cents) for shop.js to render.
  if (!blobsAvailable) {
    // Blobs unavailable — serve seed data directly so the shop is never empty.
    const fallback = seedProducts.filter((p) => p.status !== 'archived');
    return json(fallback, 200, { 'cache-control': 'public, max-age=10' });
  }

  const store = productStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const p = await store.get(b.key, { type: 'json' });
    if (p && p.status !== 'archived') out.push(p);
  }

  // Safety net: Blobs was available but store is still empty (e.g. seed write failed silently).
  if (!out.length) {
    console.warn('[products] Blobs store empty after seed attempt, serving static seed data');
    return json(
      seedProducts.filter((p) => p.status !== 'archived'),
      200,
      { 'cache-control': 'public, max-age=10' },
    );
  }

  return json(out, 200, { 'cache-control': 'public, max-age=30' });
};

export const config = { path: '/.netlify/functions/products' };
