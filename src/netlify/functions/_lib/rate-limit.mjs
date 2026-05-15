// Simple per-key sliding-window rate limiter backed by Netlify Blobs.
// Single-tenant, low-traffic. Best-effort; safe under low race conditions because
// we use strong consistency and last-write-wins.

import { rateLimitStore } from './store.mjs';

/**
 * @param {{ key: string, limit: number, windowMs: number }} opts
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfterSec: number }>}
 */
export async function checkRateLimit({ key, limit, windowMs }) {
  if (!key || !Number.isFinite(limit) || !Number.isFinite(windowMs)) {
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }

  const store = rateLimitStore();
  const safeKey = encodeURIComponent(key);
  const now = Date.now();

  let bucket;
  try {
    bucket = await store.get(safeKey, { type: 'json' });
  } catch {
    bucket = null;
  }

  if (!bucket || typeof bucket.windowStart !== 'number' || now - bucket.windowStart >= windowMs) {
    // New / expired window
    bucket = { count: 1, windowStart: now };
    try { await store.setJSON(safeKey, bucket); } catch { /* best-effort */ }
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }

  if (bucket.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  bucket.count += 1;
  try { await store.setJSON(safeKey, bucket); } catch { /* best-effort */ }
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterSec: 0 };
}

/**
 * Extract a best-effort client IP from the request.
 * @param {Request} req
 * @returns {string}
 */
export function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('client-ip') ||
    'unknown'
  );
}
