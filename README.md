# Studio 37 Custom Designs

Custom woodworking website for Drew Trano (Eastern Oregon). Static HTML/CSS/JS deployed to Netlify, with Netlify Functions for the product API, admin panel, lead capture, and SMS notifications. Snipcart handles cart + checkout, with **Square** as the payment gateway.

---

## Repository layout

```
/src                  Production site (deployed to Netlify)
  index.html, services.html, portfolio.html, shop.html, about.html, contact.html
  /admin              Password-gated product manager
  /assets             css/, js/, images/ (curated, web-optimized)
  /netlify/functions  products, admin-products, admin-upload, quote-request, order-notify
  netlify.toml, _redirects
/docs                 Specs, design context, commerce architecture, Claude Design handoff
/_archive             Original Wix scrape (gitignored — kept locally for reference)
TODO.md               Working build checklist
```

## Local development

This is a no-build static site. Any static file server works:

```powershell
# from repo root
npx serve src
# or
python -m http.server -d src 8080
```

For testing Netlify Functions locally:

```powershell
npm install
npx netlify dev
```

## Stack

- HTML5 + CSS3 (custom properties, no framework) + vanilla JS
- Google Fonts: Cormorant Garamond, DM Sans, IBM Plex Mono
- Netlify (hosting, Functions, Blobs, Forms)
- Snipcart (cart + checkout) + Square (payment gateway)
- Twilio (SMS to Drew)
- Cloudflare R2 (admin-uploaded product images)

## Environment variables

See `.env.example`. All secrets live in Netlify dashboard environment variables — never in the repo.

## Build status

See [`TODO.md`](TODO.md).

---

*Built by Brandtworks-Enterprises LLC.*
