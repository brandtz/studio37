// /api/admin/reviews[?id=:id]
// Admin CRUD on reviews blob store. Session-gated.

import { ensureReviewSeeded, reviewStore, json, nowIso, slugify } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  await ensureReviewSeeded();

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const store = reviewStore();

  if (req.method === 'GET') {
    const out = [];
    const { blobs } = await store.list();
    for (const b of blobs) {
      if (b.key.startsWith('_')) continue;
      const review = await store.get(b.key, { type: 'json' });
      if (review) out.push(review);
    }
    out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return json(out);
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.name || !body.text) return json({ error: 'name and text required' }, 400);
    const reviewId = body.id || slugify(`${body.name}-${Date.now()}`);
    const existing = await store.get(reviewId, { type: 'json' });
    if (existing) return json({ error: 'id already exists' }, 409);
    const review = sanitize({ ...body, id: reviewId, created_at: nowIso(), updated_at: nowIso() });
    await store.setJSON(reviewId, review);
    return json(review, 201);
  }

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

  if (req.method === 'DELETE') {
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: 'method_not_allowed' }, 405);
};

function sanitize(r) {
  const out = {
    id: r.id,
    name: String(r.name || '').trim(),
    location: String(r.location || '').trim(),
    project: String(r.project || '').trim(),
    text: String(r.text || '').trim(),
    stars: Math.min(5, Math.max(1, parseInt(r.stars, 10) || 5)),
    published: r.published !== false,
    created_at: r.created_at || nowIso(),
    updated_at: r.updated_at || nowIso(),
  };
  return out;
}

export const config = { path: '/.netlify/functions/admin-reviews' };
