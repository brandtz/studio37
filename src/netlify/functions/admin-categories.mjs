// /api/admin/categories[/:id]
// Admin CRUD on product category blob store. Session-gated.

import { ensureCategorySeeded, categoryStore, json, nowIso, slugify } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  await ensureCategorySeeded();

  const url = new URL(req.url);
  const pathSegs = url.pathname.split('/').filter(Boolean);
  const tailSeg = pathSegs[pathSegs.length - 1] || '';
  const idFromPath = (tailSeg && tailSeg !== 'categories' && tailSeg !== 'admin-categories')
    ? decodeURIComponent(tailSeg)
    : null;
  const id = req.params?.id || url.searchParams.get('id') || idFromPath || null;
  const store = categoryStore();

  if (req.method === 'GET') {
    const out = [];
    const { blobs } = await store.list();
    for (const b of blobs) {
      if (b.key.startsWith('_')) continue;
      const c = await store.get(b.key, { type: 'json' });
      if (c) out.push({ ...c, id: c.id || b.key });
    }
    out.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
    return json(out);
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.name) return json({ error: 'name required' }, 400);
    const categoryId = body.id ? slugify(body.id) : slugify(body.name);
    if (!categoryId) return json({ error: 'invalid id' }, 400);
    const existing = await store.get(categoryId, { type: 'json' });
    if (existing) return json({ error: 'id already exists' }, 409);
    const category = sanitize({
      ...body,
      id: categoryId,
      slug: categoryId,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await store.setJSON(categoryId, category);
    return json(category, 201);
  }

  if (req.method === 'PUT') {
    if (!id) return json({ error: 'id required' }, 400);
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'invalid body' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    const updated = sanitize({ ...existing, ...body, id, slug: id, updated_at: nowIso() });
    await store.setJSON(id, updated);
    return json(updated);
  }

  if (req.method === 'DELETE') {
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    // Soft delete via archived flag — products that reference this category keep working.
    const updated = { ...existing, archived: true, updated_at: nowIso() };
    await store.setJSON(id, updated);
    return json(updated);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

function sanitize(c) {
  return {
    id: c.id,
    slug: c.slug || c.id,
    name: String(c.name || '').trim().slice(0, 80),
    sort_order: typeof c.sort_order === 'number' ? c.sort_order : (parseInt(c.sort_order, 10) || 100),
    archived: !!c.archived,
    created_at: c.created_at || nowIso(),
    updated_at: c.updated_at || nowIso(),
  };
}

export const config = {
  path: ['/api/admin/categories', '/api/admin/categories/:id'],
};
