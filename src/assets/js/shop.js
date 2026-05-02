/* Studio 37 — Shop page: fetch products, render cards, filter, Snipcart wiring */
(() => {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const SHOP_FILTER_MAP = {
    'all':             () => true,
    'cutting-boards':  (p) => /cutting/i.test(p.name) || /chopping|butcher/i.test(p.name),
    'charcuterie':     (p) => /charcuterie/i.test(p.name),
    'furniture':       (p) => p.category === 'furniture',
    'custom':          (p) => p.status === 'by_request',
  };

  let products = [];
  let activeFilter = 'all';

  function skeletonCard() {
    return `
      <article class="card-product">
        <div class="card-product-img skeleton" style="aspect-ratio:4/3;"></div>
        <div class="card-product-body">
          <div class="skeleton" style="height:12px;width:40%;margin-bottom:10px;"></div>
          <div class="skeleton" style="height:20px;width:80%;margin-bottom:8px;"></div>
          <div class="skeleton" style="height:14px;width:50%;"></div>
          <div class="card-product-footer">
            <div class="skeleton" style="height:18px;width:60px;"></div>
            <div class="skeleton" style="height:36px;width:120px;"></div>
          </div>
        </div>
      </article>`;
  }

  function renderSkeletons() {
    grid.innerHTML = Array(6).fill(skeletonCard()).join('');
  }

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  function categoryLabel(p) {
    if (p.status === 'by_request') return 'Made to Order';
    return ({
      'small-goods': 'Small Goods',
      'furniture': 'Furniture',
      'cabinetry': 'Cabinetry',
      'slab-work': 'Slab',
      'custom': 'Custom',
    })[p.category] || 'Studio 37';
  }

  function ctaFor(p) {
    if (p.status === 'available') {
      const priceDollars = (p.price / 100).toFixed(2);
      return `
        <button class="btn-primary snipcart-add-item"
          data-item-id="${p.id}"
          data-item-name="${p.name.replace(/"/g, '&quot;')}"
          data-item-price="${priceDollars}"
          data-item-url="/api/products/${p.id}"
          data-item-description="${(p.description || '').replace(/"/g, '&quot;').slice(0, 200)}"
          data-item-image="${p.images?.[0] || ''}"
          ${p.weight_oz ? `data-item-weight="${p.weight_oz}"` : ''}>
          Add to Cart
        </button>`;
    }
    if (p.status === 'by_request') {
      return `<a class="btn-ghost" href="/contact?service=${encodeURIComponent(p.category || 'custom')}&product=${encodeURIComponent(p.id)}">Request This Item</a>`;
    }
    return `<span class="badge badge-neutral">Out of Stock</span>`;
  }

  function renderCard(p) {
    return `
      <article class="card-product" data-status="${p.status}">
        <div class="card-product-img">
          <img src="${p.images?.[0] || '/assets/images/logo.png'}" alt="${p.name}" loading="lazy" />
        </div>
        <div class="card-product-body">
          <div class="card-product-category">${categoryLabel(p)}</div>
          <div class="card-product-name">${p.name}</div>
          ${p.subtitle ? `<div class="card-product-sub">${p.subtitle}</div>` : ''}
          <div class="card-product-footer">
            <span class="card-product-price">${p.status === 'by_request' && p.price ? `From ${fmtMoney(p.price)}` : fmtMoney(p.price)}</span>
            <span class="card-product-cta">${ctaFor(p)}</span>
          </div>
        </div>
      </article>`;
  }

  function render() {
    const filter = SHOP_FILTER_MAP[activeFilter] || (() => true);
    const list = products.filter(filter);
    if (!list.length) {
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">No items in this category yet.</p>`;
      return;
    }
    grid.innerHTML = list.map(renderCard).join('');
  }

  document.querySelectorAll('.shop-filters .filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.shop-filters .filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      render();
    });
  });

  async function load() {
    renderSkeletons();
    try {
      const r = await fetch('/api/products');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      products = await r.json();
      // Hide archived from public shop
      products = products.filter((p) => p.status !== 'archived');
      // Sort: available first, then by_request, then out_of_stock
      const order = { available: 0, by_request: 1, out_of_stock: 2, archived: 3 };
      products.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      render();
    } catch (err) {
      console.error('Failed to load products', err);
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">The shop is taking a breather. Please refresh in a moment.</p>`;
    }
  }

  load();
})();
