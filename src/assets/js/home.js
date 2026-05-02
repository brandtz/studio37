/* Studio 37 — Home page enhancements
 * Loads the first 3 available products into the home featured-shop strip. */

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
    <article class="card-product reveal" data-status="${p.status}">
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
