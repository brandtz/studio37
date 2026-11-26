// Storefront-side Back Office operations used by the admin API, the MCP
// endpoint and the scheduled retry job. Not reachable from the Stripe
// webhook or quote intake, so it may use the full store helpers.

import { ensureProductSeeded, productStore, leadStore, nowIso, slugify, logAudit } from './store.mjs';
import { resolveTenant, tenantHasAccount } from './stripe.mjs';
import { syncOneProductToStripe } from './stripe-product-sync.mjs';
import { sanitizeProduct } from './product-sanitize.mjs';
import { backOfficeApiConfigured, backOfficeConfig, isUuid, websiteWebhookConfigured } from './backoffice.mjs';
import {
  absoluteImage, catalogLinkCount, catalogSku, fetchCatalogItem, getCatalogLink,
  productIdForCatalogItem, saveCatalogLink, syncCatalogToBackOffice, syncProductToBackOffice,
} from './backoffice-catalog.mjs';
import { leadSyncHandler } from './backoffice-leads.mjs';
import { orderSyncHandler } from './backoffice-orders.mjs';
import { outboxSummary, retryOutbox } from './backoffice-sync.mjs';

export const syncHandlers = { lead: leadSyncHandler, order: orderSyncHandler };
const IMPORT_STATUSES = new Set(['available', 'out_of_stock', 'by_request']);

export function retryBackOfficeSyncs(opts) {
  return retryOutbox(syncHandlers, opts);
}

export async function listStorefrontProducts() {
  await ensureProductSeeded();
  const store = productStore();
  const { blobs = [] } = await store.list();
  const out = [];
  for (const { key } of blobs) {
    if (key.startsWith('_')) continue;
    const p = await store.get(key, { type: 'json' });
    if (p) out.push({ ...p, id: p.id || key });
  }
  return out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

/** Upsert every storefront product (or one, by id) into the Back Office catalog. */
export async function syncStorefrontCatalog({ productId = null, budgetMs } = {}) {
  const products = await listStorefrontProducts();
  if (productId) {
    const product = products.find((p) => p.id === productId);
    if (!product) return { ok: false, status: 404, error: 'product_not_found' };
    return { ok: true, ...(await syncProductToBackOffice(product)) };
  }
  return { ok: true, ...(await syncCatalogToBackOffice(products, { budgetMs })) };
}

export async function productsWithLinks() {
  const products = await listStorefrontProducts();
  const linked = backOfficeApiConfigured();
  const out = [];
  for (const p of products) {
    const link = linked ? await getCatalogLink(p.id) : null;
    out.push({
      id: p.id,
      name: p.name,
      sku: catalogSku(p),
      price_cents: Number.isInteger(p.price) ? p.price : null,
      status: p.status,
      published: p.status !== 'archived',
      backofficeCatalogItemId: link?.catalog_item_id || null,
      backofficeSyncedAt: link?.synced_at || null,
    });
  }
  return out;
}

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);

async function findProductForItem(item) {
  const store = productStore();
  const candidates = [await productIdForCatalogItem(item.id), text(item.attributes?.storefrontProductId, 80)];
  for (const id of candidates) {
    if (!id) continue;
    const product = await store.get(id, { type: 'json' });
    if (product) return product;
  }
  const sku = text(item.sku, 80);
  if (!sku) return null;
  return (await listStorefrontProducts()).find((p) => catalogSku(p) === sku) || null;
}

async function uniqueProductId(base) {
  const store = productStore();
  const root = slugify(base) || 'product';
  for (let n = 1; n < 50; n++) {
    const id = n === 1 ? root : `${root.slice(0, 56)}-${n}`;
    if (!await store.get(id, { type: 'json' })) return id;
  }
  return `${root.slice(0, 50)}-${Date.now().toString(36)}`;
}

/**
 * Create or update a storefront listing from a verified Back Office product.
 * → { ok, action: 'created'|'updated', product } | { ok: false, status, error }
 */
export async function importCatalogItemToStorefront(catalogItemId, { status = null, actor = 'Back Office import', req = null } = {}) {
  if (!backOfficeApiConfigured()) return { ok: false, status: 503, error: 'backoffice_api_not_configured' };
  if (!isUuid(catalogItemId)) return { ok: false, status: 400, error: 'invalid_catalog_item_id' };
  if (status !== null && !IMPORT_STATUSES.has(status)) return { ok: false, status: 400, error: 'invalid_status' };

  const item = await fetchCatalogItem(catalogItemId);
  if (!item) return { ok: false, status: 404, error: 'catalog_item_not_found' };
  if (item.type !== 'product') return { ok: false, status: 422, error: 'not_a_product' };
  if (item.verified === false) return { ok: false, status: 422, error: 'catalog_item_not_verified' };
  if (item.isActive === false) return { ok: false, status: 422, error: 'catalog_item_inactive' };

  await ensureProductSeeded();
  const store = productStore();
  const existing = await findProductForItem(item);
  const attrs = item.attributes && typeof item.attributes === 'object' ? item.attributes : {};
  const images = Array.isArray(attrs.images)
    ? attrs.images.map(absoluteImage).filter(Boolean)
    : (existing?.images || []).map(absoluteImage).filter(Boolean);
  const fields = {
    name: text(item.name, 200),
    description: typeof item.description === 'string' ? item.description.slice(0, 2000) : '',
    price: Number.isInteger(item.basePriceCents) && item.basePriceCents > 0 ? item.basePriceCents : null,
    images,
  };
  for (const [key, value] of [
    ['sku', text(item.sku, 40)],
    ['subtitle', text(attrs.subtitle, 160)],
    ['category', text(attrs.category, 60)],
    ['dimensions', text(attrs.dimensions, 120)],
    ['materials', text(attrs.materials, 240)],
    ['lead_time_days', Number.isInteger(attrs.leadTimeDays) ? attrs.leadTimeDays : undefined],
  ]) {
    if (value !== undefined) fields[key] = value;
  }

  let product;
  if (existing) {
    // Publishing means listing it: an archived match is brought back.
    const fallback = existing.status === 'archived' ? (attrs.byRequest === true ? 'by_request' : 'available') : existing.status;
    const nextStatus = status || fallback;
    product = sanitizeProduct({ ...existing, ...fields, status: nextStatus, by_request: nextStatus === 'by_request', id: existing.id, updated_at: nowIso() });
  } else {
    const id = await uniqueProductId(text(attrs.storefrontProductId, 60) || item.name);
    const nextStatus = status || (attrs.byRequest === true ? 'by_request' : 'available');
    product = sanitizeProduct({
      category: 'custom',
      shipping: true,
      ...fields,
      id,
      status: nextStatus,
      by_request: nextStatus === 'by_request',
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
  if (!product.name) return { ok: false, status: 422, error: 'catalog_item_missing_name' };

  await store.setJSON(product.id, product);
  await saveCatalogLink(product.id, item);
  await logAudit({
    actor,
    action: existing ? 'product.update' : 'product.create',
    entity: 'product',
    entity_id: product.id,
    before: existing || null,
    after: product,
    req,
    meta: { source: 'backoffice_import', catalog_item_id: item.id },
  });

  // Keep Stripe and the Back Office storefront attributes in step, best-effort.
  try {
    const tenant = await resolveTenant('studio37');
    if (tenantHasAccount(tenant)) await syncOneProductToStripe(tenant, product);
  } catch (err) {
    console.warn('[backoffice-import] Stripe sync failed for', product.id, err?.message || err);
  }
  try {
    await syncProductToBackOffice(product);
  } catch {
    console.warn('[backoffice-import] Back Office attribute refresh failed for', product.id);
  }

  return { ok: true, action: existing ? 'updated' : 'created', product };
}

/** Newest leads with their Back Office sync state — minimal PII. */
export async function recentLeads(limit = 20) {
  const store = leadStore();
  const { blobs = [] } = await store.list();
  const keys = blobs.map((b) => b.key).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, limit);
  const out = [];
  for (const key of keys) {
    const lead = await store.get(key, { type: 'json' });
    if (!lead) continue;
    const sync = lead.backoffice_sync || {};
    out.push({
      id: lead.id || key,
      created_at: lead.created_at || null,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || null,
      service: lead.quotePresentation?.labels?.service || lead.service || null,
      backoffice_sync_state: sync.state || 'not_synced',
      backoffice_customer_id: sync.customer_id || null,
      backoffice_synced_at: sync.synced_at || null,
      backoffice_error: sync.error || null,
    });
  }
  return out;
}

export async function backOfficeStatus() {
  const cfg = backOfficeConfig();
  const configured = {
    base_url: cfg.baseUrl,
    tenant_slug: cfg.tenantSlug,
    api_key: !!cfg.apiKey,
    website_webhook_secret: websiteWebhookConfigured(),
    outbound_webhook_secret: !!cfg.outboundSecret,
    mcp: (process.env.STOREFRONT_MCP_TOKEN || '').trim().length >= 32,
  };
  const anyConfigured = configured.api_key || configured.website_webhook_secret;
  return {
    configured,
    outbound_webhook_url: `${String(process.env.SITE_URL || process.env.URL || 'https://studio37customdesigns.com').replace(/\/+$/, '')}/api/webhooks/backoffice`,
    outbox: anyConfigured ? await outboxSummary() : { count: 0, entries: [] },
    linked_products: anyConfigured ? await catalogLinkCount() : 0,
  };
}
