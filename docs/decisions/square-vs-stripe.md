# Decision: Square as the payment gateway (replacing Stripe)

**Date:** May 2026
**Status:** Approved (per Drew, follow-up text after initial commerce architecture spec)
**Supersedes:** Stripe references in `studio37_commerce_architecture.md` § 5

---

## Summary

The earlier commerce architecture assumed Stripe as the payment gateway behind Snipcart. Drew confirmed he prefers **Square** as his merchant of record. The remainder of the architecture — Snipcart for cart/checkout, Netlify Functions + Blobs for product management, Cloudflare R2 for images, Twilio for SMS — is unchanged.

## Why this isn't a monumental shift

Snipcart is a checkout layer that sits on top of multiple supported payment gateways. **Square is one of Snipcart's first-party supported gateways** (alongside Stripe, PayPal, and a handful of others). Choosing Square is a Snipcart dashboard configuration, not an architectural rewrite.

What changes:

| Concern | Before (Stripe) | After (Square) |
|---|---|---|
| Snipcart "Payment Gateway" setting | Stripe | Square |
| Drew's merchant account | Stripe | Square (he likely already has a Square reader/POS account) |
| Where revenue lands | Stripe → bank | Square → Drew's Square balance / linked bank |
| Per-transaction fee | 2.9% + $0.30 | 2.6% + $0.10 (Square e-commerce online rate, as of May 2026) |
| Webhook receiver (`/api/order-notify`) | Snipcart webhook | **No change** — still listens to Snipcart's `order.completed`, regardless of underlying gateway |
| `data-item-url` price validation | Same | **No change** |
| Frontend code | None | **No change** — Snipcart abstracts the gateway entirely |

## What we're NOT switching to

We are **not** moving to Square Online (Square's own ecommerce site builder) or Square Buy Buttons. Those would replace Snipcart entirely and forfeit our custom admin panel + product API. Snipcart-with-Square keeps everything we've built and lets Drew use Square as his merchant.

## Setup steps (when commerce goes live)

1. Drew confirms / creates a Square seller account.
2. BWE creates a Snipcart account on Drew's behalf.
3. In the Snipcart dashboard → **Account → Payment Gateway**, select Square and OAuth into Drew's Square account.
4. Switch the Snipcart account from Test to Live mode after a $0.01 test order succeeds.
5. Set `SNIPCART_PUBLIC_KEY` and `SNIPCART_SECRET` in Netlify env vars.
6. Configure the Snipcart webhook (Account → Webhooks) to POST to `https://studio37customdesigns.com/api/order-notify` for `order.completed`.

## Implications for documentation

- `docs/studio37_commerce_architecture.md` keeps its architecture intact; **read every reference to "Stripe" as "the configured Snipcart payment gateway."** The next time that doc is revised, do a global swap.
- `.env.example` and `netlify.toml` reference the gateway only via `SNIPCART_PUBLIC_KEY` / `SNIPCART_SECRET`, so no env var changes are needed.

## Risks

- **None new.** Square's e-commerce gateway is mature and supported by Snipcart's standard integration; no custom code is required to switch.
- The **only** dependency is Drew's Square account being in good standing and able to receive online (card-not-present) payments. If Drew's Square is currently restricted to in-person POS only, he may need to enable online payments in the Square dashboard. This is a one-click toggle on Square's side.

## Roll-back

If Square turns out to be unavailable for any reason, the gateway selection in Snipcart can be flipped to Stripe (or PayPal) in a single dashboard setting. No code or data changes required.
