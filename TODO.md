# Studio 37 Custom Designs — Build TODO

> Working checklist for the Studio 37 site rebuild. Update status as items complete.
> Source-of-truth specs live in `docs/`. Production code lives in `src/`.

---

## Legend
- [ ] not started
- [~] in progress
- [x] complete
- [!] blocked / awaiting input

---

## Phase 0 — Scaffold & Foundations

- [x] Repo tidy: move docs to `/docs`, raw assets to `/_archive`, scaffold `/src`
- [x] `.gitignore`
- [x] `netlify.toml` (build, redirects, function bundling)
- [x] `package.json` (function dependencies)
- [x] `.env.example` (all required env vars)
- [x] `src/assets/css/tokens.css` (design tokens — copied from handoff)
- [x] `src/assets/css/site.css` (base + page styles)
- [x] `src/assets/css/admin.css` (admin styles)
- [x] `src/assets/js/site.js` (nav scroll, year, scroll reveal, mobile nav)
- [x] Stub all 7 page HTML files with shared head/nav/footer
- [x] Seed product catalog JSON (`src/netlify/functions/_lib/products.seed.json`)
- [x] Functions stubbed: `products`, `admin-products`, `admin-upload`, `quote-request`, `order-notify`, `seed-products`
- [x] `src/_redirects` for `/api/*` → functions and clean URLs

---

## Phase 1 — Marketing Pages (build to fidelity)

- [~] **Home** (`src/index.html`) — hero ✓, services strip ✓, featured work ✓, about teaser ✓, quote CTA ✓, **featured shop ✓ (live data via [home.js](src/assets/js/home.js) with static fallback)**, scroll indicator ✓, footer ✓
- [x] **Services** (`src/services.html`) — alternating sections, GC waitlist
- [x] **Portfolio** (`src/portfolio.html`) — masonry grid, filter pills, lightbox modal
- [x] **About** (`src/about.html`) — portrait, story, craft cards, GC callout
- [x] **Contact / Quote** (`src/contact.html`) — form, validation, success state
- [x] Logo fix — generated [logo-mark.png](src/assets/images/logo-mark.png) (cream silhouette on transparent) for use on dark surfaces (nav + footer); original `logo.png` retained for favicon

## Phase 2 — Commerce

- [ ] **Shop** (`src/shop.html`) — product grid, skeleton load, filter pills
- [ ] Snipcart integration with **Square** as the payment gateway (Stripe replaced — see `docs/decisions/square-vs-stripe.md`)
- [ ] Snipcart CSS overrides to match palette
- [ ] `data-item-url` validation endpoint live (`/api/products/:id`)
- [ ] Order webhook → SMS to Drew (`/api/order-notify`)

## Phase 3 — Admin Panel

- [ ] **Admin login** (`src/admin/index.html`) — password gate, sessionStorage
- [ ] Product list with filters
- [ ] Edit/Create drawer (slide-in from right)
- [ ] Image upload → Cloudflare R2
- [ ] Soft-delete (archive) flow

## Phase 4 — Backend

- [~] `products.mjs` — list + single (Snipcart validation format) — **stub written, needs `netlify dev` smoke test**
- [~] `admin-products.mjs` — auth via `X-Admin-Key`, full CRUD on Netlify Blobs — **stub written**
- [~] `admin-upload.mjs` — multipart → R2 — **stub written, needs R2 bucket + creds to test**
- [~] `quote-request.mjs` — POST → Twilio SMS + Blobs `leads` store — **stub written**
- [~] `order-notify.mjs` — Snipcart webhook → Twilio SMS — **stub written, needs signature verification before launch**
- [~] `seed-products.mjs` — one-shot bootstrap loader (admin-key gated) — **stub written**

## Phase 5 — Polish

- [~] SEO: per-page `<title>`, meta description, OG image — **basic tags in place; needs OG image asset + per-page descriptions tightened**
- [x] `sitemap.xml`, `robots.txt`
- [ ] Favicon + Apple touch icon (derived from logo)
- [ ] Mobile QA at 390 / 768 / 1024 / 1440
- [ ] Lighthouse pass (Perf, A11y, SEO each ≥ 90)
- [~] Form spam protection — **honeypot wired in `contact.js` + `quote-request.mjs`; Netlify spam filter still pending**
- [x] 404 page (`src/404.html`)

## Phase 6 — Deploy

- [ ] Netlify site created, repo connected
- [ ] Env vars set in Netlify dashboard
- [ ] Snipcart account + Square gateway connected
- [ ] Twilio phone number + Drew's number on file
- [ ] Cloudflare R2 bucket + creds
- [ ] DNS transfer for `studio37customdesigns.com`
- [ ] Smoke test: quote form → SMS, $0.01 test order → order SMS, admin CRUD round-trip
- [ ] Hand off admin password + Snipcart dashboard access to Drew

---

## Open Items / Awaiting Drew

- [!] Drew's mobile phone number (for Twilio SMS destination)
- [!] Drew's email confirmed: `Drew@studio37customdesigns.com` — verify spelling/case
- [!] Domain registrar login (for DNS transfer)
- [!] Updated headshot (current is from 2021)
- [!] Additional portfolio photos beyond the 3 from homepage
- [!] Pricing comfort — are the existing prices firm? Show "starting at" ranges on services?
- [!] Square account (created or to be created) — needed before Snipcart can be configured
- [!] Twilio account (SID, auth token, phone number) — needed for quote/order SMS
- [!] Cloudflare R2 setup — see [docs/setup/cloudflare-r2.md](docs/setup/cloudflare-r2.md)
- [!] GC license expected date (drives Phase 3 services-page update)
- Out-of-stock SKUs (chessboard, monkeypod, eastern-walnut, butcherblock-2, butcher-juice) — **decision: leave as out_of_stock for now per Drew**

---

## Notes

- **Payment gateway decision:** Square (per Drew, May 2026). Snipcart natively supports Square as a checkout gateway, so the architecture documented in `docs/studio37_commerce_architecture.md` stands — only the gateway selection in the Snipcart dashboard changes. Stripe references in older docs should be read as "payment gateway" generically.
- **Reference prototype:** `docs/design_handoff/Studio 37.html` is the visual source of truth. Open in a browser to compare against production builds.
- **Do not** break the "Do Not Do" list in `docs/studio37_design_context.md` § 11.
