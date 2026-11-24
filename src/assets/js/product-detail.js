/* Studio 37 — Product detail page. Loads /api/products/:id and renders. */
(() => {
  const root = document.getElementById('product-detail');
  if (!root) return;

  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const copy = Object.fromEntries(Studio37ContentSchema['dynamic-copy'].fields.map((field) => [field.id, field.default]));
  let currentProduct = null;
  let failure = id ? null : 'unspecified';
  Studio37Content.loadScope('dynamic-copy').then((values) => {
    Object.assign(copy, values);
    if (failure) renderFailure(failure);
    else if (currentProduct) render(currentProduct);
  });
  if (!id) {
    renderFailure('unspecified');
    return;
  }

  function fmtMoney(cents) {
    if (cents == null) return '—';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }
  function escape(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function renderFailure(reason) {
    const text = copy[reason === 'unspecified' ? 'product-unspecified' : reason === 'not_found' ? 'product-unavailable' : 'product-error'];
    const link = copy[reason === 'unspecified' ? 'product-back' : 'product-browse'];
    root.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8);">${escape(text)} <a href="/shop" style="color:var(--color-accent);">${escape(link)}</a>.</p>`;
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
      ? (isByRequest ? `${copy['shop-from']} ${fmtMoney(p.price)}` : fmtMoney(p.price))
      : '';

    const specs = [];
    if (p.dimensions) specs.push([copy['product-dimensions'], p.dimensions]);
    if (p.materials) specs.push([copy['product-materials'], p.materials]);
    if (p.lead_time_days) specs.push([copy['product-lead-time'], `${p.lead_time_days} ${copy['product-days']}`]);
    if (p.sku) specs.push([copy['product-sku'], p.sku]);
    const specsHtml = specs.length
      ? `<dl class="product-specs">${specs.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`
      : '';

    let ctaHtml = '';
    if (isBuyable) {
      ctaHtml = `<button class="btn-primary" type="button" id="pd-add-to-cart">${escape(copy['product-add'])} &mdash; ${escape(fmtMoney(p.price))}</button>`;
    } else if (isByRequest) {
      ctaHtml = `<a class="btn-primary" href="/contact?product=${encodeURIComponent(p.id)}">${escape(copy['product-request'])}</a>`;
    } else if (isOOS) {
      ctaHtml = `<button class="btn-primary" type="button" disabled>${escape(copy['product-unavailable-button'])}</button>`;
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
    .then((product) => { currentProduct = product; render(product); })
    .catch((err) => {
      failure = err.message === 'not_found' ? 'not_found' : 'error';
      renderFailure(failure);
    });
})();
