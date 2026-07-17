// Pulls PaymentIntents that succeeded directly in Stripe (Tap to Pay,
// Dashboard-collected card charges, or any other charge not created through
// our own /api/stripe/checkout-session flow) into our own order store, so
// Drew's in-person sales show up in Admin -> Orders next to online ones.
//
// Website checkouts and Stripe Payment Links both create a Checkout Session
// under the hood, so they're already fully handled by
// stripe-webhook.mjs's checkout.session.completed handler. This module only
// needs to handle PaymentIntents that were NEVER attached to any Checkout
// Session at all — pure Tap to Pay / manually-collected card charges.

import { stripe, orderStore } from './stripe.mjs';

/**
 * True if this PaymentIntent is (or ever was) attached to a Checkout Session
 * — meaning it's already handled by the checkout.session.completed flow and
 * must NOT also be imported as a standalone order (would duplicate it).
 */
async function hasCheckoutSession(paymentIntentId, stripeAccountId) {
  try {
    const list = await stripe().checkout.sessions.list(
      { payment_intent: paymentIntentId, limit: 1 },
      stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
    );
    return (list.data || []).length > 0;
  } catch (err) {
    console.warn('[stripe-order-sync] session lookup failed', err?.message);
    // Fail safe: if we can't tell, don't risk duplicating — skip import.
    return true;
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
 * Import one succeeded PaymentIntent as an order, if it isn't already
 * represented (either as this same standalone record, or via an existing
 * Checkout Session-based order). Safe to call repeatedly.
 * @returns {Promise<{action: 'imported'|'skipped', reason?: string}>}
 */
export async function importPaymentIntentAsOrder(pi, tenantId, stripeAccountId) {
  if (!pi || pi.status !== 'succeeded') return { action: 'skipped', reason: 'not_succeeded' };

  const store = orderStore();

  // Already imported (as a standalone record) — idempotent against retries.
  const existing = await store.get(pi.id, { type: 'json' }).catch(() => null);
  if (existing) return { action: 'skipped', reason: 'already_imported' };

  // Covered by a Checkout Session (our own website checkout OR a Stripe
  // Payment Link) — that flow already persists (or will persist) the order.
  if (await hasCheckoutSession(pi.id, stripeAccountId)) {
    return { action: 'skipped', reason: 'has_checkout_session' };
  }

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
        const res = await importPaymentIntentAsOrder(pi, tenant.id, acctId);
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
