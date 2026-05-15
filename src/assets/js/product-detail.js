/* Studio 37 — Product detail page. Loads /api/products/:id and renders. */
(() => {
  const root = document.getElementById('product-detail');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (!id) {
    root.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">Product not specified. <a href="/shop" style="color:var(--color-accent);">Back to shop</a>.</p>`;
    return;
  }

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }
  function escape(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(p) {
    document.title = `${p.name} — Studio 37`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && p.subtitle) meta.setAttribute('content', p.subtitle);

    const imgs = (p.images || []).filter(Boolean);
    const hero = imgs[0] || '/assets/images/logo.png';
    const thumbs = imgs.length > 1
      ? `<div class="product-thumbs">${imgs.map((u, i) => `<button type="button" class="product-thumb${i === 0 ? ' active' : ''}" data-src="${escape(u)}"><img src="${escape(u)}" alt="" /></button>`).join('')}</div>`
      : '';

    const isBuyable = p.status === 'available' && typeof p.price === 'number';
    const isByRequest = p.status === 'by_request';
    const isOOS = p.status === 'out_of_stock';

    const priceLine = p.price != null
      ? (isByRequest ? `From ${fmtMoney(p.price)}` : fmtMoney(p.price))
      : '';

    const specs = [];
    if (p.dimensions) specs.push(['Dimensions', p.dimensions]);
    if (p.materials) specs.push(['Materials', p.materials]);
    if (p.lead_time_days) specs.push(['Lead time', `${p.lead_time_days} days`]);
    if (p.sku) specs.push(['SKU', p.sku]);
    const specsHtml = specs.length
      ? `<dl class="product-specs">${specs.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`
      : '';

    let ctaHtml = '';
    if (isBuyable) {
      ctaHtml = `<button class="btn-primary" type="button" id="pd-add-to-cart">Add to cart &mdash; ${escape(fmtMoney(p.price))}</button>`;
    } else if (isByRequest) {
      ctaHtml = `<a class="btn-primary" href="/contact?product=${encodeURIComponent(p.id)}">Request a quote</a>`;
    } else if (isOOS) {
      ctaHtml = `<button class="btn-primary" type="button" disabled>Out of stock</button>`;
    }

    root.innerHTML = `
      <div>
        <div class="product-hero"><img id="pd-hero" src="${escape(hero)}" alt="${escape(p.name)}" onerror="this.onerror=null;this.src='/assets/images/logo.png';" /></div>
        ${thumbs}
      </div>
      <div>
        <p class="product-category">${escape(p.subtitle || '')}</p>
        <h1 style="margin:0 0 var(--space-3);">${escape(p.name)}</h1>
        ${priceLine ? `<p class="product-price">${escape(priceLine)}</p>` : ''}
        ${p.description ? `<div class="product-description">${escape(p.description).replace(/\n/g, '<br/>')}</div>` : ''}
        ${specsHtml}
        <div style="margin-top:var(--space-5);">${ctaHtml}</div>
      </div>
    `;

    // Thumbnail swap
    root.querySelectorAll('.product-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = btn.dataset.src;
        const heroImg = document.getElementById('pd-hero');
        if (heroImg && src) heroImg.src = src;
        root.querySelectorAll('.product-thumb').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Add to cart
    document.getElementById('pd-add-to-cart')?.addEventListener('click', () => {
      if (window.Studio37Cart) window.Studio37Cart.add(p, 1);
    });
  }

  fetch(`/api/products/${encodeURIComponent(id)}`)
    .then((r) => {
      if (r.status === 404) throw new Error('not_found');
      if (!r.ok) throw new Error('http_' + r.status);
      return r.json();
    })
    .then(render)
    .catch((err) => {
      if (err.message === 'not_found') {
        root.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">This product is no longer available. <a href="/shop" style="color:var(--color-accent);">Browse the shop</a>.</p>`;
      } else {
        root.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">Could not load this product. <a href="/shop" style="color:var(--color-accent);">Browse the shop</a>.</p>`;
      }
    });
})();
