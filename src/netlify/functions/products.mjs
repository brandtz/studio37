// GET /api/products             -> list non-archived products (public)
// GET /api/products/:id         -> single product (public)
//
// Returns the raw product shape (price in cents). Cart code on the frontend
// references this for display; price integrity is enforced server-side at
// /api/stripe/checkout-session by re-reading the product from Blobs.

import { ensureProductSeeded, productStore, json } from './_lib/store.mjs';
import seedProducts from './_lib/products.seed.json' with { type: 'json' };

const PENDING_REPLACEMENT_IMAGES = new Set([
  '/assets/images/shop/bench_1.jpg',
  '/assets/images/shop/bench_2.jpg',
]);

function hidePendingReplacementImages(product) {
  if (!Array.isArray(product.images)) return product;
  const images = product.images.filter((image) => !PENDING_REPLACEMENT_IMAGES.has(image));
  return images.length === product.images.length ? product : { ...product, images };
}

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || (url.pathname.split('/').filter(Boolean).pop());

  let blobsAvailable = true;
  try {
    await ensureProductSeeded();
  } catch (err) {
    console.warn('[products] Blobs seed failed, falling back to static seed data:', err?.message);
    blobsAvailable = false;
  }

  // Single-product
  if (id && id !== 'products') {
    if (!blobsAvailable) {
      const p = seedProducts.find((x) => x.id === id);
      if (!p || p.status === 'archived') return json({ error: 'not_found' }, 404);
      return json(hidePendingReplacementImages(p));
    }
    const store = productStore();
    const p = await store.get(id, { type: 'json' });
    if (!p || p.status === 'archived') return json({ error: 'not_found' }, 404);
    return json(hidePendingReplacementImages(p));
  }

  // List view
  if (!blobsAvailable) {
    const fallback = seedProducts
      .filter((p) => p.status !== 'archived')
      .map(hidePendingReplacementImages);
    return json(fallback, 200, { 'cache-control': 'public, max-age=10' });
  }

  const store = productStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const p = await store.get(b.key, { type: 'json' });
    if (p && p.status !== 'archived') out.push(hidePendingReplacementImages(p));
  }

  if (!out.length) {
    console.warn('[products] Blobs store empty after seed attempt, serving static seed data');
    return json(
      seedProducts.filter((p) => p.status !== 'archived').map(hidePendingReplacementImages),
      200,
      { 'cache-control': 'public, max-age=10' },
    );
  }

  return json(out, 200, { 'cache-control': 'public, max-age=30' });
};

export const config = { path: '/.netlify/functions/products' };
