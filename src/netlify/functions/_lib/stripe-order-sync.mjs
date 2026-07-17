// Pulls Stripe payments into our own order store so they show up in
// Admin -> Orders, covering two cases:
//   1. Standalone in-person charges (Tap to Pay, or anything collected
//      directly in the Stripe Dashboard) that never touch a Checkout
//      Session at all — these aren't captured by the normal
//      checkout.session.completed webhook handler in stripe-webhook.mjs.
//   2. Website checkouts / Stripe Payment Links whose checkout.session.completed
//      webhook was never successfully delivered or processed (e.g. a
//      misconfigured webhook destination) — backfilled here as a safety net,
//      built the same way stripe-webhook.mjs normally would.
//
// Both the webhook (going forward) and the "Import historical payments"
// admin action (on demand / backfill) share this same logic, so a payment is
// never recorded twice no matter which path finds it first.

import { stripe, orderStore } from './stripe.mjs';

/**
 * Find the Checkout Session (if any) this PaymentIntent belongs to. Website
 * checkouts and Stripe Payment Links both create one; pure Tap to Pay /
 * Dashboard-collected charges never do.
 */
async function findCheckoutSessionForPaymentIntent(paymentIntentId, stripeAccountId) {
  try {
    const list = await stripe().checkout.sessions.list(
      { payment_intent: paymentIntentId, limit: 1 },
      stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
    );
    return (list.data || [])[0] || null;
  } catch (err) {
    console.warn('[stripe-order-sync] session lookup failed', err?.message);
    return undefined; // undefined = "couldn't tell" (distinct from null = "none found")
  }
}

function buildStandaloneOrder(pi, tenantId, stripeAccountId) {
  const nowIso = new Date().toISOString();
  const createdIso = new Date((pi.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const billing = charge?.billing_details || {};

  return {
    id: pi.id,
    tenant_id: tenantId,
    stripe_account_id: stripeAccountId || null,
    payment_intent: pi.id,
    source: 'stripe_direct', // vs 'website_checkout' — surfaced in Admin as "In-person"
    customer_email: pi.receipt_email || billing.email || null,
    customer_name: billing.name || null,
    customer_phone: billing.phone || null,
    shipping_address: null,
    shipping_name: null,
    amount_subtotal: pi.amount,
    amount_total: pi.amount,
    currency: pi.currency,
    payment_status: 'paid',
    status: 'complete',
    created_at: createdIso,
    items: [{
      description: pi.description || 'In-person sale (collected via Stripe)',
      quantity: 1,
      amount_total: pi.amount,
      product_id: null,
    }],
    // In-person sales are handed over on the spot — default straight to
    // complete. Admin can still change this if it was actually a deposit
    // on custom work that isn't finished yet.
    lifecycle: 'complete',
    lifecycle_at: nowIso,
    tracking_number: null,
    tracking_carrier: null,
    internal_notes: '',
    status_history: [{ stage: 'complete', at: nowIso, by: 'system (in-person Stripe payment)' }],
    // Not applicable to in-person sales — mark as handled so nothing tries
    // to notify Drew about a sale he was standing right there for.
    sms_sent: true,
    sms_sent_at: nowIso,
    email_sent: true,
    email_sent_at: nowIso,
    email_id: null,
  };
}

/**
 * Build an order the same way stripe-webhook.mjs's checkout.session.completed
 * handler normally would. Shared so a backfilled website order looks
 * identical to one captured live by the webhook.
 */
export async function buildOrderFromCheckoutSession(session, stripeAccountId, { historicalImport = false } = {}) {
  const tenantId = session?.metadata?.tenant_id || 'studio37';
  let lineItems = [];
  try {
    const list = await stripe().checkout.sessions.listLineItems(
      session.id,
      { limit: 50 },
      stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
    );
    lineItems = list.data || [];
  } catch (err) {
    console.warn('[stripe-order-sync] could not fetch line items for', session.id, err?.message);
  }

  const nowIso = new Date().toISOString();
  return {
    id: session.id,
    tenant_id: tenantId,
    stripe_account_id: stripeAccountId || null,
    source: 'website_checkout',
    payment_intent: session.payment_intent || null,
    customer_email: session.customer_details?.email || session.customer_email || null,
    customer_name: session.customer_details?.name || null,
    customer_phone: session.customer_details?.phone || null,
    shipping_address: session.shipping_details?.address || null,
    shipping_name: session.shipping_details?.name || null,
    amount_subtotal: session.amount_subtotal,
    amount_total: session.amount_total,
    currency: session.currency,
    payment_status: session.payment_status,
    status: session.status,
    created_at: new Date((session.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    items: lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      amount_total: li.amount_total,
      product_id: li.price?.product_metadata?.product_id || li.price?.metadata?.product_id || null,
    })),
    lifecycle: 'new',
    lifecycle_at: nowIso,
    tracking_number: null,
    tracking_carrier: null,
    internal_notes: '',
    status_history: [{ stage: 'new', at: nowIso, by: historicalImport ? 'system (backfilled from Stripe)' : 'system' }],
    // A live order (created via the webhook) should still get Drew's normal
    // SMS/email notification — whichever event fires first, checkout.session
    // .completed or payment_intent.succeeded, sends it; the other sees the
    // flags already true and skips (see maybeSendOrderSms/maybeSendOrderEmail
    // in stripe-webhook.mjs). Only a deliberate historical backfill (an order
    // that may be days old) skips notification entirely — a late SMS/email
    // about a stale order would just be confusing.
    sms_sent: historicalImport,
    sms_sent_at: historicalImport ? nowIso : null,
    email_sent: historicalImport,
    email_sent_at: historicalImport ? nowIso : null,
    email_id: null,
  };
}

/**
 * Import one succeeded PaymentIntent as an order, if it isn't already
 * represented. Handles two cases:
 *   - It belongs to a Checkout Session (website checkout / Payment Link)
 *     whose order was never persisted (e.g. a missed webhook) — backfilled
 *     using the same shape the webhook would have produced.
 *   - It's a standalone charge with no Checkout Session at all (Tap to Pay /
 *     Dashboard) — recorded directly as a completed in-person sale.
 * Safe to call repeatedly; never creates a duplicate either way.
 * @returns {Promise<{action: 'imported'|'skipped', reason?: string}>}
 */
export async function importPaymentIntentAsOrder(pi, tenantId, stripeAccountId, { historicalImport = false } = {}) {
  if (!pi || pi.status !== 'succeeded') return { action: 'skipped', reason: 'not_succeeded' };

  const store = orderStore();

  // Already imported as a standalone record — idempotent against retries.
  const existingStandalone = await store.get(pi.id, { type: 'json' }).catch(() => null);
  if (existingStandalone) return { action: 'skipped', reason: 'already_imported' };

  const session = await findCheckoutSessionForPaymentIntent(pi.id, stripeAccountId);

  if (session === undefined) {
    // Couldn't determine either way (Stripe API hiccup) — don't risk a
    // duplicate; skip and let the next run try again.
    return { action: 'skipped', reason: 'lookup_failed' };
  }

  if (session) {
    // Belongs to a Checkout Session — check whether THAT order already exists.
    const existingSessionOrder = await store.get(session.id, { type: 'json' }).catch(() => null);
    if (existingSessionOrder) return { action: 'skipped', reason: 'has_checkout_session' };

    const order = await buildOrderFromCheckoutSession(session, stripeAccountId, { historicalImport });
    await store.setJSON(order.id, order);
    return { action: 'imported', order };
  }

  // No Checkout Session anywhere — a genuine standalone in-person charge.
  const order = buildStandaloneOrder(pi, tenantId, stripeAccountId);
  await store.setJSON(order.id, order);
  return { action: 'imported', order };
}

/**
 * Scan the connected account's recent succeeded PaymentIntents and import
 * any that aren't yet tracked. Used by the manual "Import historical Stripe
 * payments" admin action to backfill in-person sales made before this
 * automatic capture existed (or if a webhook delivery was ever missed).
 */
export async function importHistoricalPayments(tenant, { days = 90 } = {}) {
  const acctId = tenant.stripe_account_id;
  const results = { imported: 0, skipped: 0, failed: 0, errors: [] };
  if (!acctId) return results;

  const gte = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const params = { created: { gte }, limit: 100, expand: ['data.latest_charge'] };

  let startingAfter;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await stripe().paymentIntents.list(
      { ...params, starting_after: startingAfter },
      { stripeAccount: acctId },
    );
    for (const pi of page.data) {
      if (pi.status !== 'succeeded') { results.skipped++; continue; }
      try {
        const res = await importPaymentIntentAsOrder(pi, tenant.id, acctId, { historicalImport: true });
        if (res.action === 'imported') results.imported++;
        else results.skipped++;
      } catch (err) {
        console.error('[stripe-order-sync] import failed for', pi.id, err?.message || err);
        results.failed++;
        results.errors.push({ id: pi.id, message: err?.message || 'unknown_error' });
      }
    }
    if (!page.has_more || !page.data.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return results;
}
