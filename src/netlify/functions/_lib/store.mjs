// Shared helpers for Netlify Functions.

import { getStore } from '@netlify/blobs';
import seedProducts from './products.seed.json' with { type: 'json' };

export const PRODUCT_STORE = 'products';
export const LEAD_STORE = 'leads';

// Bump this whenever the seed data changes — triggers auto-migration on next cold start.
const SEED_VERSION = 2;
const SEED_VERSION_KEY = '_seed_version';

export function productStore() {
  return getStore({ name: PRODUCT_STORE, consistency: 'strong' });
}

export function leadStore() {
  return getStore({ name: LEAD_STORE, consistency: 'strong' });
}

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

export const text = (body, status = 200, extra = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain', ...extra } });

export function requireAdmin(req) {
  const expected = process.env.ADMIN_KEY;
  const got = req.headers.get('x-admin-key');
  if (!expected || got !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null;
}

export function nowIso() {
  return new Date().toISOString();
}

/** Normalize image paths: replace .jpeg extensions with .jpg */
function normalizeImages(product) {
  return {
    ...product,
    images: (product.images || []).map((img) => img.replace(/\.jpeg$/i, '.jpg')),
  };
}

export async function ensureProductSeeded(force = false) {
  const store = productStore();

  if (!force) {
    // Check stored seed version — reseed if it's missing or outdated.
    const storedVersion = await store.get(SEED_VERSION_KEY, { type: 'json' }).catch(() => null);
    if (storedVersion?.v === SEED_VERSION) {
      const existing = await store.list();
      if (existing.blobs?.filter((b) => b.key !== SEED_VERSION_KEY).length) {
        return { seeded: false, written: 0 };
      }
    }
  }

  const now = nowIso();
  let written = 0;
  for (const product of seedProducts) {
    const normalized = normalizeImages(product);
    await store.setJSON(normalized.id, { ...normalized, created_at: now, updated_at: now });
    written++;
  }
  await store.setJSON(SEED_VERSION_KEY, { v: SEED_VERSION });

  return { seeded: true, written, count: written };
}

export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

// Snipcart product validation expects decimal dollars at top level.
export function toSnipcartProduct(p, baseUrl) {
  return {
    id: p.id,
    name: p.name,
    price: typeof p.price === 'number' ? +(p.price / 100).toFixed(2) : 0,
    url: `${baseUrl || ''}/api/products/${p.id}`,
    description: p.description || '',
    image: p.images?.[0] || null,
  };
}
