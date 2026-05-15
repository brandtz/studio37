// Shared helpers for Netlify Functions.

import { getStore } from '@netlify/blobs';
import seedProducts from './products.seed.json' with { type: 'json' };
import seedReviews from './reviews.seed.json' with { type: 'json' };
import seedUsers from './users.seed.json' with { type: 'json' };
import seedCategories from './categories.seed.json' with { type: 'json' };

export const PRODUCT_STORE = 'products';
export const LEAD_STORE = 'leads';
export const REVIEW_STORE = 'reviews';
export const USER_STORE = 'users';
export const CATEGORY_STORE = 'categories';
export const SITE_MEDIA_STORE = 'site_media';

// Bump this whenever the seed data changes — triggers auto-migration on next cold start.
const SEED_VERSION = 3;
const SEED_VERSION_KEY = '_seed_version';
const REVIEW_SEED_VERSION = 1;
const REVIEW_SEED_VERSION_KEY = '_review_seed_version';
const USER_SEED_VERSION = 2;
const USER_SEED_VERSION_KEY = '_user_seed_version';
const CATEGORY_SEED_VERSION = 1;
const CATEGORY_SEED_VERSION_KEY = '_category_seed_version';

export function productStore() {
  return getStore({ name: PRODUCT_STORE, consistency: 'strong' });
}

export function leadStore() {
  return getStore({ name: LEAD_STORE, consistency: 'strong' });
}

export function reviewStore() {
  return getStore({ name: REVIEW_STORE, consistency: 'strong' });
}

export function userStore() {
  return getStore({ name: USER_STORE, consistency: 'strong' });
}

export function categoryStore() {
  return getStore({ name: CATEGORY_STORE, consistency: 'strong' });
}

export function siteMediaStore() {
  return getStore({ name: SITE_MEDIA_STORE, consistency: 'strong' });
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

  // Snapshot what's already stored so we can preserve admin edits.
  const existingList = await store.list().catch(() => ({ blobs: [] }));
  const existingKeys = new Set((existingList.blobs || []).map((b) => b.key));
  const storedVersion = await store.get(SEED_VERSION_KEY, { type: 'json' }).catch(() => null);

  if (!force && storedVersion?.v === SEED_VERSION) {
    if (existingList.blobs?.filter((b) => b.key !== SEED_VERSION_KEY).length) {
      return { seeded: false, written: 0 };
    }
  }

  const now = nowIso();
  let written = 0;
  for (const product of seedProducts) {
    const normalized = normalizeImages(product);
    // Only write if the product doesn't already exist OR we're doing a forced reseed.
    // This way, version bumps add new SKUs without clobbering admin edits to existing ones.
    if (!force && existingKeys.has(normalized.id)) continue;
    await store.setJSON(normalized.id, { ...normalized, created_at: now, updated_at: now });
    written++;
  }
  await store.setJSON(SEED_VERSION_KEY, { v: SEED_VERSION });

  return { seeded: true, written, count: written };
}

export async function ensureReviewSeeded(force = false) {
  const store = reviewStore();

  if (!force) {
    const storedVersion = await store.get(REVIEW_SEED_VERSION_KEY, { type: 'json' }).catch(() => null);
    if (storedVersion?.v === REVIEW_SEED_VERSION) {
      const existing = await store.list();
      if (existing.blobs?.filter((b) => b.key !== REVIEW_SEED_VERSION_KEY).length) {
        return { seeded: false, written: 0 };
      }
    }
  }

  const now = nowIso();
  let written = 0;
  for (const review of seedReviews) {
    await store.setJSON(review.id, {
      ...review,
      created_at: review.created_at || now,
      updated_at: now,
    });
    written++;
  }
  await store.setJSON(REVIEW_SEED_VERSION_KEY, { v: REVIEW_SEED_VERSION });
  return { seeded: true, written, count: written };
}

export async function ensureUserSeeded(force = false) {
  const store = userStore();

  if (!force) {
    const storedVersion = await store
      .get(USER_SEED_VERSION_KEY, { type: 'json' })
      .catch(() => null);
    if (storedVersion?.v === USER_SEED_VERSION) {
      return { seeded: false, written: 0 };
    }
  }

  const now = nowIso();
  let written = 0;
  for (const u of seedUsers) {
    const key = String(u.email).toLowerCase();
    const existing = await store.get(key, { type: 'json' }).catch(() => null);
    if (!existing) {
      // First-time seed for this email.
      await store.setJSON(key, {
        email: key,
        status: u.status || 'approved',
        role: u.role || 'admin',
        passwordHash: u.passwordHash || null,
        passwordSet: !!u.passwordHash,
        created_at: now,
        approved_at: now,
        approved_by: 'seed',
        last_login: null,
      });
      written++;
    } else if (u.passwordHash && !existing.passwordHash) {
      // User already exists but has no password yet — apply the seeded password
      // so the operator can sign in immediately. Never clobber an existing hash.
      await store.setJSON(key, {
        ...existing,
        passwordHash: u.passwordHash,
        passwordSet: true,
      });
      written++;
    }
  }
  await store.setJSON(USER_SEED_VERSION_KEY, { v: USER_SEED_VERSION });
  return { seeded: true, written };
}

export function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

export async function ensureCategorySeeded(force = false) {
  const store = categoryStore();
  const existingList = await store.list().catch(() => ({ blobs: [] }));
  const existingKeys = new Set((existingList.blobs || []).map((b) => b.key));
  const storedVersion = await store
    .get(CATEGORY_SEED_VERSION_KEY, { type: 'json' })
    .catch(() => null);

  if (!force && storedVersion?.v === CATEGORY_SEED_VERSION) {
    if (existingList.blobs?.filter((b) => b.key !== CATEGORY_SEED_VERSION_KEY).length) {
      return { seeded: false, written: 0 };
    }
  }

  const now = nowIso();
  let written = 0;
  for (const c of seedCategories) {
    if (!force && existingKeys.has(c.id)) continue;
    await store.setJSON(c.id, {
      id: c.id,
      name: c.name,
      slug: c.id,
      sort_order: c.sort_order ?? 100,
      archived: false,
      created_at: now,
      updated_at: now,
    });
    written++;
  }
  await store.setJSON(CATEGORY_SEED_VERSION_KEY, { v: CATEGORY_SEED_VERSION });
  return { seeded: true, written };
}
