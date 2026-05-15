// /api/site-media — public map of slot -> { url, alt }
// Returns ONLY slots that have an admin override (keeps payload small).
// Pages fall back to their hard-coded default src/alt when a slot is missing.

import { siteMediaStore, json } from './_lib/store.mjs';

export default async () => {
  const store = siteMediaStore();
  const map = {};
  const { blobs } = await store.list();
  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const o = await store.get(b.key, { type: 'json' });
    if (o?.url) map[b.key] = { url: o.url, alt: o.alt || '' };
  }
  return json(map, 200, {
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
  });
};

export const config = { path: '/api/site-media' };
