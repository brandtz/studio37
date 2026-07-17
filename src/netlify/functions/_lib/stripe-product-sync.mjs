// Shared logic for pushing our product catalog into a tenant's connected
// Stripe account as real Products/Prices, so Drew can find and charge for
// them from the Stripe Dashboard app (or build Payment Links) during
// in-person sales — without re-typing names/prices by hand.
//
// Used both by the one-click "Sync products to Stripe" admin button (bulk,
// catches up anything created before Stripe was connected or that failed to
// sync) and automatically after every product create/update/archive in
// admin-products.mjs (best-effort — never blocks a product save).

import { getStore } from '@netlify/blobs';
import { stripe } from './stripe.mjs';

// Maps our internal product id -> { stripe_product_id, stripe_price_id, price,
// name } per tenant, so repeat syncs update existing Stripe products/prices
// instead of creating duplicates. Stripe Prices are immutable, so a price
// change creates a new Price and archives the old one.
export function stripeProductMapStore() {
  return getStore({ name: 'stripe_product_map', consistency: 'strong' });
}

/**
 * Create or update a single product's Stripe Product + Price on the given
 * tenant's connected account. No-op (returns { action: 'skipped' }) if the
 * tenant has no connected account or the product has no valid price.
 */
export async function syncOneProductToStripe(tenant, p) {
  if (!tenant?.stripe_account_id) return { action: 'skipped', reason: 'no_account' };
  if (!p || typeof p.price !== 'number' || p.price <= 0) return { action: 'skipped', reason: 'no_price' };

  const acctId = tenant.stripe_account_id;
  const mapStore = stripeProductMapStore();
  const mapping = await mapStore.get(p.id, { type: 'json' });
  const images = (p.images || []).slice(0, 8).filter((u) => /^https?:\/\//i.test(u));
  const description = (p.subtitle || p.description || '').slice(0, 500) || undefined;

  if (!mapping || !mapping.stripe_product_id) {
    const product = await stripe().products.create({
      name: p.name,
      description,
      images,
      metadata: { studio37_product_id: p.id, sku: p.sku || '' },
    }, { stripeAccount: acctId });
    const price = await stripe().prices.create({
      product: product.id,
      unit_amount: p.price,
      currency: tenant.currency || 'usd',
    }, { stripeAccount: acctId });
    await stripe().products.update(product.id, { default_price: price.id }, { stripeAccount: acctId });
    await mapStore.setJSON(p.id, {
      stripe_product_id: product.id,
      stripe_price_id: price.id,
      price: p.price,
      name: p.name,
      updated_at: new Date().toISOString(),
    });
    return { action: 'created', stripe_product_id: product.id };
  }

  if (mapping.price !== p.price || mapping.name !== p.name) {
    await stripe().products.update(mapping.stripe_product_id, {
      name: p.name,
      description,
      images,
    }, { stripeAccount: acctId });
    let priceId = mapping.stripe_price_id;
    if (mapping.price !== p.price) {
      const newPrice = await stripe().prices.create({
        product: mapping.stripe_product_id,
        unit_amount: p.price,
        currency: tenant.currency || 'usd',
      }, { stripeAccount: acctId });
      await stripe().products.update(mapping.stripe_product_id, { default_price: newPrice.id }, { stripeAccount: acctId });
      if (mapping.stripe_price_id) {
        await stripe().prices.update(mapping.stripe_price_id, { active: false }, { stripeAccount: acctId }).catch(() => {});
      }
      priceId = newPrice.id;
    }
    await mapStore.setJSON(p.id, {
      stripe_product_id: mapping.stripe_product_id,
      stripe_price_id: priceId,
      price: p.price,
      name: p.name,
      updated_at: new Date().toISOString(),
    });
    return { action: 'updated', stripe_product_id: mapping.stripe_product_id };
  }

  return { action: 'skipped', reason: 'unchanged' };
}

/**
 * Deactivate a product's Stripe Product + Price (archive/soft-delete on our
 * side). Stripe products with usage history generally can't be hard-deleted,
 * so we mark them inactive instead — they disappear from the Dashboard's
 * default catalog view but remain on past invoices/payments.
 */
export async function deactivateStripeProduct(tenant, p) {
  if (!tenant?.stripe_account_id || !p) return { action: 'skipped' };
  const acctId = tenant.stripe_account_id;
  const mapStore = stripeProductMapStore();
  const mapping = await mapStore.get(p.id, { type: 'json' });
  if (!mapping?.stripe_product_id) return { action: 'skipped', reason: 'not_synced' };

  if (mapping.stripe_price_id) {
    await stripe().prices.update(mapping.stripe_price_id, { active: false }, { stripeAccount: acctId }).catch(() => {});
  }
  await stripe().products.update(mapping.stripe_product_id, { active: false }, { stripeAccount: acctId });
  return { action: 'deactivated', stripe_product_id: mapping.stripe_product_id };
}

/**
 * Bulk sync every non-archived, priced product in the catalog. Used by the
 * manual "Sync products to Stripe" admin button.
 */
export async function syncAllProductsToStripe(tenant, productStore) {
  const results = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const { blobs } = await productStore.list();

  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const p = await productStore.get(b.key, { type: 'json' });
    if (!p) continue;
    if (p.status === 'archived') { results.skipped++; continue; }
    try {
      const res = await syncOneProductToStripe(tenant, p);
      if (res.action === 'created') results.created++;
      else if (res.action === 'updated') results.updated++;
      else results.skipped++;
    } catch (err) {
      console.error('[stripe-product-sync] failed for', p.id, err?.message || err);
      results.failed++;
      results.errors.push({ id: p.id, message: err?.message || 'unknown_error' });
    }
  }

  return results;
}
