// GET /api/products             -> list non-archived products (public)
// GET /api/products/:id         -> single product (Snipcart product validation format)
//
// Snipcart hits the per-product URL on every checkout to verify price integrity.
// We respond with Snipcart's expected schema (decimal dollars, image url, etc.).

import { productStore, json, toSnipcartProduct } from './_lib/store.mjs';

export default async (req) => {
  const url = new URL(req.url);
  // ?id=... is set by the netlify.toml redirect for /api/products/:id
  const id = url.searchParams.get('id') || (url.pathname.split('/').filter(Boolean).pop());

  const store = productStore();

  // Single-product (Snipcart validation format).
  if (id && id !== 'products') {
    const p = await store.get(id, { type: 'json' });
    if (!p || p.status === 'archived') return json({ error: 'not_found' }, 404);
    const baseUrl = `${url.protocol}//${url.host}`;
    return json(toSnipcartProduct(p, baseUrl));
  }

  // List view: return non-archived, raw shape (cents) for shop.js to render.
  const out = [];
  // Netlify Blobs `list` returns keys; fetch each.
  const { blobs } = await store.list();
  for (const b of blobs) {
    const p = await store.get(b.key, { type: 'json' });
    if (p && p.status !== 'archived') out.push(p);
  }
  return json(out, 200, { 'cache-control': 'public, max-age=30' });
};

export const config = { path: '/.netlify/functions/products' };
