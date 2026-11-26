# Back Office integration

The storefront connects to the Studio 37 tenant (`studio-37`) of the Back Office
platform at `https://gilgameh.netlify.app`.

| Flow | Direction | Trigger |
| --- | --- | --- |
| Quote requests → customers + `form` interactions | storefront → Back Office | `POST /api/quote-request` |
| Paid website orders → `ORD-xxxx` orders, production queue, inventory | storefront → Back Office | Stripe `checkout.session.completed` webhook |
| Products ↔ catalog, matched by SKU | both ways | product save, admin button or MCP tool |
| Order status updates → order lifecycle | Back Office → storefront | `POST /api/webhooks/backoffice` |

Every flow is server-side only. Secrets live in Netlify environment variables
and are never sent to the browser.

## Setup

1. In Back Office → **Business, PDF & Security → Integration API Keys**, create
   a key with the scopes `catalog:read`, `catalog:write`, `customers:read`,
   `customers:write`, `orders:read` and `orders:write`. Set it as
   `BACKOFFICE_API_KEY`.
2. In Back Office → **Webhooks & Integrations → Website**, copy the
   `webhookSecret` to `BACKOFFICE_WEBSITE_WEBHOOK_SECRET`.
3. In Back Office → **Webhooks & Integrations**, register
   `https://studio37customdesigns.com/api/webhooks/backoffice` for
   `order.created`, `order.status_changed`, `quote.accepted` and
   `invoice.paid`. Copy the generated secret to
   `BACKOFFICE_OUTBOUND_WEBHOOK_SECRET`.
4. `BACKOFFICE_BASE_URL` and `BACKOFFICE_TENANT_SLUG` default to the values
   above; set them only to point at another environment.
5. Redeploy. Admin → **Payments** → **Back Office** shows which pieces are
   configured. Then click **Sync catalog to Back Office** once to link the
   existing products.

Each flow stays off until its secret is set, so partial setup is safe.

## Leads

After a quote request is saved, it is posted as a signed `lead` event
(`X-Webhook-Signature: v1=<HMAC-SHA256 of the raw body>`) with the event ID
`lead_<lead id>`. The message includes the description, project details and
reference photo links. UTM parameters from the visitor's landing URL
(`utm_source`, `utm_medium`, `utm_campaign`) are kept for the browser session
and sent as `utmSource`, `utmMedium` and `utmCampaign`. A Back Office outage
never affects the visitor: the lead is saved and queued for retry.

## Orders

After a website checkout is paid and saved, it is posted as a signed `order`
event with the event ID `order_<checkout session id>` and `externalOrderId` set
to the checkout session ID. Each line uses the Stripe unit price and includes
`catalogItemId` when the product is linked, so Back Office deducts tracked
inventory. Back Office computes its own totals from the lines, which excludes
the shipping and Stripe tax charged at checkout. In-person and historical
Stripe imports are not sent.

Back Office does not deduplicate website events. The storefront prevents
duplicates by recording each delivery on the order and by holding a short lock
during each attempt. If a request times out after Back Office may have
processed it, the next attempt first searches Back Office website orders for
the `externalOrderId` (this needs `BACKOFFICE_API_KEY`) and only resends when
the order is not found.

## Retries

Failed lead and order deliveries are queued in the `backoffice_outbox` blob
store. The `backoffice-sync-retry` scheduled function retries them every
15 minutes, backing off over about 10 hours (6 attempts). The admin **Retry
failed syncs** button retries everything immediately, including entries that
have used up their attempts. The order and lead drawers show each record's
Back Office sync state.

## Catalog

Each storefront product maps to a Back Office catalog `product` by SKU (the
product's SKU, or `S37-<PRODUCT-ID>` when it has none). Saving a product in
Admin upserts it in Back Office:

- New SKUs are created with `Idempotency-Key: catalog-import-<sku>`. By-request
  products are not inventory tracked; other new items start with 0 on hand, so
  stock is managed in Back Office.
- Existing items are updated with a diff and their current `version`. Only the
  attributes the storefront owns are changed.
- Archived products (and offerings hidden from the shop) are marked inactive in
  Back Office.

The storefront-to-catalog links are stored in the `backoffice_catalog_map` blob
store rather than on product records, so links survive product edits.

To publish a Back Office product on the shop, paste its catalog item ID into
**Publish to shop**. Only verified, active `product` items can be published.
Publishing an already-linked item updates the existing listing.

Catalog sync runs from the admin button and the MCP tool rather than a
`pnpm` script: products live in Netlify Blobs, which are only reachable from a
deployed function.

## Status updates

`POST /api/webhooks/backoffice` verifies `X-BackOffice-Signature`
(`t=<unix seconds>,v1=<hex>`, HMAC-SHA256 of `<t>.<raw body>`) and rejects
signatures older than 5 minutes with `401`. Responses:

| Event | Effect |
| --- | --- |
| `order.status_changed` | Moves the matching website order forward only: `in_production` → In production, `ready` → Ready to ship, `fulfilled` → Complete, `cancelled` → Cancelled (unless already complete). `confirmed` and `pending` record the Back Office status without changing the lifecycle. Updates that arrive before the order is linked are held and applied when it is. |
| `order.created` | Records the Back Office order number. |
| `quote.accepted`, `invoice.paid` | Written to the audit log. |
| Others | Acknowledged and ignored. |

Status changes appear in the order history as "by Back Office". Customer
emails are not sent for Back Office status changes.

## MCP endpoint

Set `STOREFRONT_MCP_TOKEN` (32+ random characters) to enable
`POST /api/mcp`, a stateless MCP Streamable HTTP endpoint that returns JSON
responses. Clients must send `Authorization: Bearer <token>`. Tools:

- `list_storefront_products`: products with SKU, price, status and the linked
  `backofficeCatalogItemId`.
- `sync_catalog_to_backoffice`: the SKU upsert, for all products or one
  `productId`.
- `publish_product_from_backoffice`: create or update a listing from a
  `catalogItemId`.
- `list_recent_storefront_leads`: recent leads and their Back Office sync state,
  without contact details.

Without a token, the endpoint returns `404`.

## Differences from the integration spec

- API responses are read from the `data` envelope Back Office actually returns.
- Catalog links are kept in a blob map instead of a field on each product.
- The MCP endpoint is a small dependency-free JSON-RPC handler instead of
  `@modelcontextprotocol/sdk`.
- Catalog sync is an admin action and MCP tool instead of
  `pnpm run sync:backoffice-catalog`.
