// Shared helpers for Netlify Functions.

import { getStore } from '@netlify/blobs';

export const PRODUCT_STORE = 'products';
export const LEAD_STORE = 'leads';

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
