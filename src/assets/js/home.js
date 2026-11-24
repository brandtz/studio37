/* Studio 37 — Home page enhancements
 * Loads the first 3 available products into the home featured-shop strip
 * and drives the customer reviews carousel. */

// ── REVIEWS CAROUSEL ──────────────────────────────────────────────────────────
(function mountReviews() {
  const carousel = document.getElementById('reviews-carousel');
  const dotsEl   = document.getElementById('reviews-dots');
  const section  = document.getElementById('reviews-section');
  if (!carousel) return;
  const copy = Object.fromEntries(Studio37ContentSchema['dynamic-copy'].fields.map((field) => [field.id, field.default]));
  Studio37Content.loadScope('dynamic-copy').then((values) => {
    Object.assign(copy, values);
    carousel.querySelectorAll('.review-stars').forEach((el) => {
      el.setAttribute('aria-label', el.dataset.rating + ' ' + copy['reviews-star-label']);
    });
    dotsEl.querySelectorAll('.reviews-dot').forEach((el, index) => {
      el.setAttribute('aria-label', copy['reviews-dot-label'] + ' ' + (index + 1));
    });
  });

  let current = 0;
  let timer;

  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mount(items) {
    if (!items.length) return;

    const track = document.createElement('div');
    track.className = 'reviews-track';
    items.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML = `
        <div class="review-stars" data-rating="${escape(r.stars)}" aria-label="${escape(r.stars)} ${escape(copy['reviews-star-label'])}">${stars(r.stars)}</div>
        <p class="review-text">${escape(r.text)}</p>
        <p class="review-byline"><strong>${escape(r.name)}</strong> &mdash; ${escape(r.location || '')}</p>
      `;
      track.appendChild(card);
    });
    carousel.innerHTML = '';
    dotsEl.innerHTML = '';
    carousel.appendChild(track);

    const dots = items.map((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'reviews-dot' + (i === 0 ? ' active' : '');
      btn.setAttribute('aria-label', `${copy['reviews-dot-label']} ${i + 1}`);
      btn.addEventListener('click', () => goTo(i));
      dotsEl.appendChild(btn);
      return btn;
    });

    function goTo(idx) {
      current = (idx + items.length) % items.length;
      track.style.transform = `translateX(-${current * 100}%)`;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
      clearInterval(timer);
      timer = setInterval(() => goTo(current + 1), 5000);
    }

    carousel.addEventListener('mouseenter', () => clearInterval(timer));
    carousel.addEventListener('mouseleave', () => {
      timer = setInterval(() => goTo(current + 1), 5000);
    });

    goTo(0);
  }

  fetch('/api/reviews')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((items) => {
      if (Array.isArray(items) && items.length) { mount(items); return; }
      // No published reviews yet — hide the whole section rather than show
      // placeholder/fake testimonials.
      if (section) section.hidden = true;
    })
    .catch(() => { if (section) section.hidden = true; });
}());

// ── FEATURED SHOP STRIP ───────────────────────────────────────────────────────
(() => {
  const target = document.getElementById('home-featured-shop');
  if (!target) return;
  const copy = Object.fromEntries(Studio37ContentSchema['dynamic-copy'].fields.map((field) => [field.id, field.default]));
  let visibleProducts = null;
  Studio37Content.loadScope('dynamic-copy').then((values) => {
    Object.assign(copy, values);
    if (visibleProducts) render(visibleProducts);
  });
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const limit = parseInt(target.dataset.limit, 10) || 3;
  const FALLBACK = [
    {
      id: 'chopping-block',
      name: 'Timber Hollow Chopping Block',
      subtitle: 'Eastern Black Walnut',
      price: 13500,
      category: 'small-goods',
      images: ['/assets/images/shop/chopping_block_1.jpg'],
      status: 'available',
    },
    {
      id: 'charcuterie-walnut',
      name: 'Black Walnut Charcuterie Board',
      subtitle: 'Black Walnut',
      price: 5500,
      category: 'small-goods',
      images: ['/assets/images/shop/charcuterie_walnut_1.jpg'],
      status: 'available',
    },
    {
      id: 'swing-seat',
      name: 'English Walnut Swing Seat',
      subtitle: 'English Walnut',
      price: 29500,
      category: 'furniture',
      images: ['/assets/images/shop/swing_seat_1.webp'],
      status: 'available',
    },
  ];

  const fmtPrice = (cents) =>
    typeof cents === 'number'
      ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : '—';

  const cardHTML = (p) => `
    <article class="card-product" data-status="${escape(p.status)}">
      <div class="card-product-img">
        <img src="${escape((p.images && p.images[0]) || '')}" alt="${escape(p.name)}" loading="lazy" />
      </div>
      <div class="card-product-body">
        <span class="card-product-category">${escape(({ 'small-goods': copy['shop-small-goods'], furniture: copy['shop-furniture'], cabinetry: copy['shop-cabinetry'], 'slab-work': copy['home-slab'] })[p.category] || p.category)}</span>
        <h3 class="card-product-name">${escape(p.name)}</h3>
        <p class="card-product-sub">${escape(p.subtitle || '')}</p>
        <div class="card-product-footer">
          <span class="card-product-price">${fmtPrice(p.price)}</span>
          <a class="btn-primary card-product-cta" href="/shop">${escape(copy['home-shop'])}</a>
        </div>
      </div>
    </article>
  `;

  function render(items) {
    visibleProducts = items;
    target.innerHTML = items.slice(0, limit).map(cardHTML).join('');
  }

  // Try the live API; fall back to static if it fails (e.g., on local file://).
  fetch('/api/products')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((all) => {
      const available = all.filter((p) => p.status === 'available');
      render(available.length ? available : FALLBACK);
    })
    .catch(() => render(FALLBACK));
})();
