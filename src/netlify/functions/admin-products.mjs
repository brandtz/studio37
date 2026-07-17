// /api/admin/products[?id=:id]
// Admin CRUD on the products blob store. Auth via X-Admin-Key.

import { ensureProductSeeded, productStore, json, nowIso, slugify, logAudit } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import { resolveTenant, tenantHasAccount } from './_lib/stripe.mjs';
import { syncOneProductToStripe, deactivateStripeProduct } from './_lib/stripe-product-sync.mjs';

// Best-effort push to Stripe — never blocks or fails a product save. Mirrors
// the SMS/email pattern used elsewhere in this codebase: if Stripe isn't
// connected yet, or the API call errors, we log and move on.
async function bestEffortStripeSync(product) {
  try {
    const tenant = await resolveTenant('studio37');
    if (!tenantHasAccount(tenant)) return;
    await syncOneProductToStripe(tenant, product);
  } catch (err) {
    console.warn('[admin-products] Stripe sync failed for', product?.id, err?.message || err);
  }
}

async function bestEffortStripeDeactivate(product) {
  try {
    const tenant = await resolveTenant('studio37');
    if (!tenantHasAccount(tenant)) return;
    await deactivateStripeProduct(tenant, product);
  } catch (err) {
    console.warn('[admin-products] Stripe deactivate failed for', product?.id, err?.message || err);
  }
}

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  const actor = auth.user?.email || 'unknown';

  await ensureProductSeeded();

  const url = new URL(req.url);
  // Resolve the product id from any of the supported places, in order:
  //   1. Functions v2 path params (`/api/admin/products/:id`)
  //   2. Query string `?id=...` (legacy redirect)
  //   3. The pathname itself (the last segment after `products`)
  // This is bulletproof against Netlify routing variations.
  const pathSegs = url.pathname.split('/').filter(Boolean);
  const tailSeg = pathSegs[pathSegs.length - 1] || '';
  const idFromPath = (tailSeg && tailSeg !== 'products' && tailSeg !== 'admin-products')
    ? decodeURIComponent(tailSeg)
    : null;
  const id = req.params?.id || url.searchParams.get('id') || idFromPath || null;
  const store = productStore();

  // ── GET (list all, including archived) ──
  if (req.method === 'GET') {
    const out = [];
    const { blobs } = await store.list();
    for (const b of blobs) {
      if (b.key.startsWith('_')) continue; // skip internal meta keys
      const p = await store.get(b.key, { type: 'json' });
      if (p) out.push({ ...p, id: p.id || b.key }); // ensure id always set
    }
    out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    return json(out);
  }

  // ── POST (create) ──
  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body || !body.name) return json({ error: 'name required' }, 400);
    const productId = body.id || slugify(body.name);
    const existing = await store.get(productId, { type: 'json' });
    if (existing) return json({ error: 'id already exists' }, 409);
    const product = sanitize({ ...body, id: productId, created_at: nowIso(), updated_at: nowIso() });
    await store.setJSON(productId, product);
    await logAudit({ actor, action: 'product.create', entity: 'product', entity_id: productId, after: product, req });
    if (product.status === 'archived') await bestEffortStripeDeactivate(product);
    else await bestEffortStripeSync(product);
    return json(product, 201);
  }

  // ── PUT (update) ──
  if (req.method === 'PUT') {
    if (!id) return json({ error: 'id required' }, 400);
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'invalid body' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    const updated = sanitize({ ...existing, ...body, id, updated_at: nowIso() });
    await store.setJSON(id, updated);
    await logAudit({ actor, action: 'product.update', entity: 'product', entity_id: id, before: existing, after: updated, req });
    if (updated.status === 'archived') await bestEffortStripeDeactivate(updated);
    else await bestEffortStripeSync(updated);
    return json(updated);
  }

  // ── DELETE (soft-delete -> status:archived) ──
  if (req.method === 'DELETE') {
    if (!id) return json({ error: 'id required' }, 400);
    const existing = await store.get(id, { type: 'json' });
    if (!existing) return json({ error: 'not_found' }, 404);
    const updated = { ...existing, status: 'archived', updated_at: nowIso() };
    await store.setJSON(id, updated);
    await logAudit({ actor, action: 'product.archive', entity: 'product', entity_id: id, before: existing, after: updated, req });
    await bestEffortStripeDeactivate(updated);
    return json(updated);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

function sanitize(p) {
  const allowed = [
    'id', 'name', 'subtitle', 'price', 'description', 'category',
    'images', 'status', 'by_request', 'shipping', 'weight_oz',
    'sku', 'dimensions', 'materials', 'lead_time_days',
    'created_at', 'updated_at',
  ];
  const out = {};
  for (const k of allowed) if (k in p) out[k] = p[k];
  // Coerce types defensively
  if (typeof out.price === 'string') out.price = parseInt(out.price, 10) || null;
  if (typeof out.weight_oz === 'string') out.weight_oz = parseInt(out.weight_oz, 10) || 0;
  if (typeof out.lead_time_days === 'string') out.lead_time_days = parseInt(out.lead_time_days, 10) || null;
  if (typeof out.sku === 'string') out.sku = out.sku.trim().slice(0, 40);
  if (typeof out.dimensions === 'string') out.dimensions = out.dimensions.trim().slice(0, 120);
  if (typeof out.materials === 'string') out.materials = out.materials.trim().slice(0, 240);
  // Image URL validation: only http(s), cap at 8, sane length.
  out.images = Array.isArray(out.images)
    ? out.images
        .filter((u) => typeof u === 'string' && u.length <= 1000 && /^https?:\/\//i.test(u))
        .slice(0, 8)
    : [];
  out.status = ['available', 'out_of_stock', 'by_request', 'archived'].includes(out.status)
    ? out.status
    : 'available';
  return out;
}

export const config = {
  path: ['/api/admin/products', '/api/admin/products/:id'],
};
