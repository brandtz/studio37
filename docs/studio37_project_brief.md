# Studio 37 Custom Designs — Website Rebuild Project Brief
**Prepared by:** Brandtworks-Enterprises LLC  
**Client:** Drew Trano / Studio 37 Custom Designs  
**Date:** May 2026  
**Document Type:** Full Project Specification — Build-Ready

---

## 1. Project Overview

### Background
Studio 37 Custom Designs is Drew Trano's custom woodworking and design business based in Eastern Oregon. The current site is a 2021 Wix build that is outdated, incomplete, and unmaintained. It does not reflect Drew's full service offering, positions him as a hobbyist rather than a professional craftsman, and lacks the infrastructure to support sales or lead generation.

Drew is in the process of obtaining his General Contractor (GC) license, which will significantly expand his service offering and professional positioning. The new site must accommodate that evolution.

Drew is not technical. He will not maintain the site himself. All updates will be handled by Brandtworks-Enterprises LLC on his behalf.

### Goals
1. Accurately represent Drew's full service offering (custom cabinetry, slab flattening, specialty woodworking, small goods)
2. Position him as a professional craftsman and emerging licensed GC — not a hobbyist
3. Enable inbound lead generation with a structured quote request form
4. Enable product sales for small goods (cutting boards, charcuterie boards, custom gifts)
5. Notify Drew via SMS when a lead or quote request is submitted — he is in the field, not at a desk
6. Establish a clean, low-maintenance foundation that BWE can update as Drew's business evolves (GC license, future service additions)

### What This Site Is NOT
- Not a Wix site. Moving off Wix permanently.
- Not a site Drew will self-manage. Zero expectation of technical ability.
- Not a corporate or enterprise site. It should feel personal, skilled, and craftsman-quality.

---

## 2. Platform & Hosting Decision

### Recommendation: Static HTML/CSS/JS + Netlify

| Factor | Decision |
|---|---|
| Platform | Static HTML/CSS/JS (no framework dependency) |
| Hosting | Netlify |
| Domain | Retain `studio37customdesigns.com` — transfer DNS to Netlify |
| Form handling | Netlify Forms (built-in, no backend needed) |
| SMS notifications | Netlify Function → Twilio |
| Product sales | See Section 6 — E-Commerce Decision |
| Updates | BWE pushes updates; Drew never touches code |

**Why Netlify:**
- Free tier covers everything except SMS function (minimal Twilio cost ~$0.01/text)
- Built-in form handling with spam filtering
- Zero server management
- Instant deploys from Git
- Custom domain + free SSL

**Ongoing cost estimate for Drew:**
- Domain renewal: ~$15/yr (he may already own this)
- Netlify: Free tier sufficient
- Twilio SMS: ~$1–3/mo at typical lead volume
- E-commerce fees: See Section 6
- **BWE service retainer: TBD — recommend monthly or per-update billing**

---

## 3. Design System

### Preserve: Color Palette
The existing site uses a dark, craftsman aesthetic consistent with premium woodworking. Exact hex values must be confirmed by inspecting the live Wix site or requesting from Drew, but the palette direction is:

| Role | Description | Action |
|---|---|---|
| Primary dark | Near-black or deep charcoal (logo background) | **Confirm hex from Drew or logo file** |
| Warm accent | Wood-tone amber/brown | **Confirm hex from Drew or logo file** |
| Light surface | Off-white or warm light gray | Derive from palette |
| Text | Near-black on light, near-white on dark | Derive |

> **Required before build starts:** Drew should supply the original logo file (SVG or high-res PNG). If unavailable, extract colors from the existing logo at wixstatic.com.

### Elevate: Typography
Replace the generic Wix font stack. Keep the craftsman/refined feel, not rustic/country. Target: artisanal premium, like a quality furniture maker's catalog.

**Recommended pairing:**
- **Display / Headers:** `Playfair Display` or `Cormorant Garamond` — elegant serif, strong craftsmanship character
- **Body:** `DM Sans` or `Lato` — clean, neutral, readable
- Load via Google Fonts (free, no license issue)

> This pairing elevates Drew from "hobbyist with a website" to "skilled craftsman with a brand." It should feel like it could exist in a high-end furniture showroom, not a craft fair.

### Aesthetic Direction
- **Tone:** Refined craftsman. Not rustic. Not corporate. Think: custom furniture atelier meets Pacific Northwest natural materials.
- **Texture:** Subtle wood grain or linen texture as background element on select sections
- **Photography:** His portfolio imagery should be the hero. The design frames the work, not the other way around.
- **Whitespace:** Generous. Let the work breathe.
- **Animations:** Subtle. Fade-in on scroll for portfolio items. No flashy effects that distract from the craftsmanship.

---

## 4. Sitemap

```
/ (Home)
/services
  └── /services#cabinetry
  └── /services#slab-flattening
  └── /services#custom-furniture
  └── /services#small-goods
  └── /services#general-contracting  ← "Coming Soon" badge
/portfolio
/shop
/about
/contact  (also: Get a Quote)
```

**Navigation bar:**
`HOME | SERVICES | PORTFOLIO | SHOP | ABOUT | GET A QUOTE`

"GET A QUOTE" should be styled as a distinct CTA button in the nav — not just a text link.

---

## 5. Page-by-Page Content Specification

---

### 5.1 HOME

**Purpose:** First impression. Communicate craft quality, establish credibility, drive to services or quote.

**Sections:**
1. **Hero**
   - Full-width background: his best portfolio photo (large slab or cabinet piece)
   - Headline: `Custom Woodworking & Design` or similar — confirm with Drew
   - Sub-headline: `Handcrafted in the Pacific Northwest by Drew Trano`
   - Two CTAs: `View My Work` (→ Portfolio) + `Get a Quote` (→ Contact)

2. **Services Overview Strip**
   - 4–5 icon cards, one per major service category
   - Brief 1-line description each
   - Each links to the full services page anchor
   - Services: Cabinetry | Slab Flattening | Custom Furniture | Small Goods | GC *(coming soon)*

3. **Featured Work / Portfolio Teaser**
   - 3–4 best photos, grid or masonry layout
   - `See Full Portfolio →` link

4. **About Snippet**
   - 2–3 sentences from the origin story
   - Headshot photo
   - `About Drew →` link

5. **Quote CTA Banner**
   - Dark/contrasting section
   - Headline: `Ready to Start Your Project?`
   - Sub: `Tell me about your vision — I'll get back to you the same day.`
   - CTA: `Request a Quote`

6. **Footer**
   - Logo, nav links, social icons (Instagram, Pinterest), copyright year (auto-update via JS), email link
   - Add: `© 2026 Studio 37 Custom Designs | Built by Brandtworks-Enterprises LLC` *(optional — discuss with Drew)*

---

### 5.2 SERVICES

**Purpose:** Convert visitors who want to hire Drew. This is the most important new page. Make every service scannable and clear.

> **CONTENT REQUIRED FROM DREW** for each service:
> - 2–3 sentence description
> - 1–2 representative photos
> - General price range or "Starting at $X" (if he's comfortable — even ballpark builds trust)
> - Typical project timeline

**Services to include:**

#### Custom Cabinetry
- Kitchen cabinets, bathroom vanities, built-ins, entertainment centers
- Emphasize: locally sourced and exotic timbers, handcrafted, not off-the-shelf
- Photo: his best cabinet project

#### Slab Flattening
- This is a specialty service many woodworkers can't offer
- Explain what it is briefly (live edge slabs, CNC router sled or hand methods)
- Market to: other woodworkers, homeowners with slabs, furniture makers
- Note: this could be B2B as well as B2C

#### Custom Furniture
- Tables, shelving, beds, media consoles, office furniture
- Emphasis on heirloom quality, made to last generations
- Photo: best furniture piece

#### Small Goods & Custom Gifts
- Cutting boards, charcuterie boards, serving pieces, wood gifts
- Note that these are also available in the Shop
- Good for: wedding gifts, corporate gifts, holiday items

#### General Contracting *(Coming Soon)*
- **Display with a "Coming Soon" or "Now Available" badge** — update when license lands
- Copy: `Drew is obtaining his Oregon General Contractor license, expanding Studio 37's capabilities to full home remodel, renovation, and specialty construction projects — including wildfire hardening and retrofit work.`
- CTA: `Get on the waitlist` → captures email/phone with simple form

> **Strategic note for Matthew:** The GC section sets the stage for Bulwark without naming it. When the license lands and Bulwark launches, this page can evolve to explicitly reference wildfire retrofit compliance work. Plant the seed now.

---

### 5.3 PORTFOLIO

**Purpose:** Prove the quality of work. Let the photos do the selling.

**Design:** Masonry or clean grid gallery. Category filter tabs at top:
`All | Cabinetry | Furniture | Slab Work | Small Goods`

**Requirements:**
- Drew must supply organized photos by category
- Each photo should have a brief caption: `[Project type] — [material/wood species if notable]`
- Optional: "Inquire about a similar project" CTA on hover

**Current state:** The Wix homepage has 3 portfolio images visible. Drew needs to supply his full library — Instagram (`@studio37_customwoodworking`) is likely the best source of existing content. Plan to pull from that.

---

### 5.4 SHOP

**Purpose:** Sell small goods (cutting boards, charcuterie boards, custom gifts). Drew already has a Wix Shop — this needs to migrate or be replaced.

**Decision required — See Section 6 (E-Commerce).**

---

### 5.5 ABOUT

**Purpose:** Build trust and personal connection. Drew's current About page is actually well-written — it should be preserved and expanded.

**Keep:** The origin story about his dad's workshop, learning as a kid, family inspiration.

**Add:**
- Current business context: based in Eastern Oregon, serving the Pacific Northwest
- General Contractor license status and what that means for clients
- A note about working with natural, local, and exotic timbers
- Updated/current photo of Drew (the headshot on the current site is from 2021)
- List of service areas / geography (Eastern Oregon, Pacific Northwest)

---

### 5.6 CONTACT / GET A QUOTE

**Purpose:** Capture structured lead information and notify Drew immediately via SMS.

**This page is a sales page, not a help desk.** Design and copy should reflect that.

#### Quote Request Form Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| First Name | Text | Yes | |
| Last Name | Text | Yes | |
| Phone | Tel | Yes | Used for Drew's SMS follow-up |
| Email | Email | Yes | For confirmation email |
| Service Type | Dropdown | Yes | Cabinetry, Slab Flattening, Furniture, Small Goods, GC Work, Other |
| Project Description | Textarea | Yes | Placeholder: "Describe your project — dimensions, materials, timeline, anything helpful." |
| Project Location | Text | No | City/region — especially relevant for GC/installation work |
| Estimated Budget | Dropdown | No | Under $500 / $500–$2K / $2K–$5K / $5K+ / Not sure |
| Preferred Contact Method | Radio | Yes | Phone Call / Text / Email |
| How did you find us? | Dropdown | No | Google / Instagram / Pinterest / Referral / Other |
| Photo Upload | File | No | Up to 3 photos, JPG/PNG, 10MB max — for reference images |

> **Note on photo upload:** Netlify Forms supports file uploads natively. This is high-value for custom woodworking — clients can share reference images, existing space photos, slab photos they own, etc.

#### Confirmation behavior
- On submit: display a success message: *"Thanks [Name]! Drew will reach out to you within 24 hours."*
- Auto-reply email to customer (via Netlify + a simple email template or a forwarding service like Formspree for email — or just the built-in Netlify notification)
- SMS to Drew's phone — see Section 7

#### Also on this page
- Drew's email (`Drew@studio37customdesigns.com`)
- Instagram link
- Short note: `Drew typically responds within 24 hours. For urgent inquiries, mention it in your message.`

---

## 6. E-Commerce Decision (Shop)

The current Wix shop sells small goods. Moving off Wix means choosing a new commerce solution. Three options:

### Option A: Snipcart (Recommended for this use case)
- Lightweight JavaScript cart that layers on top of any static HTML site
- Products defined in HTML attributes — no separate admin panel to learn
- Stripe or PayPal for payments
- **Cost:** Free up to $500/mo in sales; 2% transaction fee above that (+ Stripe's 2.9% + $0.30)
- **Pros:** Stays in the static site, no platform lock-in, BWE manages it
- **Cons:** Drew sees orders in Snipcart dashboard (simple) — BWE may need to handle order notifications

### Option B: Shopify Buy Button
- Embed Shopify's buy button into the static site pages
- **Cost:** $9/mo (Shopify Starter plan)
- **Pros:** Shopify handles inventory, orders, fulfillment tracking; Drew can eventually use the Shopify mobile app
- **Cons:** Monthly fee, separate admin, slight visual discontinuity

### Option C: "Request a Custom Order" Only (No Direct Checkout)
- Remove direct e-commerce
- Replace shop with a "browse and request" model: show the products, price them, but send the buyer through the Quote Request form
- **Cost:** $0
- **Pros:** No payment infrastructure, no inventory management, perfectly valid for high-ticket custom goods
- **Cons:** Adds friction for small purchases like cutting boards

### Recommendation
**Start with Option C, migrate to Snipcart in Phase 2.** For a rebuild launch, removing e-commerce complexity reduces scope and risk. Small goods under $100 (cutting boards, boards) can be sold via the quote form initially. Once the site is live and Drew is comfortable with the volume, add Snipcart. This also gives time to confirm what inventory Drew actually wants to sell online vs. by inquiry only.

> **Ask Drew:** Does he currently process online payments, and if so, what processor? (Square, PayPal, Stripe?) This determines the path of least resistance for Phase 2 commerce.

---

## 7. SMS Notification — Technical Specification

**How it works:**
1. Visitor submits the quote request form
2. Netlify Forms captures the submission and triggers a **Netlify Function** (serverless, runs on Netlify's edge)
3. The function formats a brief SMS message and sends it via **Twilio**
4. Drew receives a text on his phone with the key details

**SMS message format (example):**
```
📋 New Studio 37 Quote Request
From: Sarah M. (541-555-0123)
Service: Cabinetry
Budget: $2K–$5K
Message: "Looking for a kitchen island with butcher block top..."
Reply to: sarah@email.com
```

**Setup requirements:**
- Twilio account (free trial works to start; ~$15 to load a balance)
- Twilio phone number (~$1.15/mo)
- Netlify environment variable: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `DREW_PHONE_NUMBER`
- A single `netlify/functions/notify-sms.js` file in the repo

**Cost:** Approximately $1–2/month at typical lead volume (10–20 inquiries/month).

---

## 8. Technical Stack Summary

| Layer | Choice | Notes |
|---|---|---|
| Markup | HTML5 | Semantic, accessible |
| Styling | CSS3 + CSS variables | No framework needed; mobile-first |
| JavaScript | Vanilla JS | Scroll animations, form validation, gallery filter |
| Hosting | Netlify | Free tier |
| Forms | Netlify Forms | Built-in, spam filtered |
| SMS | Netlify Functions + Twilio | Serverless, no backend |
| E-Commerce (Phase 2) | Snipcart | After launch |
| DNS | Transfer to Netlify | From current registrar |
| Analytics | Netlify Analytics or Google Analytics 4 | Drew doesn't need to manage this |
| Version control | GitHub (BWE org) | Matthew manages |

---

## 9. File & Asset Checklist (Required from Drew)

Before build can begin, the following must be collected from Drew:

| Asset | Format | Notes |
|---|---|---|
| Logo file | SVG or PNG (high-res) | Original source file if available |
| Color hex values | — | Or confirm from logo extraction |
| Headshot photo (current) | JPG, high-res | Updated from 2021 version |
| Portfolio photos — organized by category | JPG/PNG | Pull from Instagram, phone, etc. |
| Service descriptions | Written or voice note | BWE can write from notes |
| Price ranges per service | Notes | Even "Starting at $X" is fine |
| Drew's cell phone number | — | For Twilio SMS delivery |
| Current domain registrar login | — | To transfer DNS |
| Wix login | — | To export any shop inventory |

---

## 10. Build Phases

### Phase 1 — Core Site (Launch)
- Home, Services, Portfolio, About, Contact/Quote
- SMS notification on form submit
- Portfolio gallery with category filter
- GC section as "Coming Soon"
- Mobile-first, fully responsive
- Google Fonts, no external dependencies
- SEO basics: meta titles, descriptions, OG tags, sitemap.xml

**Estimated scope:** 20–30 hours (BWE web services rate)

### Phase 2 — Commerce
- Add Snipcart to Shop page
- Product listings for small goods (cutting boards, boards, gifts)
- Order notification to Drew via email/SMS

**Estimated scope:** 8–12 hours

### Phase 3 — GC Launch Update
- Activate GC section (remove Coming Soon badge)
- Add GC-specific services content
- Add wildfire retrofit/hardening service callout *(aligns with Bulwark)*
- Update About page with license credential

**Estimated scope:** 4–6 hours

---

## 11. Open Questions for Drew

1. **Logo:** Do you have the original logo file, or should we recreate it?
2. **Colors:** Can you confirm the primary dark color and accent color? (Or share the logo file and we'll extract)
3. **Phone number:** What cell number should receive the quote request SMS texts?
4. **Domain registrar:** Who is your domain registered with and do you have login access?
5. **Pricing comfort:** Are you comfortable showing starting prices on the services page? (Even ranges help convert visitors)
6. **Shop inventory:** What items do you want available for direct purchase? (cutting boards, etc.) Do you have current photos and prices?
7. **GC license timeline:** Expected date so we can plan the Phase 3 update
8. **Business name:** Does the new site use "Studio 37 Custom Designs" or "Studio 37 Custom Designs by Drew Trano" — or something else now?

---

## 12. Strategic Notes for Matthew

- **Bulwark alignment:** The GC services section is a natural future connection point. When Drew's license is active and Bulwark is market-ready, the Studio 37 site can reference wildfire retrofit/hardening work, linking to Bulwark's customer intake or simply positioning Drew as a qualified retrofit contractor. Don't over-build this now — just leave the door open architecturally.
- **BWE portfolio:** This site, like Superior Exteriors, is a live portfolio piece for BWE web services. Treat it accordingly.
- **Ongoing relationship:** Drew can't manage his own site. This is an implicit recurring service relationship. Consider a simple BWE web services retainer (monthly or annual) that covers: content updates, performance monitoring, domain renewal management, and emergency fixes.
- **Photo quality:** The success of this site is almost entirely dependent on the photography. Drew's Instagram suggests he has great work — the content is there. Getting organized, high-res versions of the best portfolio images is the single highest-leverage pre-build task.

---

*Document prepared by Brandtworks-Enterprises LLC. All decisions subject to client review.*
