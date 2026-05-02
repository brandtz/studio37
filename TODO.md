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

- [x] **Home** ([src/index.html](src/index.html)) — hero ✓, services strip ✓, featured work ✓, about teaser ✓, quote CTA ✓, featured shop ✓ (live data via [home.js](src/assets/js/home.js) with static fallback), scroll indicator ✓, footer ✓
- [x] **Services** (`src/services.html`) — alternating sections, GC waitlist; slab flattening section rewritten with $85/hr rate ✓
- [x] **Portfolio** (`src/portfolio.html`) — masonry grid, filter pills, lightbox modal
- [x] **About** (`src/about.html`) — portrait, story, craft cards, GC callout
- [x] **Contact / Quote** (`src/contact.html`) — form, validation, success state
- [x] Logo fix — generated [logo-mark.png](src/assets/images/logo-mark.png) (cream silhouette on transparent) for use on dark surfaces (nav + footer); original `logo.png` retained for favicon

## Phase 2 — Commerce

- [x] **Shop** ([src/shop.html](src/shop.html)) — product grid, skeleton load, filter pills (all/cutting-boards/charcuterie/furniture/custom), sticky filter bar, archived items hidden, out-of-stock disables Add-to-Cart
- [~] Snipcart integration with **Square** as the payment gateway — code wired (v3.7.1, `loadStrategy: on-user-interaction`) via runtime config from [/api/public-config](src/netlify/functions/public-config.mjs); awaiting Drew's Square account + Snipcart dashboard config to set `SNIPCART_PUBLIC_KEY` env var
- [x] Snipcart CSS overrides to match palette — full token map in [snipcart.css](src/assets/css/snipcart.css) (buttons, inputs, modal, badges, links, typography)
- [x] `data-item-url` validation endpoint live ([/api/products/:id](src/netlify/functions/products.mjs)) — returns Snipcart-formatted JSON via `toSnipcartProduct()`
- [x] Order webhook → SMS to Drew ([/api/order-notify](src/netlify/functions/order-notify.mjs)) — includes Snipcart `X-Snipcart-RequestToken` signature verification against `requestvalidation` API; rejects 401 if `SNIPCART_SECRET` missing or token invalid
- [x] Runtime Snipcart key bootstrap — [commerce.js](src/assets/js/commerce.js) fetches `/api/public-config` and injects script + stylesheet (no build-time placeholder substitution needed; checkout disables gracefully when key absent)

## Phase 3 — Admin Panel

- [x] **Admin login** ([src/admin/index.html](src/admin/index.html)) — password gate, sessionStorage, shake-on-error
- [x] Product list with filters — search + status + category, status dot indicators, thumbnails
- [x] Edit/Create drawer (slide-in from right) — full field set, pill-radio status, pendingImages handling
- [x] Image upload → Cloudflare R2 (via [admin-upload.mjs](src/netlify/functions/admin-upload.mjs)) — client wired; awaiting R2 credentials to test live
- [x] Soft-delete (archive) flow — archive button on each row + restore button on archived; uses DELETE on [admin-products.mjs](src/netlify/functions/admin-products.mjs) which sets `status: archived`
- [x] Leads view — wired to new [/api/admin/leads](src/netlify/functions/admin-leads.mjs); displays tel:/mailto: links
- [x] Admin sidebar logo fix — swapped to [logo-mark.png](src/assets/images/logo-mark.png) (cream silhouette), removed broken `brightness(0) invert(1)` filter

## Phase 4 — Backend

- [x] `products.mjs` — list (cents, non-archived) + single (Snipcart validation format with `toSnipcartProduct()`); `cache-control: public, max-age=30` on list
- [x] `admin-products.mjs` — auth via `X-Admin-Key`, full CRUD + sanitize() on Netlify Blobs; soft-delete sets `status: archived`; POST returns 409 on duplicate ID
- [x] `admin-upload.mjs` — multipart → R2 via `@aws-sdk/client-s3`; requires `R2_*` env vars; awaiting R2 bucket + creds to smoke test
- [x] `quote-request.mjs` — FormData → Twilio SMS + Blobs `leads` store; honeypot short-circuit on `bot-field`
- [x] `order-notify.mjs` — Snipcart webhook → Twilio SMS; `X-Snipcart-RequestToken` verified against Snipcart requestvalidation API using `SNIPCART_SECRET`
- [x] `seed-products.mjs` — admin-key gated; refuses if store non-empty unless `?force=1`; bootstraps from [products.seed.json](src/netlify/functions/_lib/products.seed.json)
- [x] `public-config.mjs` — public-safe runtime config (Snipcart public key, site URL, currency); `cache-control: public, max-age=300`
- [x] `admin-leads.mjs` — GET leads from Blobs `leads` store, sorted newest-first; admin-key gated

## Phase 5 — Polish

- [x] SEO: per-page `<title>`, meta description, OG/Twitter tags, canonical URLs — all 7 pages; tightened to Eastern Oregon / service-specific copy
- [x] OG image — [og-image.jpg](src/assets/images/og-image.jpg) at 1200×630 with dark overlay + branding
- [x] `sitemap.xml` (with `lastmod` + `changefreq`), `robots.txt`
- [x] Favicon + Apple touch icon — [icon-32.png](src/assets/images/icon-32.png), [icon-180.png](src/assets/images/icon-180.png), [icon-192.png](src/assets/images/icon-192.png), [icon-512.png](src/assets/images/icon-512.png); wired into all pages
- [x] Web app manifest — [manifest.json](src/manifest.json) with icons, theme-color, start_url; `<link rel="manifest">` + `<meta name="theme-color">` wired into all 7 pages
- [x] Mobile responsive CSS — breakpoints at 1024/768/480px; 480px adds: hero type scaling, services 1-col, filter pill sizing, card footer stacking
- [x] Admin CSS components — added `.pill-group`/`.pill-radio` (status selector), `.upload-zone`, `.form-row`; admin 768px adds form-row collapse + toolbar wrap
- [x] Form spam protection — honeypot `bot-field` in [contact.html](src/contact.html) + [quote-request.mjs](src/netlify/functions/quote-request.mjs); Netlify Forms attribute activates on deploy
- [x] 404 page ([src/404.html](src/404.html)) — added missing `<meta name="description">`
- [x] Sticky shop filter bar with backdrop-blur
- [ ] Mobile QA at 390 / 768 / 1024 / 1440 — **run after Netlify deploy**
- [ ] Lighthouse pass (Perf, A11y, SEO each ≥ 90) — **run after Netlify deploy**

## Phase 6 — Deploy

- [ ] **Netlify site created** — connect `github.com/brandtz/studio37` repo, set publish=`src`, functions=`src/netlify/functions`
- [ ] **Env vars** — copy from [.env.example](.env.example); fill in `ADMIN_KEY` (generate a strong random string), then add Twilio/Snipcart/R2 values as Drew provides them
- [x] **Seed products** — auto-bootstrap on first request: if Blobs `products` store is empty, [products.mjs](src/netlify/functions/products.mjs) / [admin-products.mjs](src/netlify/functions/admin-products.mjs) seed the 20 starter products from [products.seed.json](src/netlify/functions/_lib/products.seed.json); manual [/api/seed-products](src/netlify/functions/seed-products.mjs) remains available for forced reset
- [ ] Snipcart account + Square gateway connected (Drew)
- [ ] Twilio phone number + Drew's number on file (Drew)
- [ ] Cloudflare R2 bucket + creds (Drew — see [docs/setup/cloudflare-r2.md](docs/setup/cloudflare-r2.md))
- [ ] DNS transfer for `studio37customdesigns.com` (Drew)
- [ ] Smoke test: quote form → SMS, $0.01 test order → order SMS, admin CRUD round-trip
- [ ] Mobile QA at 390 / 768 / 1024 / 1440 + Lighthouse pass
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
- [!] Slab flattening photos (5 target images) — owner to commit to
  `src/assets/images/portfolio/slab-flattening/` as `slab_1.jpg` through `slab_5.jpg`
- [!] Custom cabinetry photos (4 target images) — owner to commit to
  `src/assets/images/portfolio/cabinetry/` as `cabinetry_1.jpg` through `cabinetry_4.jpg`
- [!] Conference table photos (3 target images) — owner to commit to
  `src/assets/images/portfolio/conference-tables/` as `conference_table_1.jpg` through `conference_table_3.jpg`
- [!] Slab flattening pricing confirmed: $85/hr — wired into site copy ✓

---

## Notes

- **Payment gateway decision:** Square (per Drew, May 2026). Snipcart natively supports Square as a checkout gateway, so the architecture documented in `docs/studio37_commerce_architecture.md` stands — only the gateway selection in the Snipcart dashboard changes. Stripe references in older docs should be read as "payment gateway" generically.
- **Reference prototype:** `docs/design_handoff/Studio 37.html` is the visual source of truth. Open in a browser to compare against production builds.
- **Do not** break the "Do Not Do" list in `docs/studio37_design_context.md` § 11.
