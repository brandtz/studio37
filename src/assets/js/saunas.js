/* Studio 37 — Saunas page: fetch sauna kit products, render cards. */
(() => {
  const grid = document.getElementById('sauna-kit-grid');
  if (!grid) return;

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
    grid.innerHTML = Array(5).fill(skeletonCard()).join('');
  }

  function fmtMoney(cents) {
    if (cents == null) return 'Made to order';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  function renderCard(p) {
    const img = (p.images && p.images[0]) || '/assets/images/shop/coming-soon.svg';
    return `
      <article class="card-product" data-status="${p.status}">
        <div class="card-product-img">
          <img src="${img}" alt="${p.name}" loading="lazy" />
        </div>
        <div class="card-product-body">
          <div class="card-product-category">Sauna Kit</div>
          <div class="card-product-name">${p.name}</div>
          ${p.subtitle ? `<div class="card-product-sub">${p.subtitle}</div>` : ''}
          <div class="card-product-footer">
            <span class="card-product-price">${p.price ? `From ${fmtMoney(p.price)}` : 'Made to order'}</span>
            <span class="card-product-cta">
              <a class="btn-ghost" href="/contact?service=saunas&product=${encodeURIComponent(p.id)}">Request Quote &rarr;</a>
            </span>
          </div>
        </div>
      </article>`;
  }

  async function load() {
    renderSkeletons();
    try {
      const r = await fetch('/api/products');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const products = await r.json();
      const saunas = products
        .filter((p) => p.category === 'saunas' && p.status !== 'archived')
        .sort((a, b) => a.id.localeCompare(b.id));
      if (!saunas.length) {
        grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">Kit lineup coming soon — contact Drew for a custom quote.</p>`;
        return;
      }
      grid.innerHTML = saunas.map(renderCard).join('');
    } catch (err) {
      console.error('Failed to load saunas', err);
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">Sauna kits will be listed here shortly. <a href="/contact?service=saunas" style="color:var(--color-accent);">Contact Drew</a> for a quote in the meantime.</p>`;
    }
  }

  load();
})();
