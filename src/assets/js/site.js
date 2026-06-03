/* Studio 37 — Shared site JS
 * Loads partials, wires nav scroll/mobile toggle, scroll reveal, footer year. */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ── Inject shared nav + footer via fetch (no build step). ──
  // Markup is inlined to keep things working when opened from disk via local server.
  // Page-level <head> sets <html data-page="home"> etc. so we can highlight the nav link.
  const NAV_HTML = `
    <a href="/" class="nav-logo" aria-label="Studio 37 home">
      <img src="/assets/images/logo.png" alt="Studio 37 Custom Designs" />
    </a>
    <ul class="nav-links">
      <li><a href="/" data-page="home">Home</a></li>
      <li><a href="/services" data-page="services">Services</a></li>
      <li><a href="/saunas" data-page="saunas">Saunas</a></li>
      <li><a href="/portfolio" data-page="portfolio">Portfolio</a></li>
      <li><a href="/shop" data-page="shop">Shop</a></li>
      <li><a href="/about" data-page="about">About</a></li>
    </ul>
    <div class="nav-actions">
      <button class="nav-cart" data-cart-toggle aria-label="Open cart" type="button">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <span class="nav-cart-count" data-cart-count aria-hidden="true"></span>
      </button>
      <a href="/contact" class="nav-cta">Get a Quote</a>
      <button class="nav-mobile-toggle" aria-label="Open menu" aria-expanded="false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </div>
  `;

  const MOBILE_NAV_HTML = `
    <a href="/">Home</a>
    <a href="/services">Services</a>
    <a href="/saunas">Saunas</a>
    <a href="/portfolio">Portfolio</a>
    <a href="/shop">Shop</a>
    <a href="/about">About</a>
    <a href="/contact" class="accent">Get a Quote</a>
  `;

  const FOOTER_HTML = `
    <div class="footer-inner">
      <div class="footer-brand">
        <img src="/assets/images/logo.png" alt="Studio 37 Custom Designs" />
        <p>Custom woodworking, cabinetry, and design — handcrafted in Springfield, Oregon.</p>
        <div class="footer-social">
          <a href="https://www.instagram.com/studio37_customwoodworking" target="_blank" rel="noopener" aria-label="Instagram">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="5"/>
              <circle cx="12" cy="12" r="4"/>
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>
            </svg>
          </a>
          <a href="https://www.pinterest.com/" target="_blank" rel="noopener" aria-label="Pinterest">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="9"/>
              <path d="M11 7c2.5 0 4 1.6 4 3.6 0 2.4-1.5 4.2-3.6 4.2-1 0-1.7-.5-1.5-1.2.3-1 .8-2 .8-2.7 0-.7-.4-1.2-1-1.2-1 0-1.7 1-1.7 2.4 0 .8.3 1.4.3 1.4l-1.4 5.7"/>
            </svg>
          </a>
        </div>
      </div>
      <div>
        <h4>Explore</h4>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/services">Services</a></li>
          <li><a href="/saunas">Saunas</a></li>
          <li><a href="/portfolio">Portfolio</a></li>
          <li><a href="/shop">Shop</a></li>
          <li><a href="/about">About</a></li>
        </ul>
      </div>
      <div>
        <h4>Connect</h4>
        <ul>
          <li><a href="mailto:Drew@studio37customdesigns.com">Drew@studio37customdesigns.com</a></li>
          <li>Springfield, Oregon</li>
          <li><a href="tel:+15415147720">(541) 514-7720</a></li>
          <li><a href="/contact" class="footer-cta">Request a Quote &rarr;</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; <span id="footer-year"></span> Studio 37 Custom Designs</span>
      <span>Site by Brandtworks-Enterprises LLC</span>
    </div>
  `;

  function mountChrome() {
    const nav = $('header.nav');
    if (nav && !nav.hasChildNodes()) nav.innerHTML = NAV_HTML;

    const mobile = $('.nav-mobile-overlay');
    if (mobile && !mobile.hasChildNodes()) mobile.innerHTML = MOBILE_NAV_HTML;

    const footer = $('footer.footer');
    if (footer && !footer.hasChildNodes()) footer.innerHTML = FOOTER_HTML;

    // Highlight active page
    const page = document.documentElement.dataset.page;
    if (page) {
      const link = $(`.nav-links a[data-page="${page}"]`);
      if (link) link.classList.add('active');
    }

    // Year
    const yearEl = $('#footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Epic 6: Hydrate footer with site settings from /api/public-config.
    hydrateFooterFromConfig();
  }

  async function hydrateFooterFromConfig() {
    try {
      const r = await fetch('/api/public-config');
      if (!r.ok) return;
      const cfg = await r.json();
      const s = cfg && cfg.site;
      if (!s) return;

      const footer = $('footer.footer');
      if (!footer) return;

      // Tagline
      const taglineEl = footer.querySelector('.footer-brand p');
      if (taglineEl && s.business_tagline) taglineEl.textContent = s.business_tagline;

      // Social icons
      const social = footer.querySelector('.footer-social');
      if (social) {
        const links = social.querySelectorAll('a');
        // Instagram = first link
        if (links[0]) {
          if (s.social_instagram_url) {
            links[0].href = s.social_instagram_url;
            links[0].style.display = '';
          } else {
            links[0].style.display = 'none';
          }
        }
        // Pinterest = second link
        if (links[1]) {
          if (s.social_pinterest_url) {
            links[1].href = s.social_pinterest_url;
            links[1].style.display = '';
          } else {
            links[1].style.display = 'none';
          }
        }
      }

      // Connect column
      const connectList = footer.querySelectorAll('.footer-inner > div')[2]?.querySelector('ul');
      if (connectList) {
        const items = connectList.querySelectorAll('li');
        // email
        if (items[0] && s.business_email) {
          items[0].innerHTML = `<a href="mailto:${s.business_email}">${s.business_email}</a>`;
        }
        if (items[1] && s.business_city) items[1].textContent = s.business_city;
        if (items[2] && s.business_phone) {
          const tel = s.business_phone_e164 || s.business_phone.replace(/[^\d+]/g, '');
          items[2].innerHTML = `<a href="tel:${tel}">${s.business_phone}</a>`;
        }
      }

      // Copyright business name
      const bottom = footer.querySelector('.footer-bottom span');
      if (bottom && s.business_name) {
        bottom.innerHTML = `&copy; <span id="footer-year">${new Date().getFullYear()}</span> ${s.business_name}`;
      }
    } catch { /* fail silent — keep defaults */ }
  }

  function wireNav() {
    const nav = $('header.nav');
    if (!nav) return;
    const onScroll = () => {
      if (window.scrollY > 40) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const toggle = $('.nav-mobile-toggle');
    const overlay = $('.nav-mobile-overlay');
    if (toggle && overlay) {
      toggle.addEventListener('click', () => {
        const open = overlay.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
        document.body.style.overflow = open ? 'hidden' : '';
      });
      overlay.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') {
          overlay.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          document.body.style.overflow = '';
        }
      });
    }
  }

  function wireReveal() {
    const items = $$('.reveal');
    if (!items.length || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    items.forEach((el) => io.observe(el));
  }

  document.addEventListener('DOMContentLoaded', () => {
    mountChrome();
    wireNav();
    wireReveal();

    // Pre-fill service dropdown from query param
    (function () {
      const params = new URLSearchParams(window.location.search);
      const service = params.get('service');
      if (!service) return;
      const select = document.querySelector('select[name="service"], #service-type');
      if (!select) return;
      // Try exact match first, then partial
      const options = Array.from(select.options);
      const match =
        options.find(o => o.value === service) ||
        options.find(o => o.value.includes(service) || service.includes(o.value));
      if (match) match.selected = true;
    })();
  });
})();
