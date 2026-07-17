/* Studio 37 — Cart drawer + Stripe Checkout
 *
 * Stores the cart in sessionStorage and exposes a tiny global API:
 *   window.Studio37Cart.add(product, qty?)
 *   window.Studio37Cart.open()
 *   window.Studio37Cart.count()
 *
 * On checkout the drawer POSTs cart contents to /api/stripe/checkout-session
 * and redirects to the returned Stripe-hosted Checkout URL. */
(() => {
  const STORAGE_KEY = 'studio37_cart_v1';
  const LEGACY_STORAGE_KEYS = []; // none yet; previously sessionStorage same key
  const CONFIG_KEY = 'studio37_public_config';

  let items = readCart();
  let publicConfig = null;
  let drawer = null;
  let backdrop = null;
  let lastRevalidatedAt = 0;
  const REVALIDATE_TTL_MS = 60 * 1000;

  // ── storage ────────────────────────────────────────────
  // Cart now persists in localStorage so it survives tab close + browser quit.
  // We migrate any older sessionStorage cart on first run.
  function readCart() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // One-time migration from sessionStorage (pre-Epic 3 cart).
        const legacy = sessionStorage.getItem(STORAGE_KEY);
        if (legacy) {
          localStorage.setItem(STORAGE_KEY, legacy);
          sessionStorage.removeItem(STORAGE_KEY);
          raw = legacy;
        }
      }
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function writeCart() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }

  // Cross-tab sync: pick up cart changes from other tabs.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    try {
      const parsed = e.newValue ? JSON.parse(e.newValue) : [];
      items = Array.isArray(parsed) ? parsed : [];
    } catch { items = []; }
    updateCount();
    if (drawer && drawer.classList.contains('open')) render();
  });

  // ── server revalidation ────────────────────────────────
  // Reconciles cart against latest product state. Marks each line with
  // `_warning` and (when price changed) `_serverPrice`. The Stripe Checkout
  // endpoint also re-reads the source-of-truth price, but this gives users
  // a visible reason for any change before they pay.
  async function revalidateCart({ force = false } = {}) {
    if (!items.length) return;
    if (!force && Date.now() - lastRevalidatedAt < REVALIDATE_TTL_MS) return;
    let catalog;
    try {
      const r = await fetch('/api/products', { headers: { accept: 'application/json' } });
      if (!r.ok) return;
      catalog = await r.json();
    } catch { return; }
    if (!Array.isArray(catalog)) return;
    const byId = new Map(catalog.map((p) => [p.id, p]));
    let changed = false;
    items.forEach((line) => {
      const prev = line._warning;
      const prevPrice = line._serverPrice;
      const p = byId.get(line.id);
      if (!p) { line._warning = 'missing'; line._serverPrice = null; }
      else if (p.status === 'archived') { line._warning = 'unavailable'; line._serverPrice = null; }
      else if (p.status === 'by_request') { line._warning = 'by_request'; line._serverPrice = null; }
      else if (p.status === 'out_of_stock') { line._warning = 'out_of_stock'; line._serverPrice = p.price ?? null; }
      else if (typeof p.price === 'number' && p.price !== line.price) { line._warning = 'price_changed'; line._serverPrice = p.price; }
      else { line._warning = null; line._serverPrice = null; }
      if (line._warning !== prev || line._serverPrice !== prevPrice) changed = true;
    });
    lastRevalidatedAt = Date.now();
    if (changed) {
      writeCart();
      if (drawer && drawer.classList.contains('open')) render();
    }
  }

  function acceptServerPrice(id) {
    const it = items.find((i) => i.id === id);
    if (!it || typeof it._serverPrice !== 'number') return;
    it.price = it._serverPrice;
    it._warning = null;
    it._serverPrice = null;
    writeCart();
    render();
  }

  function hasBlockingWarnings() {
    return items.some((i) => ['missing', 'unavailable', 'by_request', 'out_of_stock', 'price_changed'].includes(i._warning));
  }

  async function loadConfig() {
    if (publicConfig) return publicConfig;
    try {
      const cached = sessionStorage.getItem(CONFIG_KEY);
      if (cached) publicConfig = JSON.parse(cached);
    } catch { /* ignore */ }
    try {
      const r = await fetch('/api/public-config');
      if (r.ok) {
        publicConfig = await r.json();
        try { sessionStorage.setItem(CONFIG_KEY, JSON.stringify(publicConfig)); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return publicConfig || { checkoutEnabled: false };
  }

  // ── helpers ────────────────────────────────────────────
  function fmtMoney(cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }
  function totals() {
    const subtotal = items.reduce((s, i) => s + (i.price * i.quantity), 0);
    const count = items.reduce((s, i) => s + i.quantity, 0);
    return { subtotal, count };
  }
  function updateCount() {
    const { count } = totals();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = count > 0 ? String(count) : '';
    });
  }

  // ── cart ops ───────────────────────────────────────────
  function add(product, qty = 1) {
    if (!product || !product.id) return;
    const idx = items.findIndex((i) => i.id === product.id);
    if (idx >= 0) {
      items[idx].quantity = Math.min(20, items[idx].quantity + qty);
    } else {
      items.push({
        id: product.id,
        name: product.name,
        price: product.price, // cents
        image: (product.images && product.images[0]) || '',
        quantity: Math.max(1, Math.min(20, qty)),
      });
    }
    writeCart();
    updateCount();
    render();
    open();
  }

  function remove(id) {
    items = items.filter((i) => i.id !== id);
    writeCart();
    updateCount();
    render();
  }

  function setQty(id, qty) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    it.quantity = Math.max(1, Math.min(20, qty));
    writeCart();
    updateCount();
    render();
  }

  function clear() {
    items = [];
    writeCart();
    updateCount();
    render();
  }

  // ── drawer DOM ─────────────────────────────────────────
  function ensureDrawer() {
    if (drawer) return;
    backdrop = document.createElement('div');
    backdrop.className = 'cart-backdrop';
    backdrop.addEventListener('click', close);

    drawer = document.createElement('aside');
    drawer.className = 'cart-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('aria-label', 'Shopping cart');
    drawer.innerHTML = `
      <header class="cart-head">
        <h2>Your Cart</h2>
        <button class="cart-close" type="button" aria-label="Close cart">&times;</button>
      </header>
      <div class="cart-body" data-cart-body></div>
      <footer class="cart-foot" data-cart-foot></footer>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    drawer.querySelector('.cart-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
  }

  function render() {
    if (!drawer) return;
    const body = drawer.querySelector('[data-cart-body]');
    const foot = drawer.querySelector('[data-cart-foot]');
    if (!items.length) {
      body.innerHTML = `<p class="cart-empty">Your cart is empty.<br/><br/><a class="btn-ghost" href="/shop">Browse the shop</a></p>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = items.map((i) => {
      const warning = warningHtml(i);
      const priceClass = i._warning === 'price_changed' ? ' was-changed' : '';
      return `
      <article class="cart-line${i._warning ? ' has-warning' : ''}" data-id="${i.id}">
        <div class="cart-line-img">${i.image ? `<img src="${i.image}" alt="" />` : ''}</div>
        <div class="cart-line-body">
          <div class="cart-line-name">${escape(i.name)}</div>
          <div class="cart-line-price${priceClass}">${fmtMoney(i.price)}</div>
          <div class="cart-line-qty">
            <button type="button" data-qty-dec aria-label="Decrease quantity">&minus;</button>
            <span>${i.quantity}</span>
            <button type="button" data-qty-inc aria-label="Increase quantity">&plus;</button>
            <button type="button" data-remove class="cart-line-remove">Remove</button>
          </div>
          ${warning}
        </div>
        <div class="cart-line-sub">${fmtMoney(i.price * i.quantity)}</div>
      </article>
    `;
    }).join('');

    const { subtotal } = totals();
    const blocked = hasBlockingWarnings();
    foot.innerHTML = `
      <div class="cart-totals">
        <span>Subtotal</span>
        <strong>${fmtMoney(subtotal)}</strong>
      </div>
      <p class="cart-fineprint">Shipping &amp; tax calculated at checkout.</p>
      ${blocked ? '<p class="cart-fineprint" style="color:#b54;">Resolve the issues above before checking out.</p>' : ''}
      <button class="btn-primary cart-checkout" type="button"${blocked ? ' disabled' : ''}>Checkout &rarr;</button>
    `;

    body.querySelectorAll('.cart-line').forEach((line) => {
      const id = line.dataset.id;
      line.querySelector('[data-qty-dec]')?.addEventListener('click', () => setQty(id, qtyOf(id) - 1));
      line.querySelector('[data-qty-inc]')?.addEventListener('click', () => setQty(id, qtyOf(id) + 1));
      line.querySelector('[data-remove]')?.addEventListener('click', () => remove(id));
      line.querySelector('[data-accept-price]')?.addEventListener('click', () => acceptServerPrice(id));
    });
    foot.querySelector('.cart-checkout')?.addEventListener('click', checkout);
  }

  function warningHtml(line) {
    switch (line._warning) {
      case 'missing':
      case 'unavailable':
        return `<p class="cart-line-warning">No longer available. <a href="#" data-remove>Remove from cart</a></p>`;
      case 'by_request':
        return `<p class="cart-line-warning">This item is by request only. <a href="/contact">Contact Drew</a> to order.</p>`;
      case 'out_of_stock':
        return `<p class="cart-line-warning">Out of stock right now. <a href="#" data-remove>Remove</a> or check back soon.</p>`;
      case 'price_changed':
        return `<p class="cart-line-warning">Price changed to ${fmtMoney(line._serverPrice)}. <button type="button" class="link-btn" data-accept-price>Use new price</button> or <a href="#" data-remove>remove</a>.</p>`;
      default:
        return '';
    }
  }


  function qtyOf(id) {
    const it = items.find((i) => i.id === id);
    return it ? it.quantity : 1;
  }

  function escape(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function open() {
    ensureDrawer();
    render();
    requestAnimationFrame(() => {
      drawer.classList.add('open');
      backdrop.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    });
    // Refresh prices/availability against the catalog without blocking open.
    revalidateCart().catch(() => { /* ignore */ });
  }

  function close() {
    if (!drawer) return;
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // ── checkout ───────────────────────────────────────────
  async function checkout() {
    if (!items.length) return;
    const cfg = await loadConfig();
    const btn = drawer.querySelector('.cart-checkout');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting checkout…'; }

    // Force a fresh revalidation right before redirecting to Stripe.
    await revalidateCart({ force: true });
    if (hasBlockingWarnings()) {
      if (btn) { btn.disabled = false; btn.textContent = 'Checkout →'; }
      render();
      return;
    }

    if (!cfg.checkoutEnabled) {
      alert('Checkout is not yet active. Please contact Drew at (541) 514-7720 to place this order.');
      if (btn) { btn.disabled = false; btn.textContent = 'Checkout →'; }
      return;
    }

    try {
      const r = await fetch('/api/stripe/checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ id: i.id, quantity: i.quantity })),
        }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.url) {
        const msg = data?.message || data?.error || `Checkout failed (HTTP ${r.status}).`;
        alert(msg);
        if (btn) { btn.disabled = false; btn.textContent = 'Checkout →'; }
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error('Checkout failed', err);
      alert('Could not start checkout. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Checkout →'; }
    }
  }

  // ── nav cart button binding ────────────────────────────
  function wireNavCart() {
    // The shared nav is injected by site.js on DOMContentLoaded. Deferred scripts
    // can run while readyState is already "interactive", so the cart may boot
    // before that button exists. Delegate from document so injected/replaced nav
    // buttons always work.
    document.addEventListener('click', (e) => {
      const toggle = e.target.closest?.('[data-cart-toggle]');
      if (!toggle) return;
      e.preventDefault();
      open();
    });
  }

  // ── checkout return handling ───────────────────────────
  function handleReturn() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;
    if (status === 'success') {
      clear();
      // Tiny banner via prompt-style toast
      const el = document.createElement('div');
      el.className = 'checkout-banner success';
      el.innerHTML = `<strong>Thank you!</strong> Your order is in. You'll receive a confirmation email shortly.`;
      document.body.appendChild(el);
      setTimeout(() => el.classList.add('show'), 50);
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 8000);
    } else if (status === 'cancelled') {
      const el = document.createElement('div');
      el.className = 'checkout-banner cancelled';
      el.textContent = 'Checkout cancelled. Your cart is still here when you’re ready.';
      document.body.appendChild(el);
      setTimeout(() => el.classList.add('show'), 50);
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 6000);
    }
    // Clean the URL.
    const u = new URL(window.location.href);
    u.searchParams.delete('checkout');
    u.searchParams.delete('session_id');
    window.history.replaceState({}, '', u.pathname + (u.search ? '?' + u.searchParams.toString() : '') + u.hash);
  }

  // ── boot ───────────────────────────────────────────────
  function boot() {
    wireNavCart();
    updateCount();
    handleReturn();
    loadConfig();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.Studio37Cart = { add, remove, clear, open, close, count: () => totals().count };
})();
