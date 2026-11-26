// Storefront products ⇄ Back Office catalog (/api/v1/catalog).
//
// Links live in the `backoffice_catalog_map` store (products are sanitized
// to a fixed field list, so ids can't be stored on the product record):
//   <productId>       → { catalog_item_id, sku, version, synced_at }
//   item/<catalogId>  → { product_id }
//
// This module must not import _lib/store.mjs (it is reachable from the Stripe
// webhook); callers pass products in.

import { getStore } from '@netlify/blobs';
import { backOfficeApi, backOfficeApiConfigured, BackOfficeError, errorSummary } from './backoffice.mjs';
import { isPublicProduct } from './public-availability.mjs';

export const catalogMapStore = () => getStore({ name: 'backoffice_catalog_map', consistency: 'strong' });
const ITEM_PREFIX = 'item/';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

// Attribute keys the storefront owns; anything else on the Back Office item
// (added by operators there) is preserved because PATCH replaces attributes.
const OWNED_ATTRIBUTES = [
  'storefrontProductId', 'storefrontStatus', 'byRequest', 'category', 'subtitle',
  'dimensions', 'materials', 'leadTimeDays', 'images',
];

const siteUrl = () => String(process.env.SITE_URL || process.env.URL || 'https://studio37customdesigns.com').replace(/\/+$/, '');

export function catalogSku(product) {
  const sku = typeof product?.sku === 'string' && product.sku.trim()
    ? product.sku.trim()
    : `S37-${String(product?.id || '').toUpperCase()}`;
  return sku.slice(0, 80);
}

const isByRequest = (p) => p?.status === 'by_request' || p?.by_request === true;

export function absoluteImage(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${siteUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
}

function ownedAttributes(p) {
  const images = (Array.isArray(p.images) ? p.images : []).map(absoluteImage).filter(Boolean).slice(0, 8);
  return {
    storefrontProductId: p.id,
    storefrontStatus: p.status || 'available',
    byRequest: isByRequest(p),
    category: p.category || null,
    subtitle: p.subtitle || null,
    dimensions: p.dimensions || null,
    materials: p.materials || null,
    leadTimeDays: Number.isInteger(p.lead_time_days) ? p.lead_time_days : null,
    images: images.length ? images : null,
  };
}

export function desiredCatalogFields(p) {
  return {
    sku: catalogSku(p),
    name: String(p.name || p.id).trim().slice(0, 200),
    description: String(p.description || '').trim().slice(0, 2000),
    basePriceCents: Number.isInteger(p.price) && p.price >= 0 ? p.price : 0,
    isActive: isPublicProduct(p),
    attributes: ownedAttributes(p),
  };
}

function mergeAttributes(existing, owned) {
  const merged = { ...(existing && typeof existing === 'object' ? existing : {}) };
  for (const key of OWNED_ATTRIBUTES) {
    const value = owned[key];
    if (value === null || value === undefined || value === '') delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

const stable = (value) => JSON.stringify(value, (_k, v) => (
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v
));

/** Fields that differ between the Back Office item and the storefront product. */
export function catalogPatchFor(item, product) {
  const want = desiredCatalogFields(product);
  const patch = {};
  if ((item.sku || '') !== want.sku) patch.sku = want.sku;
  if ((item.name || '') !== want.name) patch.name = want.name;
  if ((item.description || '') !== want.description) patch.description = want.description;
  if (item.basePriceCents !== want.basePriceCents) patch.basePriceCents = want.basePriceCents;
  if (item.isActive !== want.isActive) patch.isActive = want.isActive;
  const attributes = mergeAttributes(item.attributes, want.attributes);
  if (stable(attributes) !== stable(item.attributes || {})) patch.attributes = attributes;
  return patch;
}

export function catalogCreatePayload(product) {
  const want = desiredCatalogFields(product);
  const trackInventory = !isByRequest(product);
  return {
    type: 'product',
    sku: want.sku,
    name: want.name,
    ...(want.description ? { description: want.description } : {}),
    unit: 'each',
    basePriceCents: want.basePriceCents,
    taxable: true,
    attributes: mergeAttributes({}, want.attributes),
    trackInventory,
    // New items start at zero on hand; the shop sets real counts in Back Office.
    ...(trackInventory ? { initialQuantityOnHand: 0 } : {}),
  };
}

export async function getCatalogLink(productId) {
  if (!productId) return null;
  return catalogMapStore().get(String(productId), { type: 'json' }).catch(() => null);
}

export async function productIdForCatalogItem(catalogItemId) {
  const row = await catalogMapStore().get(`${ITEM_PREFIX}${catalogItemId}`, { type: 'json' }).catch(() => null);
  return row?.product_id || null;
}

export async function saveCatalogLink(productId, item) {
  const store = catalogMapStore();
  const previous = await store.get(productId, { type: 'json' }).catch(() => null);
  if (previous?.catalog_item_id && previous.catalog_item_id !== item.id) {
    await store.delete(`${ITEM_PREFIX}${previous.catalog_item_id}`).catch(() => {});
  }
  const link = { catalog_item_id: item.id, sku: item.sku || null, version: item.version ?? null, synced_at: new Date().toISOString() };
  await store.setJSON(productId, link);
  await store.setJSON(`${ITEM_PREFIX}${item.id}`, { product_id: productId });
  return link;
}

export async function catalogLinkCount() {
  const { blobs = [] } = await catalogMapStore().list();
  return blobs.filter((b) => !b.key.startsWith(ITEM_PREFIX)).length;
}

export async function fetchCatalogItem(id) {
  try {
    const { data } = await backOfficeApi('GET', `/catalog/${encodeURIComponent(id)}`);
    return data || null;
  } catch (err) {
    if (err instanceof BackOfficeError && err.status === 404) return null;
    throw err;
  }
}

/** Every non-deleted Back Office product (active and inactive). */
export async function listAllCatalogProducts() {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data = [], meta = {} } = await backOfficeApi('GET', `/catalog?type=product&limit=${PAGE_LIMIT}&page=${page}`);
    items.push(...data);
    if (!meta.hasMore || !data.length) break;
  }
  return items;
}

async function searchBySku(sku) {
  const { data = [] } = await backOfficeApi('GET', `/catalog?type=product&limit=${PAGE_LIMIT}&q=${encodeURIComponent(sku)}`);
  return data;
}

function pickBySku(items, sku, productId) {
  const matches = items.filter((it) => typeof it?.sku === 'string' && it.sku.trim() === sku);
  return matches.find((it) => it.attributes?.storefrontProductId === productId)
    || matches.find((it) => it.isActive)
    || matches[0]
    || null;
}

async function patchWithRetry(item, product) {
  let current = item;
  for (let attempt = 0; attempt < 2; attempt++) {
    const patch = catalogPatchFor(current, product);
    if (!Object.keys(patch).length) return { item: current, changed: false };
    try {
      const { data } = await backOfficeApi('PATCH', `/catalog/${encodeURIComponent(current.id)}`, {
        body: { ...patch, ...(Number.isInteger(current.version) ? { version: current.version } : {}) },
      });
      return { item: data || current, changed: true };
    } catch (err) {
      if (attempt === 0 && err instanceof BackOfficeError && err.code === 'VERSION_CONFLICT') {
        const fresh = await fetchCatalogItem(current.id);
        if (!fresh) throw err;
        current = fresh;
        continue;
      }
      throw err;
    }
  }
  throw new BackOfficeError('Back Office catalog item kept changing; try again', { code: 'VERSION_CONFLICT', status: 409 });
}

/**
 * Upsert one storefront product into the Back Office catalog.
 * Lookup order: stored link → exact SKU match → create (Idempotency-Key
 * `catalog-import-<sku>`). Inactive products are never created.
 * `index` (optional) is a prefetched listing used by bulk sync.
 */
export async function syncProductToBackOffice(product, { index = null } = {}) {
  if (!backOfficeApiConfigured()) return { action: 'disabled' };
  if (!product?.id) return { action: 'skipped', reason: 'missing_id' };
  const sku = catalogSku(product);
  const link = await getCatalogLink(product.id);

  let item = null;
  if (link?.catalog_item_id) {
    item = index ? index.byId.get(link.catalog_item_id) || null : await fetchCatalogItem(link.catalog_item_id);
  }
  if (!item) item = pickBySku(index ? index.items : await searchBySku(sku), sku, product.id);

  if (item) {
    const { item: updated, changed } = await patchWithRetry(item, product);
    await saveCatalogLink(product.id, updated);
    return { action: changed ? 'updated' : 'unchanged', catalogItemId: updated.id, sku };
  }

  if (!isPublicProduct(product)) return { action: 'skipped', reason: 'inactive', sku };

  const { data, replayed } = await backOfficeApi('POST', '/catalog', {
    body: catalogCreatePayload(product),
    idempotencyKey: `catalog-import-${sku}`,
  });
  if (!data?.id) throw new BackOfficeError('Back Office did not return a catalog item id', { code: 'BAD_RESPONSE' });
  await saveCatalogLink(product.id, data);
  if (index) {
    index.items.push(data);
    index.byId.set(data.id, data);
  }
  return { action: replayed ? 'linked' : 'created', catalogItemId: data.id, sku };
}

/**
 * Bulk upsert, SKU-matched against one full catalog listing. Bounded by
 * `budgetMs` so it fits a synchronous function; `remaining` > 0 means run again.
 */
export async function syncCatalogToBackOffice(products, { budgetMs = 8000, concurrency = 4 } = {}) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, remaining: 0, errors: [] };
  if (!backOfficeApiConfigured()) return { ...result, disabled: true };
  const startedAt = Date.now();
  const items = await listAllCatalogProducts();
  const index = { items, byId: new Map(items.map((it) => [it.id, it])) };
  const queue = products.filter((p) => p?.id).slice();
  const seenSkus = new Set();

  async function worker() {
    while (queue.length) {
      const product = queue.shift();
      if (Date.now() - startedAt > budgetMs) {
        result.remaining++;
        continue;
      }
      const sku = catalogSku(product);
      if (seenSkus.has(sku)) {
        result.skipped++;
        result.errors.push({ productId: product.id, sku, error: 'Duplicate SKU on the storefront; give each product a unique SKU.' });
        continue;
      }
      seenSkus.add(sku);
      try {
        const res = await syncProductToBackOffice(product, { index });
        if (res.action === 'created' || res.action === 'linked') result.created++;
        else if (res.action === 'updated') result.updated++;
        else if (res.action === 'unchanged') result.unchanged++;
        else result.skipped++;
      } catch (err) {
        result.failed++;
        if (result.errors.length < 25) result.errors.push({ productId: product.id, sku, error: errorSummary(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return result;
}
