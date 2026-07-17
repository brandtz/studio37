/* Studio 37 — Home page enhancements
 * Loads the first 3 available products into the home featured-shop strip
 * and drives the customer reviews carousel. */

// ── REVIEWS CAROUSEL ──────────────────────────────────────────────────────────
(function mountReviews() {
  const carousel = document.getElementById('reviews-carousel');
  const dotsEl   = document.getElementById('reviews-dots');
  const section  = document.getElementById('reviews-section');
  if (!carousel) return;

  let current = 0;
  let timer;

  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function mount(items) {
    if (!items.length) return;

    const track = document.createElement('div');
    track.className = 'reviews-track';
    items.forEach((r) => {
      const card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML = `
        <div class="review-stars" aria-label="${r.stars} out of 5 stars">${stars(r.stars)}</div>
        <p class="review-text">${r.text}</p>
        <p class="review-byline"><strong>${r.name}</strong> &mdash; ${r.location || ''}</p>
      `;
      track.appendChild(card);
    });
    carousel.innerHTML = '';
    dotsEl.innerHTML = '';
    carousel.appendChild(track);

    const dots = items.map((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'reviews-dot' + (i === 0 ? ' active' : '');
      btn.setAttribute('aria-label', `Review ${i + 1}`);
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

  const CATEGORY_LABEL = {
    'small-goods': 'Small Goods',
    'furniture': 'Furniture',
    'cabinetry': 'Cabinetry',
    'slab-work': 'Slab Work',
  };

  const fmtPrice = (cents) =>
    typeof cents === 'number'
      ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : '—';

  const cardHTML = (p) => `
    <article class="card-product" data-status="${p.status}">
      <div class="card-product-img">
        <img src="${(p.images && p.images[0]) || ''}" alt="${p.name}" loading="lazy" />
      </div>
      <div class="card-product-body">
        <span class="card-product-category">${CATEGORY_LABEL[p.category] || p.category}</span>
        <h3 class="card-product-name">${p.name}</h3>
        <p class="card-product-sub">${p.subtitle || ''}</p>
        <div class="card-product-footer">
          <span class="card-product-price">${fmtPrice(p.price)}</span>
          <a class="btn-primary card-product-cta" href="/shop">Shop &rarr;</a>
        </div>
      </div>
    </article>
  `;

  function render(items) {
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
