// POST /api/stripe/webhook
// Receives Stripe webhook events from two destinations:
//   1. STRIPE_WEBHOOK_SECRET       — "Connected accounts" scope (checkout, payment_intent)
//   2. STRIPE_WEBHOOK_SECRET_PLATFORM — "Your account" scope (account.updated, deauthorized)
// Tries both secrets; whichever verifies wins.
//
// IMPORTANT: this function MUST receive the raw request body (not parsed JSON)
// for signature verification. Netlify Functions v2 (`req.text()`) preserves it.

import twilio from 'twilio';
import { json } from './_lib/store.mjs';
import { stripe, orderStore } from './_lib/stripe.mjs';
import { sendOrderConfirmation } from './_lib/email.mjs';
import { importPaymentIntentAsOrder } from './_lib/stripe-order-sync.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const sig = req.headers.get('stripe-signature');
  if (!sig) return json({ error: 'missing_signature' }, 400);

  const raw = await req.text();

  // Try both secrets — connected-accounts destination first, then platform destination.
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_WEBHOOK_SECRET_PLATFORM,
  ].filter(Boolean);

  if (!secrets.length) return json({ error: 'webhook_not_configured' }, 503);

  let evt = null;
  for (const secret of secrets) {
    try {
      evt = stripe().webhooks.constructEvent(raw, sig, secret);
      break; // verified
    } catch { /* try next */ }
  }

  if (!evt) {
    console.warn('[stripe-webhook] signature verification failed against all configured secrets');
    return json({ error: 'invalid_signature' }, 400);
  }

  // `evt.account` is set when the event came from a connected account.
  const connectedAccount = evt.account || null;

  try {
    switch (evt.type) {
      case 'checkout.session.completed':
        await onCheckoutComplete(evt.data.object, connectedAccount);
        break;
      case 'payment_intent.succeeded':
        // Only standalone charges (Tap to Pay / manually collected in Stripe)
        // reach this path — website checkouts and Payment Links are already
        // fully handled above via checkout.session.completed, and
        // importPaymentIntentAsOrder() detects + skips those to avoid
        // duplicating the order.
        await onPaymentIntentSucceeded(evt.data.object, connectedAccount);
        break;
      case 'payment_intent.payment_failed':
        console.warn('[stripe-webhook] payment failed', evt.data.object?.id, evt.data.object?.last_payment_error?.message);
        break;
      case 'account.updated':
        // Connected account onboarding/requirements changed. We don't persist this
        // yet — the admin Connect tab fetches live status on demand.
        break;
      case 'account.application.deauthorized':
        // Client disconnected the platform from their account.
        // TODO: mark tenant inactive; out of scope for first pass.
        break;
      default:
        // Many events we don't handle yet — return 200 so Stripe doesn't retry.
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error', err);
    // Return 200 so Stripe doesn't retry forever; we log for follow-up.
  }

  return json({ received: true });
};

async function onPaymentIntentSucceeded(pi, connectedAccount) {
  try {
    const tenantId = pi?.metadata?.tenant_id || 'studio37';
    const res = await importPaymentIntentAsOrder(pi, tenantId, connectedAccount);
    if (res.action === 'imported') {
      console.log('[stripe-webhook] imported standalone in-person payment as order', pi.id);
    }
  } catch (err) {
    console.error('[stripe-webhook] payment_intent.succeeded handling failed', err);
  }
}

async function onCheckoutComplete(session, connectedAccount) {
  const tenantId = session?.metadata?.tenant_id || 'studio37';

  // IDEMPOTENCY: if we've already persisted this session, skip the heavy work.
  // Stripe will retry on 5xx/timeout — without this guard we'd duplicate orders
  // and double-text Drew.
  let existing = null;
  try {
    existing = await orderStore().get(session.id, { type: 'json' });
  } catch { /* treat as not-found */ }

  if (existing && existing.id === session.id) {
    if (existing.sms_sent && existing.email_sent) {
      console.log('[stripe-webhook] duplicate event (already notified), skipping', session.id);
      return;
    }
    // Order persisted previously but a notification hadn't yet succeeded — retry only the missing pieces.
    await maybeSendOrderSms(existing);
    await maybeSendOrderEmail(existing);
    return;
  }

  // Fetch line items expanded — Stripe doesn't include them on the bare session.
  let lineItems = [];
  try {
    const list = await stripe().checkout.sessions.listLineItems(session.id, { limit: 50 }, connectedAccount ? { stripeAccount: connectedAccount } : undefined);
    lineItems = list.data || [];
  } catch (err) {
    console.warn('[stripe-webhook] could not fetch line items', err?.message);
  }

  const nowIso = new Date().toISOString();
  const order = {
    id: session.id,
    tenant_id: tenantId,
    stripe_account_id: connectedAccount,
    source: 'website_checkout', // vs 'stripe_direct' — surfaced in Admin as "Online"
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
    // Lifecycle (Epic 4): admin-controlled stages independent of Stripe payment_status.
    lifecycle: 'new',
    lifecycle_at: nowIso,
    tracking_number: null,
    tracking_carrier: null,
    internal_notes: '',
    status_history: [{ stage: 'new', at: nowIso, by: 'system' }],
    sms_sent: false,
    sms_sent_at: null,
    email_sent: false,
    email_sent_at: null,
    email_id: null,
  };

  try {
    await orderStore().setJSON(order.id, order);
  } catch (err) {
    console.error('[stripe-webhook] persist order failed', err);
  }

  await maybeSendOrderSms(order);
  await maybeSendOrderEmail(order);
}

async function maybeSendOrderSms(order) {
  if (order.sms_sent) return;
  const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, DREW_PHONE } = process.env;
  if (!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DREW_PHONE)) return;

  try {
    const summary = (order.items || []).map((i) => `${i.quantity}× ${i.description}`).join(', ').slice(0, 240);
    const total = order.amount_total != null ? `$${(order.amount_total / 100).toFixed(2)}` : '';
    const msg = [
      `🛒 New Studio 37 Order!`,
      summary ? `Items: ${summary}` : null,
      total ? `Total: ${total}` : null,
      order.customer_name ? `Buyer: ${order.customer_name}` : null,
      `Stripe → studio37customdesign.netlify.app/admin (Orders)`,
    ].filter(Boolean).join('\n');
    const client = twilio(TWILIO_SID, TWILIO_TOKEN);
    await client.messages.create({ from: TWILIO_FROM, to: DREW_PHONE, body: msg });

    // Mark SMS as sent so a Stripe retry doesn't re-text.
    try {
      const latest = (await orderStore().get(order.id, { type: 'json' })) || order;
      await orderStore().setJSON(order.id, { ...latest, sms_sent: true, sms_sent_at: new Date().toISOString() });
    } catch (err) {
      console.warn('[stripe-webhook] could not flag sms_sent', err?.message);
    }
  } catch (err) {
    console.error('[stripe-webhook] SMS failed', err?.message || err);
  }
}

async function maybeSendOrderEmail(order) {
  if (order.email_sent) return;
  if (!order.customer_email) return;

  const result = await sendOrderConfirmation(order);
  if (!result.ok) return;

  try {
    const latest = (await orderStore().get(order.id, { type: 'json' })) || order;
    await orderStore().setJSON(order.id, {
      ...latest,
      email_sent: true,
      email_sent_at: new Date().toISOString(),
      email_id: result.id || null,
    });
  } catch (err) {
    console.warn('[stripe-webhook] could not flag email_sent', err?.message);
  }
}

export const config = { path: '/.netlify/functions/stripe-webhook' };
