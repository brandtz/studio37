# Studio 37 — Commerce & Product Management Architecture
**Prepared by:** Brandtworks-Enterprises LLC  
**Decision date:** May 2026  
**Status:** Approved — Build-Ready

---

## The Core Problem

Drew cannot touch code. Ever. But he needs to:
- Add new products (photos, name, price, description, stock status)
- Edit existing products (price changes, update photos, mark out of stock)
- Remove products
- Manage incoming orders

That means we need a **product management UI** — an admin panel Drew can log into from any browser, make changes, and have them go live on the site without involving BWE for routine updates.

---

## Architecture Decision: Netlify Functions + Netlify Blobs + Snipcart

### Why NOT a static JSON file in the repo

The obvious cheap answer is a `products.json` in the GitHub repo and a simple admin that commits to it via the GitHub API. This works but has a critical flaw: every product change triggers a full Netlify site rebuild (~30–60 seconds). That's acceptable for rare changes but feels broken when Drew is updating prices or marking things out of stock. It also requires GitHub OAuth in the admin panel, which adds friction.

### Why NOT Decap CMS / Netlify CMS

Decap CMS is the standard recommendation for static sites that need content management. It's solid. But it's also overkill for a product catalog, has a non-obvious UI for non-technical users, and still relies on Git commits + rebuilds for every change. Drew doesn't need a CMS — he needs a product manager.

### The Right Architecture: Serverless + Netlify Blobs

**Netlify Blobs** is Netlify's built-in persistent key-value store. It's free on all plans, accessible from Netlify Functions, and requires no external database. Products live in Blobs. The shop page reads them live. Changes are instant — no rebuild cycle.

```
┌─────────────────────────────────────────────────────────┐
│                    studio37customdesigns.com              │
│                                                          │
│  /shop          → Fetches products from Function API     │
│  /admin         → Protected admin panel (Drew only)      │
│                                                          │
│  netlify/functions/                                      │
│    products.js       GET /api/products        (public)   │
│    products.js       GET /api/products/:id    (public)   │  ← Snipcart validation
│    admin-products.js POST/PUT/DELETE          (auth'd)   │
│    notify-sms.js     POST (form submission)   (internal) │
│                                                          │
│  Netlify Blobs                                           │
│    store: "products"                                     │
│    key: product slug (e.g. "black-walnut-chopping-block")│
│    value: JSON product object                            │
└─────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Product Data Model

Each product stored in Netlify Blobs as a JSON object:

```json
{
  "id": "black-walnut-chopping-block",
  "name": "Timber Hollow Chopping Block",
  "subtitle": "Eastern Black Walnut",
  "price": 13500,
  "description": "Hand-crafted end-grain chopping block from Eastern Black Walnut...",
  "category": "small-goods",
  "images": [
    "https://studio37.netlify.app/assets/shop/chopping_block_1.jpg",
    "https://studio37.netlify.app/assets/shop/chopping_block_2.jpg"
  ],
  "status": "available",
  "by_request": false,
  "shipping": true,
  "weight_oz": 48,
  "created_at": "2026-05-01T00:00:00Z",
  "updated_at": "2026-05-01T00:00:00Z"
}
```

**Notes:**
- `price` is integer cents (house convention — matches Bulwark architecture)
- `status`: `available` | `out_of_stock` | `by_request` | `archived`
- `by_request`: boolean — shows "Request This Item" CTA instead of Add to Cart
- `category`: `small-goods` | `furniture` | `cabinetry` | `slab-work` | `custom`

---

### 2. Public API — `netlify/functions/products.js`

**GET `/api/products`**  
Returns all non-archived products. Used by the shop page on load.

**GET `/api/products/:id`**  
Returns a single product by slug. **This is Snipcart's product validation endpoint** — Snipcart calls this on every checkout to verify the price hasn't been tampered with. Critical for payment integrity.

```javascript
// Snipcart product validation response format
{
  "id": "black-walnut-chopping-block",
  "name": "Timber Hollow Chopping Block",
  "price": 135.00,  // Snipcart expects decimal dollars, not cents — convert here
  "url": "https://studio37customdesigns.com/api/products/black-walnut-chopping-block",
  "description": "...",
  "image": "..."
}
```

No auth required. Public endpoint.

---

### 3. Admin API — `netlify/functions/admin-products.js`

Protected by a shared secret header (`X-Admin-Key`). The admin panel sends this on every request. Simple but sufficient for Drew's use case — this isn't a bank.

| Method | Action |
|---|---|
| `GET /api/admin/products` | List all products including archived |
| `POST /api/admin/products` | Create new product |
| `PUT /api/admin/products/:id` | Update product |
| `DELETE /api/admin/products/:id` | Soft-delete (sets status to `archived`) |

The admin key is stored in Netlify Environment Variables, never in the codebase. BWE sets it. Drew gets a login page that accepts it.

---

### 4. Admin Panel — `/admin/index.html`

A standalone HTML page — same aesthetic as the main site but in a simple, functional layout. Drew accesses it at `studio37customdesigns.com/admin`.

**Login flow:**
- Drew navigates to `/admin`
- Enters his admin password (the shared key)
- Password is stored in `sessionStorage` — expires when browser closes
- Incorrect password → stays on login screen

**Product management UI:**

```
┌─────────────────────────────────────────────────────────┐
│  Studio 37 Admin                          [+ New Product]│
├─────────────────────────────────────────────────────────┤
│  🔍 Filter: [All ▾]  [Available ▾]                       │
├────────┬──────────────────────────┬────────┬────────────┤
│ Image  │ Product Name              │ Price  │ Status     │
├────────┼──────────────────────────┼────────┼────────────┤
│ [img]  │ Timber Hollow Chopping…  │ $135   │ ● Available│
│        │                          │        │ [Edit][⋯]  │
├────────┼──────────────────────────┼────────┼────────────┤
│ [img]  │ McKenzie River Pizza…    │ $130   │ ● Available│
│        │                          │        │ [Edit][⋯]  │
└────────┴──────────────────────────┴────────┴────────────┘
```

**Product edit form fields:**
- Product name
- Subtitle / wood species
- Category (dropdown)
- Price (input in dollars — we convert to cents in the backend)
- Description (textarea)
- Status (Available / Out of Stock / By Request Only / Archive)
- Photos — upload up to 5 images (stored in Cloudflare R2 or Netlify's asset pipeline)
- Shipping (yes/no toggle)
- Weight (for shipping calc, optional)

**Image upload handling:**
Images uploaded via the admin panel go to a Netlify Function (`/api/admin/upload`) that pushes them to Cloudflare R2. R2 is already a BWE standard. The returned public URL gets stored in the product JSON.

This means Drew can upload a photo from his phone, have it stored on R2, and have the product go live — all from the admin panel on his phone browser.

---

### 5. Snipcart Integration

**Configuration:**
```html
<!-- Snipcart script — loads once in <head> -->
<script>
  window.SnipcartSettings = {
    publicApiKey: "YOUR_SNIPCART_PUBLIC_KEY",
    loadStrategy: "on-user-interaction",
  };
</script>
<script src="https://cdn.snipcart.com/themes/v3.3.2/default/snipcart.js"></script>
<link rel="stylesheet" href="https://cdn.snipcart.com/themes/v3.3.2/default/snipcart.css" />
```

**Add to Cart button (generated by shop page JS):**
```html
<button
  class="snipcart-add-item"
  data-item-id="black-walnut-chopping-block"
  data-item-name="Timber Hollow Chopping Block"
  data-item-price="135.00"
  data-item-url="/api/products/black-walnut-chopping-block"
  data-item-description="Hand-crafted end-grain..."
  data-item-image="/assets/shop/chopping_block_1.jpg"
  data-item-weight="48"
>
  Add to Cart
</button>
```

The `data-item-url` pointing to our Netlify Function is what Snipcart hits at checkout to validate the price. This prevents a buyer from inspecting the DOM, changing `data-item-price` to $0.01, and checking out. Snipcart compares their cart price to what our function returns — mismatch = rejected.

**Stripe integration:** Snipcart connects to Stripe. Drew needs a Stripe account. BWE handles the connection setup. Revenue goes directly to Drew's Stripe (and thus bank) account.

**Snipcart merchant dashboard:** Drew gets access to the Snipcart dashboard at `app.snipcart.com`. From there he can:
- View all orders
- Process refunds
- See revenue reports
- Manage abandoned carts
- Export order CSVs

This is his order management UI — separate from the product admin panel.

---

### 6. SMS on Order (Bonus)

In addition to SMS on quote requests, we can trigger an SMS to Drew when an order is placed. Snipcart has a webhook system — on `order.completed`, it POSTs to our Netlify Function, which sends Drew a text:

```
🛒 New Studio 37 Order!
Item: Timber Hollow Chopping Block
Amount: $135.00
Buyer: Sarah M. (Portland, OR)
Check Snipcart dashboard for details.
```

This way Drew knows instantly when something sells — even if he's in the field.

---

## Cost Summary (Ongoing)

| Service | Cost | Notes |
|---|---|---|
| Netlify | Free | Hosting, functions, blobs, forms |
| Snipcart | 2% above $500/mo | Free below $500/mo in sales |
| Stripe | 2.9% + $0.30/transaction | Standard Stripe rate |
| Cloudflare R2 | ~$0 | 10GB free, product images are tiny |
| Twilio (SMS) | ~$1–3/mo | Quote + order notifications |
| Domain renewal | ~$15/yr | Drew likely already owns this |
| **Total fixed** | **~$18/yr + $1–3/mo** | Before Snipcart/Stripe % |

At $1,000/mo in shop sales: Snipcart takes $20 (2%), Stripe takes ~$59 (2.9% + fees). Total commerce fees ~$79/mo on $1K revenue — 7.9%. Reasonable for fully managed checkout.

---

## What Drew Still Needs to Provide / Set Up

| Item | Who Does It | Notes |
|---|---|---|
| Stripe account | Drew creates, BWE connects | Personal or business account |
| Snipcart account | BWE creates, Drew owns | Email + billing |
| Admin password | BWE sets | Drew stores it somewhere safe |
| Product photos for new items | Drew | Phone photos are fine — admin panel handles upload |
| Confirm which out-of-stock items are truly dead vs. restockable | Drew | Affects how we list them |

---

## Build Order

1. **Netlify Functions scaffold** — `products.js`, `admin-products.js`, `notify-sms.js`
2. **Seed Netlify Blobs** with existing product catalog (scraped from Wix)
3. **Shop page** — fetches products from API, renders with Snipcart buttons
4. **Admin panel** — product CRUD UI
5. **Image upload pipeline** — admin → Netlify Function → R2
6. **Snipcart + Stripe connection** — test checkout with $0.01 test product
7. **Order SMS webhook** — Snipcart → Netlify Function → Twilio
8. **Full site integration** — wire shop into the complete site build

---

*Architecture locked. Proceed to build phase.*
