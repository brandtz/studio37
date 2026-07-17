// GET  /api/reviews — public: only published reviews.
// POST /api/reviews — public: submit a new review. Always saved as pending
//                     (published: false) regardless of what's submitted —
//                     it only appears on the site once an admin approves it.

import { ensureReviewSeeded, reviewStore, json, nowIso, slugify } from './_lib/store.mjs';
import { checkRateLimit, clientIp } from './_lib/rate-limit.mjs';

const MAX_NAME = 80;
const MAX_FIELD = 120;
const MAX_TEXT = 2000;

export default async (req) => {
  await ensureReviewSeeded();
  const store = reviewStore();

  if (req.method === 'GET') {
    const { blobs } = await store.list();
    const out = [];

    for (const b of blobs) {
      if (b.key.startsWith('_')) continue;
      const review = await store.get(b.key, { type: 'json' });
      if (review?.published !== false) out.push(review);
    }

    out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return json(out, 200, { 'cache-control': 'public, max-age=60' });
  }

  if (req.method === 'POST') {
    const ip = clientIp(req);
    // Generous but real spam guard — mirrors quote-request.mjs's pattern.
    const rl = await checkRateLimit({ key: `review:ip:${ip}`, limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return json(
        { error: 'too_many_requests', message: 'Too many submissions from this network. Please try again later.', retry_after: rl.retryAfterSec },
        429,
        { 'retry-after': String(rl.retryAfterSec) },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'invalid_body' }, 400);

    // Honeypot — silently accept without persisting.
    if (body['bot-field']) return json({ ok: true });

    const name = String(body.name || '').trim().slice(0, MAX_NAME);
    const text = String(body.text || '').trim().slice(0, MAX_TEXT);
    if (!name || !text) return json({ error: 'name and text required' }, 400);

    const review = {
      id: slugify(`${name}-${Date.now()}`),
      name,
      location: String(body.location || '').trim().slice(0, MAX_FIELD),
      project: String(body.project || '').trim().slice(0, MAX_FIELD),
      text,
      stars: Math.min(5, Math.max(1, parseInt(body.stars, 10) || 5)),
      // Always pending — a public submitter can never set this to true.
      published: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    };

    try {
      await store.setJSON(review.id, review);
    } catch (err) {
      console.error('[reviews] persist failed', err);
      return json({ error: 'persist_failed' }, 500);
    }

    return json({ ok: true }, 201);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/.netlify/functions/reviews' };
