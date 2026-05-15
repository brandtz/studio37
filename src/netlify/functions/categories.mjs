// /api/categories — public read-only list of active categories.

import { ensureCategorySeeded, categoryStore, json } from './_lib/store.mjs';

export default async () => {
  await ensureCategorySeeded();
  const store = categoryStore();
  const out = [];
  const { blobs } = await store.list();
  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const c = await store.get(b.key, { type: 'json' });
    if (c && !c.archived) out.push({ ...c, id: c.id || b.key });
  }
  out.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
  return json(out, 200, {
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
  });
};

export const config = { path: '/api/categories' };
