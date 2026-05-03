// GET /api/reviews
// Public endpoint: only published reviews.

import { ensureReviewSeeded, reviewStore, json } from './_lib/store.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  await ensureReviewSeeded();

  const store = reviewStore();
  const { blobs } = await store.list();
  const out = [];

  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const review = await store.get(b.key, { type: 'json' });
    if (review?.published !== false) out.push(review);
  }

  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return json(out, 200, { 'cache-control': 'public, max-age=60' });
};

export const config = { path: '/.netlify/functions/reviews' };
