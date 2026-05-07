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
  const CONFIG_KEY = 'studio37_public_config';

  let items = readCart();
  let publicConfig = null;
  let drawer = null;
  let backdrop = null;

  // ── storage ────────────────────────────────────────────
  function readCart() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  function writeCart() {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }

  // ── public config ──────────────────────────────────────
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
    body.innerHTML = items.map((i) => `
      <article class="cart-line" data-id="${i.id}">
        <div class="cart-line-img">${i.image ? `<img src="${i.image}" alt="" />` : ''}</div>
        <div class="cart-line-body">
          <div class="cart-line-name">${escape(i.name)}</div>
          <div class="cart-line-price">${fmtMoney(i.price)}</div>
          <div class="cart-line-qty">
            <button type="button" data-qty-dec aria-label="Decrease quantity">&minus;</button>
            <span>${i.quantity}</span>
            <button type="button" data-qty-inc aria-label="Increase quantity">&plus;</button>
            <button type="button" data-remove class="cart-line-remove">Remove</button>
          </div>
        </div>
        <div class="cart-line-sub">${fmtMoney(i.price * i.quantity)}</div>
      </article>
    `).join('');

    const { subtotal } = totals();
    foot.innerHTML = `
      <div class="cart-totals">
        <span>Subtotal</span>
        <strong>${fmtMoney(subtotal)}</strong>
      </div>
      <p class="cart-fineprint">Shipping &amp; tax calculated at checkout.</p>
      <button class="btn-primary cart-checkout" type="button">Checkout &rarr;</button>
    `;

    body.querySelectorAll('.cart-line').forEach((line) => {
      const id = line.dataset.id;
      line.querySelector('[data-qty-dec]')?.addEventListener('click', () => setQty(id, qtyOf(id) - 1));
      line.querySelector('[data-qty-inc]')?.addEventListener('click', () => setQty(id, qtyOf(id) + 1));
      line.querySelector('[data-remove]')?.addEventListener('click', () => remove(id));
    });
    foot.querySelector('.cart-checkout')?.addEventListener('click', checkout);
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
    document.querySelectorAll('[data-cart-toggle]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); open(); });
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
      el.innerHTML = `<strong>Thank you!</strong> Your order is in. You'll get a confirmation email from Stripe shortly.`;
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
