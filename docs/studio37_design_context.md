# Studio 37 Custom Designs — Design Context File
**For:** Claude Design / AI Design Agent  
**Purpose:** High-fidelity mockup + wireframe generation  
**Prepared by:** Brandtworks-Enterprises LLC  
**Output target:** Screen-ready component set + page wireframes for developer handoff

---

## READ THIS FIRST

This file is the complete design brief. Do not ask for information that is answered here. Do not make assumptions that contradict decisions documented below. Where a decision is marked **LOCKED**, do not deviate. Where a decision is marked **CREATIVE DIRECTION**, you have latitude — use it boldly.

The developer coding against these mockups will use: vanilla HTML5, CSS3 with CSS variables, vanilla JavaScript, Snipcart (e-commerce), and Netlify Functions. No React. No Tailwind. All design decisions must be achievable in plain CSS.

---

## 1. Business Context

**Client:** Drew Trano  
**Business:** Studio 37 Custom Designs  
**Location:** Eastern Oregon / Pacific Northwest  
**What he does:** Custom woodworking — cabinetry, furniture, slab flattening, specialty pieces, small goods (cutting boards, charcuterie boards). General Contractor license incoming.  
**Audience:** Homeowners, interior designers, other woodworkers (for slab flattening), gift buyers  
**Site goals (in priority order):**
1. Generate quote/estimate requests for high-ticket custom work (cabinetry, furniture, slab)
2. Sell small goods directly (cutting boards, charcuterie boards, etc.) via Snipcart
3. Establish Drew's professional credibility as a craftsman and emerging GC
4. Showcase portfolio of work

**Tone:** Artisanal premium. Pacific Northwest. Not rustic-country. Not corporate-sterile. Think: a craftsman who takes his work seriously and has the portfolio to back it up. Feels like a well-designed furniture atelier, not a craft fair booth.

---

## 2. Brand Identity

### 2.1 Logo
The existing Studio 37 logo is a dark circular emblem — stylized woodworking/compass mark with "STUDIO 37" and "CUSTOM DESIGNS" text. It has an established identity. **Do not redesign the logo.** Treat it as a locked asset. It works best on dark backgrounds.

File: `logo/logo.png` (41KB PNG with transparency)

### 2.2 Color Palette — LOCKED DIRECTION

The existing site uses a **dark, craftsman aesthetic**. The new site must preserve this. Do not drift toward light/white-dominant layouts.

Derive exact hex values from the logo — but the palette direction is:

| Token | Role | Direction |
|---|---|---|
| `--color-surface-dark` | Primary background | Near-black, slightly warm. Think #1a1714 range. |
| `--color-surface-mid` | Cards, sections | Dark charcoal, 10–15% lighter than surface. |
| `--color-surface-light` | Subtle section breaks | Warm dark gray. Never pure white backgrounds. |
| `--color-accent-warm` | Primary accent | Amber/golden-brown wood tone. Rich, not orange. Think #c8864a or similar. |
| `--color-accent-warm-light` | Hover states, highlights | 15–20% lighter version of accent warm. |
| `--color-text-primary` | Body text on dark | Warm off-white. Not pure #ffffff — too harsh. Think #f0ebe3. |
| `--color-text-muted` | Secondary text, captions | Warm gray. #9e9287 range. |
| `--color-text-accent` | Links, labels, tags | Match accent warm. |
| `--color-border` | Dividers, card borders | Subtle — warm dark. 1px lines only. |
| `--color-success` | In stock badge | Muted warm green. Not neon. |
| `--color-neutral` | Out of stock / muted | Gray-brown. |

**The single most important color rule:** The warm amber accent (`--color-accent-warm`) is used sparingly and with intention — CTAs, hover states, active nav items, price displays. It is not a wallpaper color. When it appears, it should feel like firelight.

### 2.3 Typography — CREATIVE DIRECTION

**Locked constraint:** Must load from Google Fonts (free, no license issues). Must render cleanly in a browser without a build step.

**Direction:** The pairing must feel like a fine woodworking catalog or a high-end Pacific Northwest brand journal. Refined, not rustic.

**Recommended pairing (developer will implement exactly this unless design agent proposes something clearly superior):**

| Role | Font | Weight | Usage |
|---|---|---|---|
| Display / Hero | `Cormorant Garamond` | 300, 400, 600 | Hero headlines, section titles, product names |
| UI / Body | `DM Sans` | 300, 400, 500 | Body copy, nav, form labels, buttons, prices |
| Optional accent | `Cormorant Garamond Italic` | 400i | Taglines, pull quotes, category labels |

**Type scale (CSS variables):**
```
--font-display: 'Cormorant Garamond', Georgia, serif;
--font-body: 'DM Sans', system-ui, sans-serif;

--text-xs:   0.75rem   /* 12px — labels, badges */
--text-sm:   0.875rem  /* 14px — captions, meta */
--text-base: 1rem      /* 16px — body */
--text-lg:   1.125rem  /* 18px — lead text */
--text-xl:   1.25rem   /* 20px — card titles */
--text-2xl:  1.5rem    /* 24px — section subheads */
--text-3xl:  2rem      /* 32px — section heads */
--text-4xl:  2.75rem   /* 44px — page heroes */
--text-5xl:  3.75rem   /* 60px — hero display */
--text-6xl:  5rem      /* 80px — hero display max */
```

Letter-spacing on display type: generous. `0.04em` to `0.08em` on headings. Creates that luxury-catalog feel.

### 2.4 Spacing & Layout System

```
--space-1:   4px
--space-2:   8px
--space-3:   12px
--space-4:   16px
--space-5:   24px
--space-6:   32px
--space-7:   48px
--space-8:   64px
--space-9:   96px
--space-10:  128px

--max-width-content: 1200px
--max-width-narrow:  760px
--max-width-wide:    1440px

Section vertical padding: --space-9 (96px) minimum. Generous whitespace is intentional.
```

### 2.5 Visual Texture & Atmosphere

The design should have **depth and atmosphere**, not flat color fields.

- **Subtle grain overlay:** A 3–5% opacity noise/grain texture on dark backgrounds. CSS-only or lightweight SVG filter. Evokes wood grain without being literal.
- **Section dividers:** Never a horizontal rule. Use negative space, or a thin 1px warm-tinted line at 20% opacity.
- **Card treatment:** Slight warm border (`--color-border`), subtle box shadow with warm tint (not cold gray drop shadows). Cards should feel like they're sitting on a surface, not floating in void.
- **Photography treatment:** Portfolio/product images shown at full color, no filters. Let the woodwork speak. Slight 2px warm border or no border — not harsh white frames.
- **Hover on interactive elements:** Smooth transitions (200–300ms ease). Accent color reveals, not jarring color flips.

---

## 3. Site Architecture

```
studio37customdesigns.com/
├── /                    Home
├── /services            Services (all specialties)
├── /portfolio           Portfolio gallery
├── /shop                Product shop (Snipcart)
├── /about               About Drew
├── /contact             Quote request form
└── /admin               Admin panel (password protected — different aesthetic)
```

**Navigation (desktop):**
```
[LOGO]    HOME  |  SERVICES  |  PORTFOLIO  |  SHOP  |  ABOUT    [GET A QUOTE →]
```

- Logo left-anchored
- Nav links centered or right of logo with generous spacing
- "GET A QUOTE" is a distinct CTA button — accent color border, not a plain text link
- On scroll: nav becomes subtly more opaque/elevated (sticky header effect)
- Mobile: hamburger → full-screen overlay nav, dark background, large display-font links

---

## 4. Page-by-Page Design Specifications

---

### 4.1 HOME PAGE (`/`)

#### Hero Section
- **Full viewport height** (100vh minimum)
- Background: His best large portfolio photo (full-bleed). Dark gradient overlay from bottom (dark to transparent) so text is legible. **Not a solid color background — always a photo.**
- Content position: Lower-left or centered — choose based on photo composition
- Elements:
  - Small all-caps label: `STUDIO 37 CUSTOM DESIGNS` in `--font-body`, `--text-sm`, warm muted color, letter-spacing 0.15em
  - Main headline (display font, large): `Crafted by Hand.` or `Custom Woodworking & Design` — two lines, large, generous line-height
  - Sub-headline: `Handcrafted in the Pacific Northwest by Drew Trano` — body font, muted
  - Two CTA buttons side by side: **[View My Work]** (ghost/outline) + **[Get a Quote →]** (solid accent)
- Scroll indicator: Subtle animated chevron or line at bottom center

#### Services Strip
- 5 horizontal cards (or 2-row grid on mobile)
- Dark surface-mid background
- Each card: icon (SVG — hand tool / wood grain appropriate), service name in display font, 1-line description
- Cards: `Cabinetry` | `Slab Flattening` | `Custom Furniture` | `Small Goods` | `General Contracting ★`
- GC card has a "Coming Soon" badge — warm accent color, small, top-right corner of card
- Hover: subtle accent color border reveal, slight upward translate

#### Featured Work
- Section title: `The Work` (display font, left-aligned or centered)
- 3-column asymmetric grid OR a large featured image left + 2 stacked images right
- Overlay on hover: project type label in accent color
- Footer CTA: `See the Full Portfolio →`

#### About Teaser
- Two-column: large portrait photo of Drew (left) + text block (right)
- Text: his origin story snippet (2–3 sentences from existing About copy)
- Sub-element: small detail — "Est. 2017" or a wood grain rule line
- CTA: `About Drew →`

#### Quote CTA Banner
- Full-width dark section, distinctly different from surrounding sections
- Could use a background texture or very subtle wood grain photo (darkened heavily)
- Large display headline: `Ready to Start Your Project?`
- Sub: `Tell me what you're building. I'll get back to you the same day.`
- Single CTA button: `Request a Quote`
- This section should feel like a moment of emphasis — the weight of the page lands here

#### Footer
- Dark background (darkest surface)
- Three columns: Logo + tagline | Navigation links | Social + contact
- Thin warm dividing line above footer
- Instagram icon (links to `@studio37_customwoodworking`) + Pinterest
- Copyright line: `© 2026 Studio 37 Custom Designs`
- Optional: `Site by Brandtworks-Enterprises LLC` (discuss with Drew)

---

### 4.2 SERVICES PAGE (`/services`)

#### Page Hero
- Shorter than homepage — 40–50vh
- Background: photo of a cabinet or slab piece in progress (workshop, not finished product)
- Title: `Services` in large display type
- Subtitle: `Custom work built to last generations`

#### Service Sections (one per service — full-width alternating layout)

Each service is a two-column section: **image left / text right** alternating with **text left / image right**.

Content per service block:
- Service name (display font, h2 size)
- Short description (2–3 paragraphs)
- "What's included" list (simple bullet or checklist style, not a formal table)
- Price indicator: `Starting at $X` or `Custom quote` — displayed as a subtle callout
- Timeline indicator: `Typical timeline: 4–8 weeks` — small, muted
- CTA: `Inquire About [Service Name] →`

**Services to include in this exact order:**
1. **Custom Cabinetry** — Kitchen, bathroom, built-ins, entertainment centers
2. **Slab Flattening** — Specialty service. Explain: live edge slabs, router sled, made flat and ready for finishing. B2B and B2C.
3. **Custom Furniture** — Tables, benches, beds, shelving, media consoles
4. **Small Goods & Gifts** — Cutting boards, charcuterie boards, serving pieces, custom gifts
5. **General Contracting** — Coming Soon. Full-width banner treatment, different from the other sections. Dark background, large text: `General Contractor License — Coming Soon`. Sub: `Drew is currently obtaining his Oregon GC license...` CTA: `Join the Waitlist` (captures email/phone).

---

### 4.3 PORTFOLIO PAGE (`/portfolio`)

#### Filter Bar
- Sticky at top of gallery area (below nav)
- Pill-style filter buttons: `All` | `Cabinetry` | `Furniture` | `Slab Work` | `Small Goods`
- Active filter: accent color fill
- Inactive: ghost/outline style

#### Gallery Grid
- **Masonry layout** — variable height cards in a multi-column grid
- Desktop: 3 columns. Tablet: 2 columns. Mobile: 1 column.
- Each image: slight hover overlay with project category label in accent color
- Click: lightbox/modal — full-size image, left/right navigation, caption
- Caption: `[Category] — [Wood species or material note if known]`
- No hard frames around images — they sit cleanly in the grid with consistent gap spacing

#### "Have a Project in Mind?" CTA
- After gallery, full-width CTA strip
- `Every piece is one of a kind. Let's build yours.`
- Button: `Start a Conversation`

---

### 4.4 SHOP PAGE (`/shop`)

This is a **live e-commerce page** powered by Snipcart. Products are loaded dynamically from the product API (`/api/products`). The page renders a loading skeleton while products fetch, then populates.

#### Shop Hero
- Shorter hero — 30vh
- Title: `The Shop`
- Subtitle: `Handcrafted goods, ready to ship`

#### Filter Bar
- Same pill-style as portfolio: `All` | `Cutting Boards` | `Charcuterie` | `Furniture` | `Custom Pieces`

#### Product Grid
- 3 columns desktop, 2 tablet, 1 mobile
- Product card anatomy:
  ```
  ┌─────────────────────────┐
  │                         │
  │    [Product Photo]      │  ← 4:3 or square ratio, object-fit cover
  │                         │
  ├─────────────────────────┤
  │  Category label         │  ← small caps, accent color, --text-xs
  │  Product Name           │  ← display font, --text-xl
  │  Wood species subtitle  │  ← body font italic, --text-sm, muted
  │                         │
  │  $135.00                │  ← body font medium, accent color
  │                         │
  │  [Add to Cart]  or      │  ← solid accent button
  │  [Request This Item]    │  ← ghost button for by_request items
  └─────────────────────────┘
  ```
- Out of stock: card is slightly desaturated, "Out of Stock" label badge, no add-to-cart button
- By Request: "Available by Request" badge, `Request This Item` CTA goes to contact form pre-filled with product name

#### Loading State
- Skeleton cards — same dimensions as real cards, with subtle shimmer animation (CSS only)
- Show 6 skeleton cards while products load

#### Snipcart Cart
- Snipcart's default cart drawer — override CSS variables to match site palette (dark background, warm accent, matching fonts)
- Cart icon in nav header — show item count badge

---

### 4.5 ABOUT PAGE (`/about`)

#### Hero Portrait Section
- Large, centered or left-anchored: Drew's headshot
- Atmospheric — not a mugshot. Photo treatment with dark vignette or warm gradient edge.
- Headline: `Built on a Love of Wood` or similar

#### Origin Story
- Full narrative from existing site (preserved exactly as written — it's genuinely good copy)
- Display font for lead paragraph (larger, more weight)
- Body font for remainder
- Pull quote: pick the most resonant sentence, display it large with a warm accent rule

#### Craft Details Section
- 3-column info cards (or horizontal rule list):
  - `Local & Exotic Timbers` — "I work with both local Pacific Northwest species and imported exotic woods"
  - `Heirloom Quality` — "Built to outlast the builder. Every joint, every finish."
  - `Pacific Northwest` — "Based in Eastern Oregon, serving the region and beyond"

#### GC License Section
- Simple callout box (accent-bordered card)
- `General Contractor License — In Progress`
- Brief note about what that enables
- Link to Services page GC section

---

### 4.6 CONTACT / GET A QUOTE PAGE (`/contact`)

This is a **sales page first**, contact page second. Copy and design should reflect urgency and confidence, not help-desk neutrality.

#### Hero
- Short — 25–30vh
- Title: `Let's Build Something`
- Sub: `Tell me about your project. I'll get back to you within 24 hours.`

#### Two-Column Layout
- Left column (40%): Context copy
  - Drew's approach to custom work
  - What to expect after submitting (he'll reach out personally)
  - Response time: same or next day
  - His email as a plain text link (for people who prefer email)
  - Instagram link
- Right column (60%): The quote request form

#### Quote Request Form Design
Fields (in order):
1. First Name + Last Name (side by side on desktop, stacked on mobile)
2. Phone Number
3. Email Address
4. **Service Type** — styled dropdown: Cabinetry / Slab Flattening / Custom Furniture / Small Goods / General Contractor Work / Other
5. **Project Description** — large textarea, placeholder: *"Describe your project — dimensions, materials, timeline, anything that will help me understand your vision."*
6. **Project Location** — text input, placeholder: *"City or region (helpful for installation projects)"*
7. **Estimated Budget** — styled dropdown: Under $500 / $500–$2,000 / $2,000–$5,000 / $5,000+ / Not Sure Yet
8. **Preferred Contact Method** — radio buttons styled as pill toggles: Phone Call / Text Message / Email
9. **How did you find us?** — dropdown: Google / Instagram / Pinterest / Referral / Other
10. **Photo Upload** — drag-and-drop zone OR "Click to upload" — up to 3 images, JPG/PNG, 10MB max. Helpful for reference images, existing space photos, etc.
11. Submit button: `Send My Request →` — full-width on mobile

**Form style guidelines:**
- Dark background on the form area — not a white/light card on a dark page
- Labels: small caps, `--text-sm`, muted color, above the input
- Inputs: dark surface with warm border on focus (accent color), warm placeholder text
- Submit button: full accent color, display font, generous padding
- Success state: replace form with a warm confirmation message — `Thank you, [Name]. Drew will be in touch soon.`

---

### 4.7 ADMIN PANEL (`/admin`)

**This is a functional tool, not a marketing page.** Different aesthetic from the main site — but should still feel cohesive (same color palette, same fonts). Think: backstage, not front-of-house.

#### Login Screen
- Centered card on dark background
- Studio 37 logo at top
- Single password field + "Enter Admin" button
- No username — password only
- Wrong password: shake animation on card, red-tinted error message

#### Main Admin UI (post-login)

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  [Logo]  Studio 37 Admin                    [+ New Product]  │
├──────────────────────────────────────────────────────────────┤
│  Filter: [All ▾]  [Available ▾]  [Category ▾]  🔍 Search    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [img 80x80] │ Product Name            │ $135 │ ●Avail│   │
│  │             │ Category · Wood species │      │ [Edit]│   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [img 80x80] │ Product Name            │ $55  │ ●Avail│   │
│  └──────────────────────────────────────────────────────┘   │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

**Status indicators:**
- `● Available` — warm green dot
- `○ Out of Stock` — gray dot
- `◎ By Request` — amber dot
- `✕ Archived` — red-tinted, row slightly desaturated

**Product Edit / New Product Modal (or slide-in panel):**
```
┌─────────────────────────────────────────────────────────┐
│  Edit Product                                    [✕ Close]│
├─────────────────────────────────────────────────────────┤
│  Product Name:    [                              ]       │
│  Subtitle:        [                              ]       │
│  Category:        [Dropdown ▾                    ]       │
│  Price:           [$  ___.___ ]                          │
│  Status:          ○ Available  ○ Out of Stock            │
│                   ○ By Request  ○ Archive                │
│                                                          │
│  Description:     [                              ]       │
│                   [                              ]       │
│                   [                              ]       │
│                                                          │
│  Images:          ┌────────────────────────────┐        │
│                   │  Drag & drop or click       │        │
│                   │  to upload (up to 5)        │        │
│                   └────────────────────────────┘        │
│                   [img1.jpg ✕] [img2.jpg ✕]              │
│                                                          │
│  Shipping:        [✓] Ships to USA                       │
│                                                          │
│           [Cancel]              [Save Product]           │
└─────────────────────────────────────────────────────────┘
```

The modal should slide in from the right on desktop (drawer pattern), full-screen on mobile.

---

## 5. Component Library (Reusable Elements)

The developer needs these as standalone, reusable CSS components. Each should be documented in the mockup.

| Component | Notes |
|---|---|
| `btn-primary` | Solid accent fill, display font, `text-sm` caps, generous padding, hover darken |
| `btn-ghost` | Transparent, accent border, accent text, hover fill |
| `btn-muted` | Muted surface, muted text — for secondary actions |
| `badge` | Small pill — status labels, category tags |
| `badge-coming-soon` | Accent color variant |
| `badge-out-of-stock` | Neutral gray variant |
| `card` | Dark surface-mid, warm border, subtle shadow |
| `card-product` | Extends card — image top, content below, price + CTA |
| `card-service` | Extends card — icon, name, description, link |
| `form-field` | Label + input/select/textarea — dark surface, focus state |
| `form-field-upload` | Drag-and-drop zone variant |
| `nav` | Sticky header — logo, links, CTA button, cart icon |
| `nav-mobile` | Full-screen overlay nav |
| `footer` | Three-column footer layout |
| `section-hero` | Full-height photo hero with gradient overlay |
| `section-hero-short` | 30–50vh variant |
| `section-cta-banner` | Full-width emphasis section |
| `gallery-grid` | Masonry or CSS grid gallery |
| `lightbox` | Full-screen image modal with navigation |
| `product-skeleton` | Loading skeleton matching card-product dimensions |
| `filter-bar` | Pill-style filter buttons with active state |
| `snipcart-overrides` | CSS variable overrides to match Snipcart cart to site palette |

---

## 6. Responsive Breakpoints

```
--bp-mobile:   375px   (design at 390px)
--bp-tablet:   768px
--bp-desktop:  1024px
--bp-wide:     1440px
```

Design **mobile-first**. Drew's customers (especially gift buyers) will frequently be on phones. The shop and contact form must be pixel-perfect on mobile.

Critical mobile considerations:
- Nav: hamburger → full-screen overlay
- Product grid: single column
- Form fields: full-width, large tap targets (min 48px height)
- Admin panel: functional on mobile (Drew may use it from his phone)
- Hero text: reduce scale significantly — `--text-5xl` on desktop becomes `--text-3xl` on mobile

---

## 7. Existing Assets Available

All assets are already scraped from the current Wix site at full resolution. They are organized and available for immediate use:

| Asset | Count | Status |
|---|---|---|
| Logo | 1 PNG | ✅ Ready |
| Drew's headshot | 1 JPG | ✅ Ready (2021 — may update later) |
| Homepage portfolio photos | 3 JPGs | ✅ Ready |
| Shop product images | 36 files (20 products, most with 2 angles) | ✅ Ready — web-optimized |

**Product catalog (scraped from Wix — 20 products):**

| Product | Price | Status |
|---|---|---|
| Custom English Walnut Swing Seat | $295 | Available |
| Cascade Coasters with Holder | $95 | Available |
| Custom Side Table | $2,100 | By Request |
| Custom Black Walnut Rectangle Charcuterie Board | $55 | Available |
| Custom McKenzie River Pizza Paddle | $130 | Available |
| Timber Hollow Chopping Block / Eastern Black Walnut | $135 | Available |
| Black Walnut Clipboard | $35 | Available |
| Large Countertop Prep Cutting Board | $180 | Available |
| Hand Crafted Butcher Block with Juice Groove | — | Out of Stock |
| Cutting Board | $30 | Available |
| Black Walnut Live Edge Coffee Table | $2,800 | By Request |
| Handcrafted Edge Grain Cutting Board/Charcuterie Board | $160 | Available |
| Handcrafted Black Walnut Cutting Board | $65 | Available |
| Handcrafted Charcuterie Board | $155 | Available |
| Handcrafted Live Edge Black Walnut Bench | $749.95 | By Request |
| Monkeypod Butcher Block | — | Out of Stock |
| Eastern Black Walnut Cutting Board | — | Out of Stock |
| Handcrafted Butcher Block | — | Out of Stock |
| Chess Board or Cutting Board | — | Out of Stock |
| Live Edge Tables (starting at $700/linear ft) | $700+ | By Request |

> Note: Out-of-stock products need owner confirmation before new site launch — they may be restockable, by-request, or truly discontinued.

---

## 8. Interaction & Animation Guidelines

**Philosophy:** Purposeful motion. Nothing gratuitous. Every animation must make the interface feel more responsive and alive — not decorative for its own sake.

| Element | Animation | Spec |
|---|---|---|
| Page load | Fade in + slight upward translate on hero text | `opacity 0→1, translateY 20px→0, 600ms ease-out` |
| Scroll reveals | Fade up on portfolio cards, service cards | `opacity 0→1, translateY 30px→0, 500ms ease, staggered 80ms` |
| Nav on scroll | Subtle backdrop-blur + increased opacity | CSS `transition: background 300ms ease` |
| Button hover | Smooth color transition | `transition: all 200ms ease` |
| Card hover | Slight elevation (shadow increase) + image subtle zoom | `transform: translateY(-2px), img scale(1.03), 250ms ease` |
| Portfolio hover | Overlay fade-in with category label | `opacity 0→0.85, 200ms ease` |
| Form focus | Border color transition to accent | `border-color transition 150ms ease` |
| Cart icon | Count badge pop when item added | `transform: scale(1.3→1), 200ms ease` |
| Loading skeleton | Shimmer sweep | CSS gradient animation, 1.5s infinite |
| Admin modal | Slide in from right | `transform: translateX(100%→0), 300ms ease` |
| Admin login error | Card shake | CSS keyframes shake, 400ms |

**No scroll-jacking. No parallax effects. No autoplay video.** These break mobile experience and accessibility.

---

## 9. SEO & Meta Defaults (For Mockup Annotations)

Each page should show these meta zones in wireframes:
- `<title>` — page-specific
- `meta description` — 150–160 chars
- `og:image` — 1200×630px social share image (use portfolio photo)

Default title pattern: `[Page] | Studio 37 Custom Designs`

---

## 10. What the Mockup Set Must Include

Deliver mockups at these breakpoints for these pages. Priority order:

### Required (P0 — blocking for development)
- [ ] Home — Desktop (1440px)
- [ ] Home — Mobile (390px)
- [ ] Shop — Desktop
- [ ] Shop — Mobile
- [ ] Contact/Quote Form — Desktop
- [ ] Contact/Quote Form — Mobile
- [ ] Admin Panel — Desktop (product list + edit modal)
- [ ] Admin Panel — Mobile (product list + edit form full-screen)

### Required (P1 — needed before dev is complete)
- [ ] Services — Desktop
- [ ] Portfolio — Desktop
- [ ] About — Desktop
- [ ] Nav (desktop) + Nav overlay (mobile)
- [ ] Footer
- [ ] Component Library sheet (all reusable components on one artboard)

### Nice to Have (P2)
- [ ] Services — Mobile
- [ ] Portfolio — Mobile
- [ ] About — Mobile
- [ ] Product card — hover state
- [ ] Snipcart cart drawer — styled to match site palette
- [ ] Loading skeleton states for shop

---

## 11. Do Not Do List

Hard stops. Do not deviate from these:

- ❌ Do not use a light/white primary background. This is a dark-palette site.
- ❌ Do not use Inter, Roboto, Arial, or system fonts for display text
- ❌ Do not use purple gradients or any gradient that doesn't belong in a wood shop
- ❌ Do not redesign or replace the Studio 37 logo
- ❌ Do not make the site look like a generic Shopify theme
- ❌ Do not use parallax scrolling or scroll-jacking
- ❌ Do not use carousel/slider components — they hide content and are a mobile nightmare
- ❌ Do not use floating chat widgets — the contact form IS the chat
- ❌ Do not use stock photography — only Drew's actual work photos

---

*This document is the complete source of truth for design decisions. Build against it directly.*  
*Prepared by Brandtworks-Enterprises LLC on behalf of Studio 37 Custom Designs.*
