// /api/admin/products[?id=:id]
// Admin CRUD on the products blob store. Auth via X-Admin-Key.

import { productStore, json, requireAdmin, nowIso, slugify } from './_lib/store.mjs';

export default async (req) => {
  const auth = requireAdmin(req);
  if (auth) return auth;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const store = productStore();

  // ── GET (list all, including archived) ──
  if (req.method === 'GET') {
    const out = [];
    const { blobs } = await store.list();
    for (const b of blobs) {
      const p = await store.get(b.key, { type: 'json' });
      if (p) out.push(p);
    }
    out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return json(out);
  }

  // ── POST (create) ──
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.name) return json({ error: 'name required' }, 400);
    const productId = body.id || slugify(body.name);
    const existing = await store.get(productId, { type: 'json' });
    if (existing) return json({ error: 'id already exists' }, 409);
    const product = sanitize({ ...body, id: productId, created_at: nowIso(), updated_at: nowIso() });
    await store.setJSON(productId, product);
    return json(product, 201);
  }

  // ── PUT (update) ──
  if (req.method === 'PUT') {
    if (!id) return json({ error: 'id required' }, 400);
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'invalid body' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    const updated = sanitize({ ...existing, ...body, id, updated_at: nowIso() });
    await store.setJSON(id, updated);
    return json(updated);
  }

  // ── DELETE (soft-delete -> status:archived) ──
  if (req.method === 'DELETE') {
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    const updated = { ...existing, status: 'archived', updated_at: nowIso() };
    await store.setJSON(id, updated);
    return json(updated);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

function sanitize(p) {
  const allowed = [
    'id', 'name', 'subtitle', 'price', 'description', 'category',
    'images', 'status', 'by_request', 'shipping', 'weight_oz',
    'created_at', 'updated_at',
  ];
  const out = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  // Coerce types defensively
  if (typeof out.price === 'string') out.price = parseInt(out.price, 10) || null;
  if (typeof out.weight_oz === 'string') out.weight_oz = parseInt(out.weight_oz, 10) || 0;
  out.images = Array.isArray(out.images) ? out.images.filter(Boolean).slice(0, 8) : [];
  out.status = ['available', 'out_of_stock', 'by_request', 'archived'].includes(out.status)
    ? out.status
    : 'available';
  return out;
}

export const config = { path: '/.netlify/functions/admin-products' };
