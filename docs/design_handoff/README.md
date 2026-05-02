# Handoff: Studio 37 Custom Designs — Full Site Rebuild

**Prepared by:** Brandtworks-Enterprises LLC  
**Design tool:** Claude Design (HTML prototype)  
**Target deploy:** Netlify (vanilla HTML5, CSS3, vanilla JS, Snipcart, Netlify Functions)  
**Date:** May 2026

---

## Overview

This handoff package contains the complete high-fidelity design prototype for the Studio 37 Custom Designs website rebuild. Studio 37 is a custom woodworking business run by Drew Trano in Eastern Oregon. The site needs to:

1. Generate quote/estimate requests for high-ticket custom work
2. Sell small goods directly via Snipcart e-commerce
3. Establish Drew's professional credibility as a craftsman and emerging GC
4. Showcase his portfolio of work
5. Provide Drew with a self-service admin panel for product management (no developer needed for routine updates)

---

## About the Design Files

The files in this bundle are **design references created in HTML** — high-fidelity prototypes showing the intended look, content, and interactive behavior. They are **not** production code to copy directly.

The task is to **recreate these designs in production-ready vanilla HTML5/CSS3/JS** deployable on Netlify, using:
- Netlify Functions for the product API and admin auth
- Netlify Blobs for persistent product storage
- Snipcart for e-commerce cart + checkout
- Stripe (via Snipcart) for payments
- Twilio for SMS notifications

No React, no Tailwind, no build step. Plain HTML/CSS/JS that works directly in the browser.

---

## Fidelity

**High-fidelity.** The prototype is pixel-accurate for colors, typography, spacing, and interactions. Recreate the UI as close to pixel-perfect as possible. All design tokens are documented below and in `design_handoff_studio37/tokens.css`.

---

## Site Architecture

```
studio37customdesigns.com/
├── /                    index.html        → Home
├── /services            services.html     → Services
├── /portfolio           portfolio.html    → Portfolio gallery
├── /shop                shop.html         → Product shop (Snipcart)
├── /about               about.html        → About Drew
├── /contact             contact.html      → Quote request form
└── /admin               admin/index.html  → Admin panel (password protected)
```

---

## Screens / Views

### 1. HOME PAGE (`/`)

**Purpose:** Primary landing page. Converts visitors into quote requests and shop buyers.

#### Navigation (sticky, fixed top)
- Height: 72px
- Background: transparent on load, transitions to `rgba(26,23,20,0.94)` with `backdrop-filter: blur(8px)` after 40px scroll
- Logo: `assets/images/logo.png`, height 48px, `filter: brightness(0) invert(1)` (white on dark)
- Nav links: DM Sans, 13px, weight 500, letter-spacing 0.08em, uppercase, color `#9e9287`, hover `#f0ebe3`
- Links: HOME | SERVICES | PORTFOLIO | SHOP | ABOUT
- Cart icon: Lucide `shopping-bag`, 20px, right side; shows item count badge (amber `#c8864a`, 16px circle) when cart has items
- CTA button: "Get a Quote" — border 1.5px solid `#c8864a`, color `#c8864a`, padding 10px 22px, border-radius 4px, hover fills amber
- Mobile: hamburger → full-screen dark overlay with large Cormorant Garamond display links

#### Hero Section
- Full viewport height (100vh minimum)
- Background: `assets/images/portfolio_2.jpg` (live edge coffee table), `opacity: 0.55` over `#1a1714`
- Gradient overlay: `linear-gradient(to top, rgba(26,23,20,0.95) 0%, rgba(26,23,20,0.4) 50%, rgba(26,23,20,0.1) 100%)`
- Content position: lower-left, padding 128px 64px
- Animation on load: `opacity 0→1, translateY 24px→0, 800ms ease-out`
- Label: "STUDIO 37 CUSTOM DESIGNS" — DM Sans, 12px, weight 500, letter-spacing 0.15em, uppercase, color `#c8864a`
- Headline: "Crafted\nby Hand." — Cormorant Garamond, clamp(3rem, 7vw, 5rem), weight 300, letter-spacing 0.04em, color `#f0ebe3`, line-height 1.1
- Sub: "Handcrafted in the Pacific Northwest by Drew Trano." — DM Sans, 18px, color `#9e9287`, max-width 480px
- CTAs side by side: "View My Work" (ghost button) + "Get a Quote →" (amber solid button)
- Scroll indicator: 1px animated line, bottom center, fades amber from transparent to `#c8864a`

#### Services Strip
- Background: `#231f1b`; border-top/bottom: 1px solid `rgba(240,235,227,0.06)`
- 5 equal-flex cards, border-right dividers between them
- Each card: padding 48px 24px, hover background `#2e2925`, hover shows 2px amber bottom border
- Icon: SVG line icon, 28px, color `#6a5f56`, hover transitions to `#c8864a`
- Service name: Cormorant Garamond, 20px, weight 400, color `#f0ebe3`
- Description: DM Sans, 13px, color `#9e9287`, line-height 1.5
- GC card has "Soon" badge: amber tint background, amber text, 10px, pill shape

#### Featured Work Grid
- CSS Grid: `grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 340px 240px`
- First cell spans `grid-row: 1 / 3` (tall left column)
- Gap: 3px between cells, no outer gap
- Each cell: `overflow: hidden`, hover darkens overlay `rgba(26,23,20,0.65)`, shows italic label in amber
- Images: `object-fit: cover`, hover `scale(1.03)` on image

#### About Teaser
- Two-column grid: `1fr 1fr`, gap 64px, align center
- Left: `assets/images/headshot.jpg`, height 520px, border-radius 8px
  - Overlay tag bottom-left: "Est. 2017 · Eastern Oregon" — Cormorant Garamond italic, 13px, semi-transparent dark background
- Right: label, h2 "Built on a Love of Wood", 2 paragraphs of body copy, ghost CTA "About Drew →"

#### Quote CTA Banner
- Background: `#231f1b`, border-top/bottom dividers
- Centered: radial glow `rgba(200,134,74,0.07)` background effect
- Display headline, sub-copy, single amber CTA button

#### Featured Shop (3 available products)
- Same product grid as shop page (3 columns)

#### Footer
- Background: `#1a1714`, border-top: 1px solid divider
- 3-column grid: `1.5fr 1fr 1fr`
- Logo: `assets/images/logo.png`, height 56px, `brightness(0) invert(1) opacity(0.7)`
- Tagline, Instagram + Pinterest icons
- Navigation links column
- Contact column: email, location, quote CTA
- Bottom bar: copyright left, "Site by Brandtworks-Enterprises LLC" right

---

### 2. SERVICES PAGE (`/services`)

**Purpose:** Showcase each service offering with details, pricing, and inquiry CTAs.

#### Short Hero
- Height: 45vh; background photo `assets/images/shop/liveedge_table_1.jpg` at 55% opacity
- Dark gradient overlay
- Title: "Services" — Cormorant Garamond, clamp(2.5rem, 5vw, 4rem), weight 300

#### Service Sections (alternating layout)
- CSS Grid: `1fr 1fr`, alternating image-left/text-right using `direction: rtl` trick on even items
- Photo side: `aspect-ratio: 4/3`, `object-fit: cover`
- Text side: background `#231f1b`, padding 96px 64px
- Each section has: section number label, h2 service name, 2 description paragraphs, checklist (dash-prefixed), pricing + timeline meta, inquiry CTA

**Service order and photos:**
1. Custom Cabinetry — `assets/images/shop/side_table_2.jpg`
2. Slab Flattening — `assets/images/shop/liveedge_table_1.jpg`
3. Custom Furniture — `assets/images/shop/bench_1.jpg`
4. Small Goods & Gifts — `assets/images/portfolio_1.jpg`
5. General Contracting — Full-width dark banner, large text, "Join the Waitlist" CTA

---

### 3. PORTFOLIO PAGE (`/portfolio`)

**Purpose:** Visual gallery of Drew's work. Filters by category. Lightbox on click.

#### Filter Bar
- Sticky below nav (top: 72px), background `#231f1b`, border-bottom divider
- Pill buttons: "All | Cabinetry | Furniture | Slab Work | Small Goods"
- Active pill: background `#c8864a`, color `#1a1714`
- Inactive: border 1.5px solid amber-border, color muted

#### Masonry Gallery
- CSS `columns: 3`, `column-gap: 12px`, `break-inside: avoid`
- Each item: `margin-bottom: 12px`, `overflow: hidden`, `border-radius: 4px`
- Hover: image `scale(1.03)`, overlay fades in with italic amber label
- Click: opens lightbox modal

#### Lightbox
- Full-screen dark overlay `rgba(10,8,6,0.93)`
- Image centered, `max-height: 80vh`, `object-fit: contain`
- Caption below: italic muted text
- Close button top-right

**Portfolio images (in order):**
- `liveedge_coffee_1.jpg`, `side_table_2.jpg`, `blackwalnut_board.jpg`, `liveedge_table_1.jpg`, `liveedge_coffee_2.jpg`, `charcuterie_walnut_1.jpg`, `edge_grain_board_1.jpg`, `bench_1.jpg`, `pizza_paddle_1.jpg`, `chopping_block_2.jpg`, `clipboard_1.jpg`, `coasters_1.png`, `chessboard_1.jpg`, `swing_seat_1.webp`, `countertop_board.jpg`

---

### 4. SHOP PAGE (`/shop`)

**Purpose:** E-commerce product listing. Powered by Snipcart. Products loaded from `/api/products`.

#### Loading State
- Show 6 skeleton cards (same dimensions as real cards)
- Skeleton shimmer animation: `background: linear-gradient(90deg, #2e2925 25%, rgba(200,134,74,0.06) 50%, #2e2925 75%); background-size: 800px; animation: shimmer 1.5s infinite`

#### Filter Bar
- Same pill style as portfolio: "All | Cutting Boards | Charcuterie | Furniture | Custom Pieces"

#### Product Grid
- CSS Grid: `repeat(3, 1fr)`, gap 24px; 2-col tablet; 1-col mobile
- Card: background `#2a2520`, border 1px solid `rgba(200,134,74,0.18)`, border-radius 8px
- Image: `aspect-ratio: 4/3`, `object-fit: cover`; hover `scale(1.04)`, card `translateY(-3px)`
- Category label: 12px, weight 500, letter-spacing 0.12em, uppercase, amber
- Product name: Cormorant Garamond, 20px, weight 400
- Subtitle: DM Sans italic, 14px, muted
- Price: DM Sans, 20px, weight 500, amber `#c8864a`
- Add to Cart: solid amber button (Snipcart `snipcart-add-item` class)
- By Request: ghost button → navigates to contact form
- Out of Stock: `opacity: 0.5`, gray "Out of Stock" badge, no CTA

#### Snipcart Integration
```html
<!-- In <head> -->
<script>
  window.SnipcartSettings = {
    publicApiKey: "YOUR_SNIPCART_PUBLIC_KEY",
    loadStrategy: "on-user-interaction",
  };
</script>
<script src="https://cdn.snipcart.com/themes/v3.3.2/default/snipcart.js"></script>
<link rel="stylesheet" href="https://cdn.snipcart.com/themes/v3.3.2/default/snipcart.css" />
```

**Add to Cart button attributes:**
```html
<button class="snipcart-add-item btn-primary"
  data-item-id="{product.id}"
  data-item-name="{product.name}"
  data-item-price="{product.price}"
  data-item-url="/api/products/{product.id}"
  data-item-description="{product.description}"
  data-item-image="{product.images[0]}"
  data-item-weight="{product.weight_oz}">
  Add to Cart
</button>
```

**Snipcart CSS overrides** (to match site palette):
```css
:root {
  --color-default: #f0ebe3;
  --color-alt: #9e9287;
  --color-input-default: #f0ebe3;
  --color-buttonPrimary: #c8864a;
  --color-buttonPrimary-hover: #dfa06a;
  --color-buttonPrimary-active: #a8683a;
  --color-link: #c8864a;
  --borderRadius-md: 4px;
}
```

---

### 5. ABOUT PAGE (`/about`)

**Purpose:** Drew's story and credibility. Includes GC license callout.

- Two-column layout: portrait left (`assets/images/headshot.jpg`), text right
- Pull quote: left-border 2px amber, Cormorant Garamond italic, 28px
- 3-column craft cards: dark surface-mid background, amber-bordered
- GC callout box: amber border, amber-tinted background, accent text

---

### 6. CONTACT / QUOTE PAGE (`/contact`)

**Purpose:** Primary sales conversion. Quote request form.

#### Form Fields (in order)
1. First Name + Last Name (side by side)
2. Email Address + Phone Number (side by side)
3. Service Type (select dropdown)
4. Project Description (textarea, min-height 140px)
5. Project Location + Estimated Budget (side by side)
6. Preferred Contact Method (pill radio: Phone Call / Text Message / Email)
7. How Did You Find Us? (select dropdown)
8. Reference Photos (drag-and-drop upload zone, up to 3 images)
9. Submit: "Send My Request →" — full-width amber button

**Form styling:**
- Dark surface inputs: background `#2e2925`, border 1px amber-border
- Focus state: border-color `#c8864a`, box-shadow `0 0 0 2px rgba(200,134,74,0.15)`
- Labels: 11px, uppercase, letter-spacing 0.1em, muted
- Success state: replaces form with "Thank you, [Name]. Drew will be in touch soon."

**Form submission:**
- POST to Netlify Function `/api/quote-request`
- Function sends SMS to Drew via Twilio
- Function stores lead in Netlify Blobs store `"leads"`

---

### 7. ADMIN PANEL (`/admin/`)

**Purpose:** Drew's product management tool. No developer needed for routine updates.

#### Login Screen
- Centered card on dark background (`#152030`)
- Logo, password input, "Enter Admin" button
- Wrong password: CSS shake animation on card
- Correct password: store key in `sessionStorage`, show dashboard
- Hint in design: password is `studio37` — **change to a real secret before launch**

#### Admin Dashboard Layout
```
┌─────────────────────────────────────────────────────────┐
│ SIDEBAR (220px)  │  TOPBAR (60px)                        │
│                  │─────────────────────────────────────  │
│  [Logo]          │  CONTENT AREA                         │
│  Admin           │  Search + Filter bar                  │
│                  │  Product table                        │
│  • Products ←    │                                       │
│  • Orders        │                                       │
│  • Settings      │                                       │
│                  │                                       │
│  [View Site →]   │                                       │
└─────────────────────────────────────────────────────────┘
```

**Sidebar:** Background `#0f1a28`, border-right `rgba(46,109,164,0.25)`, width 220px
- Active item: `background rgba(200,134,74,0.1)`, left-border 3px amber, amber icon

**Product Table:**
- Columns: Thumbnail (56×56px) | Product Name + subtitle | Price (IBM Plex Mono, amber) | Status dot | Edit button
- Status dots: Available `#4a9a6a`, Out of Stock `#7a6f65`, By Request `#c8864a`, Archived `#c0392b`
- Row hover: `rgba(200,134,74,0.04)`
- Search input + status filter dropdown above table

#### Product Edit Drawer
- Slides in from right: `transform: translateX(100%→0), 280ms ease`
- Width: 480px; dark overlay behind
- Fields: Name, Subtitle, Category (select), Price (number), Status (pill radio), Description (textarea), Photos (upload zone), Shipping checkbox
- Footer: Cancel (ghost) + Save Product (amber)

#### Admin API Calls
All admin actions call Netlify Functions with `X-Admin-Key` header:
- `GET /api/admin/products` — list all (including archived)
- `POST /api/admin/products` — create
- `PUT /api/admin/products/:id` — update
- `DELETE /api/admin/products/:id` — soft-delete (sets status: archived)
- `POST /api/admin/upload` — image upload → Cloudflare R2

---

## Interactions & Behavior

| Element | Behavior | Spec |
|---|---|---|
| Page load | Hero text fades up | `opacity 0→1, translateY 24px→0, 800ms ease-out` |
| Scroll reveals | Cards fade up on enter | `opacity 0→1, translateY 20px→0, 500ms ease, IntersectionObserver` |
| Nav on scroll | Background appears | `background + backdrop-filter transition 300ms ease` after 40px |
| Button hover | Color transition | `200ms ease` |
| Card hover | Lift + image zoom | `translateY(-3px), img scale(1.04), 250ms ease` |
| Portfolio hover | Overlay + label | `opacity 0→0.85, 200ms ease` |
| Product filter | Instant filter | No animation needed, just re-render |
| Shop load | Skeleton → real | 1.2s simulated delay (replace with real API fetch) |
| Admin drawer | Slide in from right | `translateX(100%→0), 280ms ease` |
| Admin login error | Card shake | CSS keyframes, 400ms |
| Cart add | Toast notification | Slide in from right, 200ms, auto-dismiss 3s |
| Form submit | Validate → success | Required: firstName, email, service, description |

---

## State Management

### Shop Page
- `products` — fetched from `GET /api/products` on mount
- `activeFilter` — string, controls displayed products
- `loading` — boolean, shows skeleton state during fetch
- Cart state managed entirely by Snipcart

### Admin Panel
- `authed` — boolean, read/write `sessionStorage`
- `products` — fetched from `GET /api/admin/products`
- `editProduct` — null or product object, controls drawer
- `isNew` — boolean, create vs. update mode
- `searchQ` + `statusFilter` — UI filter state

### Contact Form
- All field values in local state
- `errors` object for validation display
- `submitted` boolean for success state

---

## Design Tokens

```css
/* Colors */
--color-surface-dark:    #1a1714;   /* Page background */
--color-surface-mid:     #231f1b;   /* Section backgrounds */
--color-surface-light:   #2e2925;   /* Inputs, hover states */
--color-surface-card:    #2a2520;   /* Card backgrounds */
--color-accent:          #c8864a;   /* Amber — primary accent */
--color-accent-light:    #dfa06a;   /* Hover state */
--color-accent-dark:     #a8683a;   /* Active/pressed */
--color-accent-muted:    rgba(200,134,74,0.15);

--color-text-primary:    #f0ebe3;   /* Warm off-white */
--color-text-muted:      #9e9287;   /* Secondary text */
--color-text-dim:        #6a5f56;   /* Tertiary / disabled */
--color-text-on-accent:  #1a1714;   /* Text on amber buttons */

--color-border:          rgba(200,134,74,0.18);
--color-border-subtle:   rgba(240,235,227,0.08);
--color-divider:         rgba(240,235,227,0.06);

--color-success:         #4a9a6a;
--color-danger:          #c0392b;

/* Admin-specific (Bulwark-blended) */
--color-admin-bg:        #152030;
--color-admin-sidebar:   #0f1a28;
--color-admin-card:      #1c2d40;
--color-admin-border:    rgba(46,109,164,0.25);

/* Typography */
--font-display:  'Cormorant Garamond', Georgia, serif;
--font-body:     'DM Sans', system-ui, sans-serif;
--font-mono:     'IBM Plex Mono', monospace;   /* prices in admin */

/* Google Fonts import */
/* @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap'); */

/* Type scale */
--text-xs:   0.75rem;    /* 12px — labels, badges */
--text-sm:   0.875rem;   /* 14px — captions, meta */
--text-base: 1rem;       /* 16px — body */
--text-lg:   1.125rem;   /* 18px — lead text */
--text-xl:   1.25rem;    /* 20px — card titles */
--text-2xl:  1.5rem;     /* 24px — section subheads */
--text-3xl:  2rem;       /* 32px — section heads */
--text-4xl:  2.75rem;    /* 44px — page heroes */
--text-5xl:  3.75rem;    /* 60px */
--text-6xl:  5rem;       /* 80px */

/* Spacing (8px grid) */
--space-1:  4px;  --space-2:  8px;   --space-3:  12px;
--space-4:  16px; --space-5:  24px;  --space-6:  32px;
--space-7:  48px; --space-8:  64px;  --space-9:  96px;
--space-10: 128px;

/* Layout */
--max-width: 1200px;
--max-width-narrow: 760px;

/* Radius */
--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:   16px;
--radius-pill: 999px;

/* Shadows */
--shadow-card:  0 1px 8px rgba(0,0,0,0.35), 0 0 0 1px var(--color-border);
--shadow-warm:  0 4px 24px rgba(200,134,74,0.12);
--shadow-modal: 0 16px 48px rgba(0,0,0,0.6);

/* Transitions */
--ease-base: 200ms ease;
--ease-fast: 100ms ease;
--ease-slow: 300ms ease;
```

---

## Product Data Model

Each product stored in Netlify Blobs store `"products"`:

```json
{
  "id": "chopping-block",
  "name": "Timber Hollow Chopping Block",
  "subtitle": "Eastern Black Walnut",
  "price": 13500,
  "description": "Hand-crafted end-grain chopping block...",
  "category": "small-goods",
  "images": ["/assets/images/shop/chopping_block_1.jpg"],
  "status": "available",
  "by_request": false,
  "shipping": true,
  "weight_oz": 48,
  "created_at": "2026-05-01T00:00:00Z",
  "updated_at": "2026-05-01T00:00:00Z"
}
```

**Notes:**
- `price` is integer cents
- `status`: `available` | `out_of_stock` | `by_request` | `archived`
- `category`: `small-goods` | `furniture` | `cabinetry` | `slab-work` | `custom`

### Full Product Catalog (seed data)

| id | name | price (cents) | status |
|---|---|---|---|
| swing-seat | Custom English Walnut Swing Seat | 29500 | available |
| cascade-coasters | Cascade Coasters with Holder | 9500 | available |
| custom-side-table | Custom Side Table | 210000 | by_request |
| charcuterie-walnut | Custom Black Walnut Charcuterie Board | 5500 | available |
| pizza-paddle | Custom McKenzie River Pizza Paddle | 13000 | available |
| chopping-block | Timber Hollow Chopping Block | 13500 | available |
| clipboard | Black Walnut Clipboard | 3500 | available |
| countertop-board | Large Countertop Prep Cutting Board | 18000 | available |
| butcher-juice | Hand Crafted Butcher Block with Juice Groove | null | out_of_stock |
| cutting-board | Cutting Board | 3000 | available |
| coffee-table | Black Walnut Live Edge Coffee Table | 280000 | by_request |
| edge-grain-board | Handcrafted Edge Grain Cutting Board | 16000 | available |
| bw-cutting-board | Handcrafted Black Walnut Cutting Board | 6500 | available |
| charcuterie-board | Handcrafted Charcuterie Board | 15500 | available |
| live-edge-bench | Handcrafted Live Edge Black Walnut Bench | 74995 | by_request |
| monkeypod | Monkeypod Butcher Block | null | out_of_stock |
| eastern-walnut | Eastern Black Walnut Cutting Board | null | out_of_stock |
| chessboard | Chess Board or Cutting Board | null | out_of_stock |
| butcherblock-2 | Handcrafted Butcher Block | null | out_of_stock |
| live-edge-tables | Live Edge Tables (starting at $700/lin ft) | 70000 | by_request |

---

## Netlify Functions Required

```
netlify/functions/
├── products.js           GET /api/products          (public — all non-archived)
│                         GET /api/products/:id       (public — Snipcart validation)
├── admin-products.js     GET/POST/PUT/DELETE         (auth: X-Admin-Key header)
│                         /api/admin/products
├── admin-upload.js       POST /api/admin/upload      (image → Cloudflare R2)
├── quote-request.js      POST /api/quote-request     (form → Twilio SMS to Drew)
└── order-notify.js       POST /api/order-notify      (Snipcart webhook → Twilio SMS)
```

**Environment variables required:**
```
ADMIN_KEY          = <secret — Drew's admin password>
TWILIO_SID         = <Twilio account SID>
TWILIO_TOKEN       = <Twilio auth token>
TWILIO_FROM        = <Twilio phone number>
DREW_PHONE         = <Drew's mobile number for SMS>
R2_ACCOUNT_ID      = <Cloudflare R2 account>
R2_ACCESS_KEY      = <R2 access key>
R2_SECRET_KEY      = <R2 secret key>
R2_BUCKET          = studio37-assets
SNIPCART_SECRET    = <Snipcart secret key for webhook verification>
```

---

## Assets

All assets are in `assets/images/`:

```
assets/images/
├── logo.png                    Studio 37 circular emblem (render white-inverted on dark bg)
├── headshot.jpg                Drew Trano portrait
├── portfolio_1.jpg             Cutting board stack
├── portfolio_2.jpg             Live edge coffee table (hero image)
├── portfolio_3.jpg             Workshop / slab photo
└── shop/
    ├── swing_seat_1.webp / _2.webp
    ├── coasters_1.png / _2.png
    ├── side_table_1.jpg / _2.jpg
    ├── charcuterie_walnut_1.jpg / _2.jpg
    ├── pizza_paddle_1.jpg / _2.jpg
    ├── chopping_block_1.jpg / _2.jpg
    ├── clipboard_1.jpg / _2.jpg
    ├── countertop_board.jpg
    ├── butcher_juice_1.jpg / _2.jpg
    ├── cutting_board_basic_1.jpg / _2.jpg
    ├── liveedge_coffee_1.jpg / _2.jpg
    ├── edge_grain_board_1.jpg / _2.jpg
    ├── blackwalnut_board.jpg
    ├── charcuterie_board_2.png
    ├── bench_1.jpg / _2.jpg
    ├── monkeypod_1.jpg / _2.jpg
    ├── eastern_walnut_1.jpg / _2.jpg
    ├── chessboard_1.jpg / _2.jpg
    ├── butcherblock_2_1.jpg / _2.jpg
    └── liveedge_table_1.jpg
```

**Logo treatment:** Always use `filter: brightness(0) invert(1)` for white version on dark backgrounds. The raw PNG is black on transparent.

---

## Responsive Breakpoints

```
Mobile:  390px  (design at)
Tablet:  768px  (2-col products, 2-col masonry)
Desktop: 1024px (full layout)
Wide:    1440px (design at — max-width containers)
```

**Critical mobile:**
- Nav: hamburger → full-screen overlay
- Product grid: 1 column below 480px, 2 columns 480–1024px
- Form fields: full-width, min-height 48px tap targets
- Admin: functional on mobile for Drew

---

## Grain Texture

The site uses a subtle grain/noise overlay on all dark backgrounds for depth. Implemented as a pseudo-element or fixed overlay using an inline SVG filter:

```css
body::after {
  content: '';
  position: fixed; inset: 0;
  pointer-events: none; z-index: 9999;
  opacity: 0.028;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px;
}
```

---

## Files in This Package

| File | Description |
|---|---|
| `README.md` | This document |
| `tokens.css` | All CSS custom properties (design tokens) |
| `Studio 37.html` | Complete HiFi prototype — all 7 pages in one SPA |
| `assets/images/` | All production-ready images |
| `assets/css/studio37.css` | Base design system CSS |

**Reference the prototype** (`Studio 37.html`) directly in a browser to see all interactions, hover states, animations, and page flows. Use it as the source of truth for visual implementation.

---

## Important Notes for Developer

1. **The admin password** in the prototype is `studio37` — set a real `ADMIN_KEY` env var before launch.
2. **Snipcart public key** is a placeholder — Drew needs a Snipcart account.
3. **Out-of-stock products** (chessboard, monkeypod, eastern walnut, butcherblocks) — confirm with Drew whether to restore, archive, or list as by_request before seeding Blobs.
4. **Photo uploads** in the admin panel go to Cloudflare R2 — R2 bucket and credentials needed from BWE.
5. **The `data-item-url`** on Snipcart buttons MUST point to the live Netlify Function endpoint for price validation to work. Do not use a static URL.
6. **SMS notifications** require Twilio account setup — Drew's mobile number stored in env var, never hardcoded.
7. **Drew's logo** is a black-on-transparent PNG — always apply `filter: brightness(0) invert(1)` for the white version.

---

*Package prepared by Brandtworks-Enterprises LLC · Studio 37 Custom Designs · May 2026*
