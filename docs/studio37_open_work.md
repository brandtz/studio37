# Studio 37 Custom Designs — Open Work & Project Plan
**Document type:** Project Management + Business Systems Analysis  
**Last updated:** June 25, 2026  
**Status:** Active — updated as work completes or scope changes

---

## Table of Contents
1. [Project Summary](#1-project-summary)
2. [What Is Built & Live](#2-what-is-built--live)
3. [Priority Definitions](#3-priority-definitions)
4. [P0 — Launch Blockers](#4-p0--launch-blockers)
5. [P1 — Required Before Public Marketing](#5-p1--required-before-public-marketing)
6. [P2 — High Value, Ship Within 30 Days of Launch](#6-p2--high-value-ship-within-30-days-of-launch)
7. [P3 — Planned / Phased Work](#7-p3--planned--phased-work)
8. [P4 — Deferred / Future Consideration](#8-p4--deferred--future-consideration)
9. [Content & Asset Blockers (Drew)](#9-content--asset-blockers-drew)
10. [Third-Party Account Checklist](#10-third-party-account-checklist)
11. [Environment Variables Reference](#11-environment-variables-reference)
12. [DNS Migration Plan](#12-dns-migration-plan)
13. [Decision Log](#13-decision-log)

---

## 1. Project Summary

Studio 37 Custom Designs is a custom woodworking and design shop operated by Drew Trano in Springfield, Oregon. The site is a static HTML + Netlify Functions architecture (no build step) with a Stripe-connected commerce layer, an admin dashboard, and a transactional email + SMS notification pipeline.

**Goal of this document:** Provide a single prioritized reference for all identified open work — from launch blockers through longer-term feature development.

---

## 2. What Is Built & Live

| Area | Status | Notes |
|---|---|---|
| All marketing pages (Home, Services, Portfolio, About, Contact, Shop) | ✅ Live | Deployed at studio37customdesign.netlify.app |
| Design tokens + responsive CSS | ✅ Complete | Breakpoints at 1024 / 768 / 480px |
| Nav logo fix | ✅ Complete | Switched to `logo.png`, size increased to 72px desktop |
| CNC & Laser Engraving service | ✅ Complete | Replaced Sauna Kits tile; placeholder photo in place |
| Slab Flattening copy | ✅ Complete | CNC references removed; router gantry + 50"×18' capacity wired in |
| Sauna Kits | ✅ Hidden | Pages/content intact; all public links commented out for restoration later |
| Admin dashboard (Products, Orders, Leads, Reviews, Site Media, Settings) | ✅ Complete | Session-gated; 30 min idle / 8 hr hard expiry |
| Stripe Checkout + Cart | ✅ Complete | Connected-account model; server-side price revalidation |
| Order webhook → blob store | ✅ Complete | Idempotent; `lifecycle`, `status_history`, tracking fields |
| Resend email helper (`_lib/email.mjs`) | ✅ Complete | Order confirmation + lead notification + customer acknowledgement |
| Order confirmation email | ✅ Wired | Triggers on `checkout.session.completed`; awaiting Resend DNS verification |
| Lead notification email to Drew | ✅ Wired | Triggers on contact form submit; awaiting Resend DNS verification |
| Lead acknowledgement email to customer | ✅ Wired | Same trigger; awaiting Resend DNS verification |
| Quote-request function | ✅ Complete | Rate-limited, honeypot, persists to blob store |
| Twilio SMS (Drew) | ✅ Code-wired | Awaiting Twilio account + 4 env vars |
| Cloudflare R2 image uploads | ✅ Code-wired | Awaiting R2 bucket credentials |
| /order/confirmed page | ✅ Complete | Public post-checkout landing page |
| 404 page, sitemap, robots.txt | ✅ Complete | |
| Favicon, OG image, web manifest | ✅ Complete | |

---

## 3. Priority Definitions

| Priority | Meaning |
|---|---|
| **P0** | Hard launch blockers — site cannot go live or accept real payments without these |
| **P1** | Must be done before public marketing / directing real traffic to the site |
| **P2** | High value, ship within ~30 days of launch |
| **P3** | Planned feature work with defined scope; no hard deadline |
| **P4** | Identified but deliberately deferred; re-evaluate in a future sprint |

---

## 4. P0 — Launch Blockers

These items must be complete before the domain points to Netlify and real traffic flows.

---

### P0-1 · Resend DNS Verification
**Type:** Infrastructure / Third-party setup  
**Owner:** Developer + Drew (DNS access required)  
**Blocking:** All transactional email — lead notifications to Drew, customer acknowledgements, order confirmations

**Background:**  
`email.mjs` is coded and deployed. Resend will reject sends from `orders@studio37customdesigns.com` until the domain is verified in the Resend dashboard.

**Steps:**
1. Log into resend.com → Domains → Add domain → `studio37customdesigns.com`
2. Resend will produce up to 3 DNS records (DKIM, SPF, DMARC)
3. Log into Wix DNS panel (Drew's credentials) for `studio37customdesigns.com`
4. Add DKIM record (`resend._domainkey` TXT — no conflict risk)
5. Add DMARC record (`_dmarc` TXT — no conflict risk)
6. **Carefully** merge Resend's SPF into the existing Google Workspace SPF — do NOT add a second `v=spf1` record; it must be merged into the one that already includes `_spf.google.com`
7. Return to Resend → click Verify — status should go green within 5–30 minutes
8. Set Netlify env vars: `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`
9. Trigger a Netlify redeploy
10. Smoke test: submit contact form → Drew receives email → customer receives "request received" email

**Risk:** If Google Workspace SPF is overwritten (not merged), Drew's outgoing Gmail may go to spam. Merge only; never replace.

---

### P0-2 · Netlify Environment Variables — Full Set
**Type:** Infrastructure  
**Owner:** Developer  
**Blocking:** All functional features (auth, email, SMS, payments, image uploads)

All env vars must be set in Netlify → Site configuration → Environment variables before the production deploy.

See [Section 11 — Environment Variables Reference](#11-environment-variables-reference) for the full list.

**Currently missing values (awaiting Drew):**
- `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `DREW_PHONE`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`
- `STRIPE_WEBHOOK_SECRET` (connected-accounts), `STRIPE_WEBHOOK_SECRET_PLATFORM`
- `RESEND_API_KEY` (Drew has the key; must be pasted into Netlify)

---

### P0-3 · Cloudflare R2 Image Storage Setup
**Type:** Infrastructure / Third-party setup  
**Owner:** Drew + Developer  
**Blocking:** Admin → image upload for products, site media slots

**Background:**  
`admin-upload.mjs` is coded and deployed. Without R2 credentials, image uploads silently fail. All current product images reference placeholder paths.

**Steps:**
1. Create a Cloudflare account (or use existing if Drew has one)
2. Enable R2 (requires payment method — free tier is generous: 10 GB free)
3. Create a bucket named `studio37-media` (or your preference)
4. Create an R2 API token with read + write access to that bucket
5. Note the `Account ID`, `Access Key ID`, `Secret Access Key`, bucket name
6. Set the bucket's public URL or configure a custom domain for serving images
7. See `docs/setup/cloudflare-r2.md` for full walkthrough
8. Set `R2_*` env vars in Netlify
9. Smoke test: admin → Products → edit any product → upload a photo → confirm it loads from the R2 URL

---

### P0-4 · Stripe Webhook Endpoints Registered
**Type:** Infrastructure  
**Owner:** Developer + Drew (Stripe dashboard access)  
**Blocking:** Order processing, order confirmation emails, Drew's order SMS

**Background:**  
Stripe must be told where to send `checkout.session.completed` events. Two webhook endpoints are needed on Drew's connected Stripe account.

**Steps:**
1. Log into Stripe dashboard (Drew's account)
2. Developers → Webhooks → Add endpoint
   - URL: `https://studio37customdesigns.com/.netlify/functions/stripe-webhook`
   - Events to listen for: `checkout.session.completed`, `payment_intent.payment_failed`
   - Scope: Connected account
3. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` in Netlify
4. If a platform-level webhook is also configured, set that secret as `STRIPE_WEBHOOK_SECRET_PLATFORM`
5. Enable Stripe-generated payment receipts: Stripe dashboard → Settings → Emails → "Successful payments" → toggle ON (free, automatic, no code needed — covers the legally-required receipt layer)

---

### P0-5 · DNS Cutover from Wix to Netlify
**Type:** Infrastructure  
**Owner:** Developer (executes) + Drew (authorizes)  
**Blocking:** Real domain — site currently live only at `studio37customdesign.netlify.app`  
**Dependency:** P0-1 (Resend DNS) must be completed FIRST, then this runs as the final production switch

**Steps:**
1. Confirm all P0-1 through P0-4 items are complete and smoke-tested on the Netlify subdomain
2. Log into Wix → Domains → `studio37customdesigns.com` → Advanced DNS
3. Note current `A` record value for root (`@`) and `www` CNAME — record them somewhere before changing
4. In Netlify: Domains → Add custom domain → `studio37customdesigns.com` → Netlify will show you its IP/CNAME to point at
5. In Wix DNS: update `A` record for `@` to Netlify's IP (or add CNAME for `www`)
6. Do NOT touch MX records, existing TXT records, DKIM, SPF — only the A/CNAME for the website
7. Wait for propagation (5 min to 2 hours); confirm at `https://studio37customdesigns.com`
8. Netlify automatically provisions an SSL certificate via Let's Encrypt
9. Smoke test on real domain: contact form, product purchase, admin login

**Risk:** Short DNS propagation window where the site may be unreachable. Schedule during low-traffic hours.

---

## 5. P1 — Required Before Public Marketing

These do not block launch, but should be complete before driving any real traffic.

---

### P1-1 · Twilio Account + SMS Notifications Setup
**Type:** Third-party setup + infrastructure  
**Owner:** Drew (account creation) + Developer (env vars)  
**Blocking:** SMS order alerts and lead alerts to Drew's phone

**Background:**  
Code is fully wired in `stripe-webhook.mjs` and `quote-request.mjs`. SMS is silently skipped when Twilio env vars are absent — so launch is not blocked, but Drew will miss time-sensitive lead notifications until this is active.

**Steps:**
1. Drew: create account at twilio.com → verify phone
2. Drew: purchase a US phone number (recommend 541 or 971 area code — ~$1.15/mo)
3. Drew (or Developer): complete **A2P 10DLC registration** — legally required for application-to-person SMS in the US:
   - Console → Regulatory Compliance → Trust Hub → Customer Profile (Sole Proprietor)
   - Required info: legal name, address, EIN or SSN, website URL, Drew's cell
   - Register a Brand (~$4 one-time)
   - Register a Campaign (use case: "Mixed" — covers orders + leads; ~$2/mo)
   - Attach phone number to Campaign
   - Approval takes 1–3 business days
4. Developer: set `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `DREW_PHONE` in Netlify
5. Verify Drew's cell in Twilio Console while in trial mode
6. Smoke test: submit contact form → Drew receives SMS within 10 seconds
7. After 10DLC approval: upgrade Twilio from trial, remove verified-callers limitation

**Note:** Until 10DLC is approved, SMS can only be delivered to phone numbers manually verified in the Twilio Console. Start 10DLC the same day the Twilio account is created — the approval window is the long pole.

---

### P1-2 · CNC & Laser Engraving — Real Photos
**Type:** Content  
**Owner:** Drew (photos) + Developer (admin upload)  
**Currently:** Placeholder `coming-soon.svg` shown on services page

**Steps:**
1. Drew takes or selects 1–3 photos of CNC/laser work
2. Upload via admin → Site Media (once R2 is live), or
3. Developer imports directly to `src/assets/images/` as a stopgap
4. Update `src/services.html` `<img>` src for `#cnc-laser-engraving` article

---

### P1-3 · Mobile QA + Lighthouse Pass
**Type:** QA  
**Owner:** Developer  
**Blocking:** Confidence before sending real traffic

**Scope:**
- Test at 390px (iPhone 14 Pro), 430px (iPhone 15 Plus), 768px (iPad), 1024px (iPad landscape), 1440px (desktop)
- Verify: nav, hero, services strip, shop grid, cart drawer, checkout redirect, order confirmation page, admin dashboard
- Lighthouse targets: Performance ≥ 85, Accessibility ≥ 90, SEO ≥ 95, Best Practices ≥ 90
- Known mobile flags to check (from Phase 1.5 audit): admin sidebar overflow at narrow widths, cart drawer scroll on iOS, footer column stacking

---

### P1-4 · Stripe Payment Receipts Enabled
**Type:** Configuration (no code)  
**Owner:** Drew  
**Time:** 2 minutes

Log into Stripe dashboard → Settings → Emails → toggle ON "Successful payments". Customers get an automatic Stripe-branded receipt as the legally-required payment confirmation, independent of our branded order email.

---

### P1-5 · Pinterest URL Fix
**Type:** Bug  
**Owner:** Developer  
**File:** `src/assets/js/site.js` line 75  
**Detail:** Footer Pinterest link currently points to `https://www.pinterest.com/` (no username). Needs Drew's Pinterest URL or should be removed from the footer if not active.

---

## 6. P2 — High Value, Ship Within 30 Days of Launch

---

### P2-1 · Admin "Create Invoice" Feature
**Type:** New feature  
**Owner:** Developer  
**Status:** Identified, not yet planned in detail — tabled for a focused planning session

**Background:**  
Drew needs the ability to take a quote request and send the customer a formal invoice with a "Pay with Stripe" link. This closes the loop between a customer submitting a contact form and Drew getting paid for service work (slab flattening, CNC/laser, custom builds) without a traditional e-commerce checkout flow.

**Proposed scope (to be confirmed in planning interview):**

*MVP:*
- Admin → Orders section → "New Invoice" button
- Line item entry: description, quantity, unit price (supports time-based lines, e.g. "Laser engraving — 16 min @ $2/min")
- Optional setup fee line
- Free-text scope-of-work block
- Send via Stripe Invoices API (Stripe hosts the invoice page + auto-sends email with Pay button to customer)
- Invoice status visible in admin: Draft → Sent → Paid → Void
- Paid invoices appear in Orders list
- Audit log entry on create/send/pay/void

*Defer to v2:*
- "Convert lead to invoice" one-click from Leads list
- Deposit / partial payment support
- Stripe Tax automation
- SMS notification on invoice send

**Dependencies:** Stripe account connected and live, Resend DNS verified

---

### P2-2 · Sauna Kits Restoration
**Type:** Content + Feature re-enable  
**Owner:** Drew (readiness decision) + Developer (un-comment)  
**Status:** Fully built, all code/pages intact; hidden pending Drew's readiness

**When Drew is ready:**
1. Developer: un-comment the Sauna Kits service tile in `src/index.html`
2. Developer: un-comment the Sauna Kits callout band in `src/index.html`
3. Developer: restore nav link in `src/assets/js/site.js`
4. Developer: restore footer Explore link in `src/assets/js/site.js`
5. Developer: restore filter pill in `src/shop.html`
6. Developer: restore dropdown option in `src/contact.html`
7. Drew: add real sauna photos via Admin → Site Media (replaces `coming-soon.svg` placeholders)
8. Commit + push + Netlify deploys automatically

---

### P2-3 · General Contractor Section Restoration
**Type:** Content re-enable  
**Owner:** Drew (Oregon CCB license required)  
**Status:** Section built and commented out in `src/services.html` pending CCB license

**When CCB license is in hand:**
1. Un-comment the `#general-contracting` section in `src/services.html`
2. Add CCB license number to the copy
3. Restore the GC tile in the homepage services strip
4. Update contact form dropdown with GC option

---

### P2-4 · Order Refund Flow (Admin UI)
**Type:** Feature  
**Owner:** Developer  
**Status:** Deferred from Phase 1.5 Epic 4

**Background:**  
Currently, admins can lifecycle-tag an order as `refunded` (informational only). Actual money movement requires Drew to go into the Stripe dashboard manually. An in-app Refund button would streamline this.

**Proposed scope:**
- Admin → Orders → Order detail drawer → "Issue Refund" button (full refund only at MVP)
- Calls `stripe.refunds.create({ payment_intent: order.payment_intent })`
- Updates order lifecycle to `refunded`, adds status_history entry
- Audit log entry

**Hold condition:** Let the lifecycle workflow prove out for ~60 days post-launch before adding in-app refund capability (reduces risk of operator error on a new system).

---

### P2-5 · Additional Portfolio Photography
**Type:** Content  
**Owner:** Drew (photos) + Developer (admin upload or direct commit)

| Folder | Target count | Status |
|---|---|---|
| `portfolio/slab-flattening/` | 5 images | `slab_1.jpg` in place; `slab_2.jpg`, `slab_3.jpg` needed; `slab_4.jpg`, `slab_5.jpg` placeholder |
| `portfolio/cabinetry/` | 4 images | `barn_door_cabinet.jpg` in place; 3 more needed |
| `portfolio/conference-tables/` | 3 images | Folder empty — all 3 needed |
| CNC/Laser (new) | 1–3 images | No photos yet |

---

## 7. P3 — Planned / Phased Work

---

### P3-1 · Customer Accounts
**Type:** Feature  
**Status:** Deliberately deferred from Phase 1.5 Epic 4

**Background:**  
Magic-link authentication (via Resend), a `customers` Netlify Blobs store, customer JWT scope separate from admin JWT, `/account` page with order history, and a "Sign in / register" CTA at Stripe checkout.

**Rationale for deferral:** Single-tenant, low-volume store at launch. The current Stripe payment receipt + Studio 37 branded order email covers the customer communication need. Re-evaluate when repeat-purchase patterns emerge or when Drew requests account-based features.

---

### P3-2 · Notification System Phase 2 (SMS Full Setup)
**Type:** Feature enhancement  
**Dependency:** P1-1 (Twilio) + Resend DNS (P0-1)

**Scope:**
- Confirm Twilio 10DLC is approved and live
- Confirm SMS fires for both contact form leads and paid orders in production
- Consider: customer SMS confirmation on order (requires collecting mobile at checkout — currently phone is collected but not used for outbound SMS)
- Audit log entries for all notification sends/failures visible in admin

---

### P3-3 · Lighthouse + Core Web Vitals Optimization
**Type:** Performance  
**Dependency:** P1-3 (initial QA pass)

**Scope:**
- Image lazy-loading audit (already applied to portfolio, verify shop grid)
- Review LCP candidate on homepage hero (large image, above fold)
- Add `width`/`height` attributes to all `<img>` tags missing them (CLS)
- Consider `rel="preload"` for hero image
- Verify all pages score Performance ≥ 90 after images are real (placeholders inflate scores)

---

### P3-4 · Admin Audit Log
**Type:** Feature  
**Status:** Function `admin-audit-log.mjs` exists in the repo; UI integration not confirmed

**Scope:**
- Verify `admin-audit-log.mjs` is capturing events from products, orders, leads, users CRUD
- Add audit log tab to admin dashboard or surface in order/product drawers
- Retention: keep last 90 days or last 500 entries (whichever is smaller) — Netlify Blobs is not a database

---

### P3-5 · Site Settings Admin Panel (Email Templates, Shipping Rates, Tax)
**Type:** Feature  
**Status:** `admin-site-settings.mjs` exists; scope of what's configurable not fully defined

**Scope:**
- Shipping rate configuration (currently hardcoded in `stripe-checkout-session.mjs`: free over $150, $12 flat)
- Tax rate override
- Business contact info (phone, email, address) editable from admin instead of hardcoded in HTML
- "Maintenance mode" toggle (shows a "We'll be back soon" page, disables checkout)

---

## 8. P4 — Deferred / Future Consideration

| Item | Why Deferred |
|---|---|
| Multi-tenant support | Designed in (tenants.seed.json, tenant_id throughout), but Drew is the only tenant. Activate if platform expands. |
| Customer-initiated refunds / dispute flow | Too early. Establish dispute patterns first. |
| Email template editor (admin UI) | Templates are currently hardcoded in `email.mjs`. Sufficient until volume justifies self-service editing. |
| Subscription / recurring billing | No current use case. |
| Inventory counts | Explicitly out of scope per Drew — status flags only. |
| Social login (Google/Apple) | No customer accounts yet; prerequisite not met. |
| International shipping | Drew ships US only. |
| In-app SMS composer | Drew can reply to leads via email (reply-to is set to customer). SMS UI adds complexity with minimal gain at current volume. |

---

## 9. Content & Asset Blockers (Drew)

The following items are blocked on Drew providing content or making decisions. None block launch but several affect perceived quality at launch.

| Item | Required for | Status |
|---|---|---|
| Updated headshot photo | About page | Current photo is from 2021 |
| CNC/Laser photos (1–3) | Services page | Placeholder SVG shown |
| Sauna kit photos | /saunas page (hidden) | Placeholder SVG shown; not visible until sauna offer is un-hidden |
| Portfolio photos — slab flattening (2 more) | Portfolio page | slab_2.jpg, slab_3.jpg needed |
| Portfolio photos — cabinetry (3 more) | Portfolio page | Only barn_door_cabinet.jpg present |
| Portfolio photos — conference tables (3) | Portfolio page | Folder is empty |
| Pinterest username or removal decision | Footer social links | Link currently points to pinterest.com with no username |
| GC license expected date | Services page GC section | Section hidden until licensed |
| Pricing direction on services | Services page | Are existing "starting at" prices firm, or should ranges be shown? |

---

## 10. Third-Party Account Checklist

| Service | Purpose | Status |
|---|---|---|
| **Netlify** | Hosting + Functions + Blobs | ✅ Live (`studio37customdesign.netlify.app`) |
| **GitHub** (`brandtz/studio37`) | Source control | ✅ Active, `main` branch deploying |
| **Stripe** (Drew's connected account) | Payments | ✅ Connected; webhook endpoints needed (P0-4) |
| **Resend** | Transactional email | ✅ Account created, API key obtained; DNS verification needed (P0-1) |
| **Cloudflare R2** | Image storage | ⬜ Account + bucket not yet created (P0-3) |
| **Twilio** | SMS notifications | ⬜ Account not yet created (P1-1) |
| **Wix** (DNS only) | Domain registrar | ✅ Drew has access; DNS records will be modified for Resend (P0-1) then Netlify cutover (P0-5) |
| **Google Workspace** | Drew's email (`Drew@studio37customdesigns.com`) | ✅ Active — do not disturb MX records |

---

## 11. Environment Variables Reference

Full list of env vars expected by the Netlify Functions layer. All must be set in Netlify → Site configuration → Environment variables.

| Variable | Required | Source | Notes |
|---|---|---|---|
| `JWT_SECRET` | ✅ | Generate | Min 32 chars random string. Used to sign admin session JWTs. |
| `ADMIN_KEY` | ✅ | Generate | Legacy fallback for admin API key auth. Generate strong random string. |
| `STRIPE_SECRET_KEY` | ✅ | Stripe dashboard | Drew's live secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook config | Connected-accounts webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | ⬜ | Stripe webhook config | Platform-level webhook secret (if separate endpoint registered) |
| `STRIPE_PLATFORM_ACCOUNT_ID` | ✅ | Stripe dashboard | Platform Stripe account ID (`acct_...`) |
| `RESEND_API_KEY` | ✅ | Resend dashboard | Production API key — Drew has this; paste into Netlify |
| `RESEND_FROM` | ⬜ | Configure | Default: `Studio 37 Custom Designs <orders@studio37customdesigns.com>` |
| `RESEND_REPLY_TO` | ⬜ | Configure | Default: `Drew@studio37customdesigns.com` |
| `LEAD_NOTIFY_TO` | ⬜ | Configure | Default: `Drew@studio37customdesigns.com`. Override to CC others. |
| `TWILIO_SID` | ⬜ | Twilio console | Account SID (`AC...`) |
| `TWILIO_TOKEN` | ⬜ | Twilio console | Auth token |
| `TWILIO_FROM` | ⬜ | Twilio console | Studio 37 Twilio number in E.164 format (`+1...`) |
| `DREW_PHONE` | ⬜ | Drew | Drew's mobile in E.164 format (`+15415147720`) |
| `R2_ACCOUNT_ID` | ⬜ | Cloudflare dashboard | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | ⬜ | Cloudflare R2 token | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | ⬜ | Cloudflare R2 token | R2 API token secret |
| `R2_BUCKET` | ⬜ | Configure | Bucket name (e.g., `studio37-media`) |
| `R2_PUBLIC_URL` | ⬜ | Configure | Public base URL for serving images (e.g., `https://media.studio37customdesigns.com`) |
| `SITE_URL` | ⬜ | Configure | `https://studio37customdesigns.com` — used for Stripe redirect URLs |

**Legend:** ✅ = required at launch | ⬜ = required for that feature to work; site degrades gracefully without it

---

## 12. DNS Migration Plan

**Current state:** Domain managed at Wix. Site hosted at Wix (pointed at Wix servers). Drew's email on Google Workspace (MX records at Wix → Google).

**Target state:** Domain managed at Wix (or migrated to Netlify DNS / Cloudflare). Site hosted at Netlify. Email stays at Google Workspace. Resend authorized to send from the domain.

### Phase A — Pre-launch DNS additions (no site change)
Add Resend records to existing Wix DNS. Site continues serving from Wix during this phase. See P0-1 for steps.

### Phase B — Site cutover to Netlify
1. Confirm all P0 items tested on `studio37customdesign.netlify.app`
2. In Netlify: add `studio37customdesigns.com` as custom domain
3. In Wix DNS: change **only** the A record for `@` (root) and CNAME for `www` to Netlify values
4. **Leave untouched:** MX (Google mail), TXT records (SPF + DKIM for Google + Resend), DMARC
5. Netlify provisions SSL automatically within minutes
6. Test on real domain: site loads, checkout works, emails fire, admin accessible

### Records to change at cutover

| Record type | Name | Change from | Change to |
|---|---|---|---|
| A | `@` | Wix IP | Netlify load balancer IP (Netlify provides this) |
| CNAME | `www` | Wix CNAME | `[your-site].netlify.app` |

### Records to NEVER touch during migration

| Record type | Name | Purpose |
|---|---|---|
| MX | `@` | Drew's Google Workspace email routing |
| TXT | `@` | Google SPF + Resend SPF (merged) |
| TXT | `google._domainkey` | Google DKIM |
| TXT | `resend._domainkey` | Resend DKIM |
| TXT | `_dmarc` | DMARC policy |

---

## 13. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| May 2026 | Payment gateway: Stripe (not Square) | Drew confirmed Stripe preference after Square evaluation |
| May 2026 | Inventory: status flags only, no counts | Reduces admin overhead for small-batch custom shop |
| May 2026 | Customer accounts: deferred | Single-tenant, low-volume; Stripe receipt covers immediate need |
| May 2026 | Refund UI: deferred 60 days post-launch | Reduce operator-error risk on new system; Stripe dashboard access available |
| Jun 2026 | CNC & Laser Engraving: added as service | Replaced Sauna Kits slot in services strip; two-tier pricing (laser: $2/min run-time; CNC: per-job quote) |
| Jun 2026 | Sauna Kits: hidden from public navigation | Offer not ready; all content/pages preserved; nav/tiles/callouts commented out for easy re-enable |
| Jun 2026 | Slab Flattening: CNC removed from copy | Router gantry framing adopted; 50" wide × 18' long capacity called out; CNC reserved as a separate future service |
| Jun 2026 | Email provider: Resend | 3,000/mo free tier; simple API; good deliverability; native ESM SDK fits function architecture |
| Jun 2026 | SMS provider: Twilio | Already coded into functions from original design; account not yet created |
| Jun 2026 | Logo: switched to `logo.png` | `logo-mark.png` was rendering nearly invisible in nav; `logo.png` (267×217) has better contrast; size increased to 72px desktop |
