// POST /api/stripe/checkout-session
// Body: { items: [{ id, quantity }], successUrl?, cancelUrl? }
// Verifies each item against the live products store (price integrity), then creates
// a Stripe Checkout Session with the tenant's connected account as the destination.
//
// Direct-charge model: money lands on the connected account; platform sees the
// charge but does not hold funds. Application fee defaults to the tenant's
// application_fee_bps (basis points; 0 by default for Drew).

import { ensureProductSeeded, productStore, json, nowIso } from './_lib/store.mjs';
import { stripe, requireConnectedTenant } from './_lib/stripe.mjs';

const MAX_ITEMS = 30;
const MAX_QTY = 20;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  await ensureProductSeeded();
  const tCheck = await requireConnectedTenant(req);
  if (tCheck.error) return tCheck.error;
  const tenant = tCheck.tenant;

  const body = await req.json().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (!rawItems.length) return json({ error: 'cart_empty' }, 400);
  if (rawItems.length > MAX_ITEMS) return json({ error: 'too_many_items' }, 400);

  const url = new URL(req.url);
  const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
  const successUrl = (typeof body?.successUrl === 'string' && body.successUrl) || `${baseUrl}/order/confirmed?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl  = (typeof body?.cancelUrl  === 'string' && body.cancelUrl)  || `${baseUrl}/shop?checkout=cancelled`;

  const productsStore = productStore();
  const lineItems = [];
  let totalCents = 0;
  let anyShippable = false;

  for (const it of rawItems) {
    const id = String(it?.id || '');
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(it?.quantity, 10) || 1));
    if (!id) continue;
    const p = await productsStore.get(id, { type: 'json' });
    if (!p || p.status === 'archived' || p.status === 'out_of_stock') {
      return json({ error: 'product_unavailable', id }, 400);
    }
    if (p.status === 'by_request') {
      return json({ error: 'by_request_only', id, message: 'This item is by request — please use the contact form.' }, 400);
    }
    const unit = parseInt(p.price, 10);
    if (!Number.isFinite(unit) || unit <= 0) {
      return json({ error: 'product_no_price', id }, 400);
    }
    if (p.shipping !== false) anyShippable = true;
    totalCents += unit * qty;

    lineItems.push({
      quantity: qty,
      price_data: {
        currency: tenant.currency || 'usd',
        unit_amount: unit,
        product_data: {
          name: p.name,
          description: p.subtitle || undefined,
          images: (p.images || []).slice(0, 4).filter((u) => /^https?:\/\//.test(u)),
          metadata: { product_id: p.id },
          tax_code: 'txcd_99999999', // "General — Tangible Goods"; Stripe Tax can override per product later
        },
        // Stripe Tax: let Stripe compute tax on top of unit_amount
        tax_behavior: 'exclusive',
      },
    });
  }

  if (!lineItems.length) return json({ error: 'cart_empty' }, 400);

  const feeBps = Number.isFinite(tenant.application_fee_bps) ? tenant.application_fee_bps : 0;
  const applicationFee = feeBps > 0 ? Math.floor((totalCents * feeBps) / 10000) : 0;

  const params = {
    mode: 'payment',
    line_items: lineItems,
    success_url: successUrl,
    cancel_url: cancelUrl,
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
    metadata: {
      tenant_id: tenant.id,
      created_at: nowIso(),
    },
    payment_intent_data: {
      metadata: { tenant_id: tenant.id },
    },
  };

  if (applicationFee > 0) {
    params.payment_intent_data.application_fee_amount = applicationFee;
  }

  if (anyShippable) {
    params.shipping_address_collection = { allowed_countries: ['US'] };
    // Two choices at Stripe Checkout: paid/free shipping, or a free local
    // pickup option for customers (e.g. at an in-person event) who'll grab
    // the piece from Drew directly. Note: Stripe Checkout always asks for a
    // shipping address regardless of which option is selected — that's a
    // platform limitation, not something we can suppress per-option. Safe to
    // ignore/skip for pickup orders.
    params.shipping_options = [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: totalCents >= 15000 ? 'Free Shipping' : 'Standard Shipping',
          fixed_amount: { amount: totalCents >= 15000 ? 0 : 1200, currency: 'usd' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 3 },
            maximum: { unit: 'business_day', value: 7 },
          },
        },
      },
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: 'Local Pickup (Springfield, OR) — Free',
          fixed_amount: { amount: 0, currency: 'usd' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 1 },
            maximum: { unit: 'business_day', value: 3 },
          },
        },
      },
    ];
  }

  try {
    const session = await stripe().checkout.sessions.create(params, {
      stripeAccount: tenant.stripe_account_id,
    });
    return json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('[stripe-checkout-session] create failed', err);
    return json({ error: 'stripe_error', message: 'Could not start checkout.' }, 502);
  }
};

export const config = { path: '/.netlify/functions/stripe-checkout-session' };
