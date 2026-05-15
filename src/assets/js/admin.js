/* Studio 37 — Admin panel: products, media, reviews, leads, users.
   Auth: Bearer JWT in sessionStorage (issued by /api/auth/login). */
(() => {
  const TOKEN_KEY = 'studio37_session_token';
  let sessionToken = sessionStorage.getItem(TOKEN_KEY) || '';
  let me = null; // { email, role }

  let products = [];
  let reviews = [];
  let users = [];
  let categories = [];
  let siteMedia = [];
  let editing = null;
  let pendingImages = [];
  let editingReview = null;
  let editingCategory = null;
  let editingSlot = null;
  let mediaProductId = '';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ── API helpers ────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {},
    );
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
    if (opts.body instanceof FormData) delete headers['Content-Type'];
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    if (r.status === 401) {
      clearSession();
      window.location.replace('/admin');
      throw new Error('Unauthorized');
    }
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try {
        const j = await r.json();
        if (j?.error) msg = j.message || j.error;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    return r.status === 204 ? null : r.json();
  }

  // ── session helpers ────────────────────────────────────
  function setSession(token, user) {
    sessionToken = token;
    me = user || null;
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      markLoginNow();
    }
  }

  function clearSession() {
    sessionToken = '';
    me = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(LOGIN_AT_KEY);
    sessionStorage.removeItem(ACTIVITY_AT_KEY);
  }

  // ── session lifetime & cross-tab sync ──────────────────
  // Hard expiry: 8h from login. Idle expiry: 30 min of inactivity.
  // BroadcastChannel keeps all admin tabs in sync on logout.
  const LOGIN_AT_KEY = 'studio37_login_at';
  const ACTIVITY_AT_KEY = 'studio37_activity_at';
  const HARD_EXPIRY_MS = 8 * 60 * 60 * 1000;
  const IDLE_EXPIRY_MS = 30 * 60 * 1000;
  const ACTIVITY_THROTTLE_MS = 30 * 1000;

  let authChannel = null;
  try { authChannel = new BroadcastChannel('studio37-admin-auth'); } catch { /* unsupported */ }

  function markLoginNow() {
    const now = String(Date.now());
    sessionStorage.setItem(LOGIN_AT_KEY, now);
    sessionStorage.setItem(ACTIVITY_AT_KEY, now);
  }

  function touchActivity() {
    const now = Date.now();
    const last = parseInt(sessionStorage.getItem(ACTIVITY_AT_KEY) || '0', 10);
    if (now - last >= ACTIVITY_THROTTLE_MS) {
      sessionStorage.setItem(ACTIVITY_AT_KEY, String(now));
    }
  }

  function forceLogout(reason) {
    try { authChannel?.postMessage({ type: 'logout', reason }); } catch { /* ignore */ }
    clearSession();
    try { fetch('/api/auth/logout', { method: 'POST', keepalive: true }); } catch { /* ignore */ }
    const msg = reason === 'idle' ? '?reason=idle' : reason === 'expired' ? '?reason=expired' : '';
    window.location.replace('/admin' + msg);
  }

  function checkSessionExpiry() {
    if (!sessionToken) return;
    const now = Date.now();
    const loginAt = parseInt(sessionStorage.getItem(LOGIN_AT_KEY) || '0', 10);
    const activityAt = parseInt(sessionStorage.getItem(ACTIVITY_AT_KEY) || '0', 10);
    if (loginAt && now - loginAt > HARD_EXPIRY_MS) { forceLogout('expired'); return; }
    if (activityAt && now - activityAt > IDLE_EXPIRY_MS) { forceLogout('idle'); return; }
  }

  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => {
    window.addEventListener(ev, touchActivity, { passive: true });
  });
  setInterval(checkSessionExpiry, 30 * 1000);

  if (authChannel) {
    authChannel.addEventListener('message', (e) => {
      if (e.data?.type === 'logout' && sessionToken) {
        clearSession();
        window.location.replace('/admin');
      }
    });
  }

  // ── Unsaved-changes guard (beforeunload) ───────────────
  // Tracks dirtiness of any open drawer form. Browser shows a generic
  // "Leave site?" prompt if the user reloads/closes the tab while dirty.
  const dirtyDrawers = new Set();
  function markDirty(name) { dirtyDrawers.add(name); }
  function markClean(name) { dirtyDrawers.delete(name); }
  function clearAllDirty() { dirtyDrawers.clear(); }

  window.addEventListener('beforeunload', (e) => {
    if (dirtyDrawers.size > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Wire 'input' events on each form to mark its drawer dirty.
  // Forms must opt in via data-dirty-name attribute (set in HTML).
  document.addEventListener('input', (e) => {
    const form = e.target?.closest?.('form[data-dirty-name]');
    if (form) markDirty(form.dataset.dirtyName);
  }, true);

  // ── Escape closes topmost open drawer ──────────────────
  const DRAWER_CLOSERS = [
    { id: 'drawer',          fn: () => closeProductDrawer?.() },
    { id: 'review-drawer',   fn: () => closeReviewDrawer?.() },
    { id: 'category-drawer', fn: () => closeCategoryDrawer?.() },
    { id: 'slot-drawer',     fn: () => closeSlotDrawer?.() },
    { id: 'order-drawer',    fn: () => closeOrderDrawer?.() },
    { id: 'pwd-drawer',      fn: () => closePwdDrawer?.() },
  ];
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Topmost (last-opened) — iterate in reverse so a stacked drawer wins.
    for (let i = DRAWER_CLOSERS.length - 1; i >= 0; i--) {
      const d = DRAWER_CLOSERS[i];
      const el = document.getElementById(d.id);
      if (el && el.classList.contains('open')) {
        e.preventDefault();
        d.fn();
        return;
      }
    }
  });

  // ── slug / format helpers ──────────────────────────────
  function slugify(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }
  function fmtMoney(cents) {
    if (cents == null) return '—';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }
  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  function statusLabel(s) {
    return ({ available: 'Available', out_of_stock: 'Out of Stock', by_request: 'By Request', archived: 'Archived' })[s] || s;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  // ── auth flow ──────────────────────────────────────────
  $('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    if (dirtyDrawers.size > 0 && !confirm('You have unsaved changes. Sign out anyway?')) return;
    clearAllDirty();
    try { authChannel?.postMessage({ type: 'logout', reason: 'manual' }); } catch { /* ignore */ }
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearSession();
    window.location.replace('/admin');
  });

  // ── change password ────────────────────────────────────
  function openPwdDrawer() {
    $('#pwd-current').value = '';
    $('#pwd-new1').value = '';
    $('#pwd-new2').value = '';
    $('#pwd-error').textContent = '';
    $('#pwd-drawer').setAttribute('aria-hidden', 'false');
    $('#pwd-drawer').classList.add('open');
    $('#pwd-drawer-overlay').classList.add('open');
    setTimeout(() => $('#pwd-current').focus(), 50);
  }
  function closePwdDrawer() {
    $('#pwd-drawer').setAttribute('aria-hidden', 'true');
    $('#pwd-drawer').classList.remove('open');
    $('#pwd-drawer-overlay').classList.remove('open');
    markClean('pwd');
  }
  $('#change-password').addEventListener('click', (e) => { e.preventDefault(); openPwdDrawer(); });
  $('#pwd-drawer-close').addEventListener('click', closePwdDrawer);
  $('#pwd-drawer-cancel').addEventListener('click', closePwdDrawer);
  $('#pwd-drawer-overlay').addEventListener('click', closePwdDrawer);
  $('#pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = $('#pwd-current').value;
    const newPassword = $('#pwd-new1').value;
    const confirm = $('#pwd-new2').value;
    const errEl = $('#pwd-error');
    errEl.textContent = '';
    if (newPassword.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
    if (newPassword !== confirm) { errEl.textContent = 'New passwords do not match.'; return; }
    if (newPassword === currentPassword) { errEl.textContent = 'New password must differ from current.'; return; }
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      closePwdDrawer();
      toast('Password updated.');
    } catch (err) {
      errEl.textContent = err.message || 'Could not update password.';
    }
  });

  // ── nav ────────────────────────────────────────────────
  $$('.admin-nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      setSection(a.dataset.section);
    });
  });

  function setSection(section) {
    if (section === 'users' && me?.role !== 'super') section = 'products';
    if (section === 'connect' && me?.role !== 'super') section = 'products';
    const sectionMap = ['products', 'media', 'reviews', 'orders', 'leads', 'users', 'connect', 'categories', 'site-media'];
    sectionMap.forEach((s) => {
      const el = $(`#section-${s}`);
      if (el) el.hidden = s !== section;
    });

    $$('.admin-nav a').forEach((x) => x.classList.toggle('active', x.dataset.section === section));
    $('#section-title').textContent = ({
      products: 'Products', media: 'Media', reviews: 'Reviews',
      orders: 'Orders', leads: 'Leads', users: 'Users', connect: 'Payments',
      categories: 'Product Categories', 'site-media': 'Site Media',
    })[section] || 'Admin';

    $('#new-product-btn').hidden = section !== 'products';
    $('#new-review-btn').hidden = section !== 'reviews';
    $('#new-user-btn').hidden = section !== 'users';
    $('#new-category-btn').hidden = section !== 'categories';

    if (section === 'products') loadProducts();
    if (section === 'media')    loadProducts();
    if (section === 'reviews')  loadReviews();
    if (section === 'orders')   loadOrders();
    if (section === 'leads')    loadLeads();
    if (section === 'users')    loadUsers();
    if (section === 'connect')  loadConnect();
    if (section === 'categories') loadCategories();
    if (section === 'site-media') loadSiteMedia();
  }

  // ── products list ──────────────────────────────────────
  function renderProducts() {
    const tbody = $('#products-tbody');
    const search = $('#search').value.toLowerCase().trim();
    const status = $('#status-filter').value;
    const cat = $('#category-filter').value;

    const filtered = products.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (cat !== 'all' && p.category !== cat) return false;
      if (search && !(`${p.name} ${p.subtitle || ''}`.toLowerCase().includes(search))) return false;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No products match.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((p) => `
      <tr data-id="${p.id}">
        <td><img class="admin-table-thumb admin-row-clickable" data-action="edit" src="${p.images?.[0] || '/assets/images/logo.png'}" alt="" /></td>
        <td>
          <span class="admin-table-name admin-row-clickable" data-action="edit">${p.name}</span>
          ${p.subtitle ? `<span class="admin-table-sub">${p.subtitle}</span>` : ''}
        </td>
        <td><span class="admin-table-price">${fmtMoney(p.price)}</span></td>
        <td><span class="admin-status-dot admin-status-${p.status}"></span>${statusLabel(p.status)}</td>
        <td style="text-align:right;">
          <button class="btn-admin-ghost" data-action="edit">Edit</button>
          ${p.status === 'archived'
            ? `<button class="btn-admin-ghost" data-action="unarchive" title="Restore">⤴</button>`
            : `<button class="btn-admin-ghost" data-action="archive" title="Archive">✕</button>`}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.closest('tr').dataset.id;
        openProductDrawer(products.find((p) => p.id === id));
      });
    });
    tbody.querySelectorAll('button[data-action="archive"]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.closest('tr').dataset.id;
        const p = products.find((x) => x.id === id);
        if (!p) return;
        if (!confirm(`Archive "${p.name}"? It will be hidden from the public shop.`)) return;
        try {
          await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
          toast('Archived.');
          await loadProducts();
        } catch (err) { toast('Archive failed: ' + (err.message || ''), true); }
      });
    });
    tbody.querySelectorAll('button[data-action="unarchive"]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.closest('tr').dataset.id;
        const p = products.find((x) => x.id === id);
        if (!p) return;
        try {
          await saveProduct({ ...p, status: 'available' });
          toast('Restored.');
          await loadProducts();
        } catch (err) { toast('Restore failed: ' + (err.message || ''), true); }
      });
    });
  }

  function populateMediaProductSelect() {
    const sel = $('#media-product-select');
    const prev = mediaProductId;
    sel.innerHTML = '<option value="">Select a product</option>' + products
      .filter((p) => p.status !== 'archived')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
    if (products.some((p) => p.id === prev)) sel.value = prev;
    renderMediaThumbs();
  }

  async function loadProducts() {
    try {
      products = await api('/api/admin/products');
      renderProducts();
      populateMediaProductSelect();
    } catch (err) { console.error(err); }
  }

  ['#search', '#status-filter', '#category-filter'].forEach((s) => {
    const el = $(s);
    if (el) el.addEventListener('input', renderProducts);
  });

  async function uploadOne(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await api('/api/admin/upload', { method: 'POST', body: fd });
    return res?.url || '';
  }

  async function saveProduct(product) {
    await api(`/api/admin/products/${encodeURIComponent(product.id)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    });
  }

  // ── product drawer ─────────────────────────────────────
  const drawer = $('#drawer');
  const drawerOverlay = $('#drawer-overlay');

  function openProductDrawer(product) {
    editing = product || null;
    pendingImages = product?.images ? [...product.images] : [];
    $('#drawer-title').textContent = product ? 'Edit Product' : 'New Product';
    $('#f-id').value = product?.id || '';
    $('#f-name').value = product?.name || '';
    $('#f-subtitle').value = product?.subtitle || '';
    $('#f-category').value = product?.category || (categories.find((c) => !c.archived)?.id ?? 'small-goods');
    $('#f-price').value = product?.price != null ? (product.price / 100).toFixed(2) : '';
    $('#f-description').value = product?.description || '';
    $('#f-shipping').checked = product?.shipping !== false;
    $('#f-weight').value = product?.weight_oz || '';
    const status = product?.status || 'available';
    const radio = $(`input[name="status"][value="${status}"]`);
    if (radio) radio.checked = true;
    renderProductThumbs();
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
  }

  function closeProductDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    editing = null;
    pendingImages = [];
    markClean('product');
  }

  $('#new-product-btn').addEventListener('click', () => openProductDrawer(null));
  $('#drawer-close').addEventListener('click', closeProductDrawer);
  $('#drawer-cancel').addEventListener('click', closeProductDrawer);
  drawerOverlay.addEventListener('click', closeProductDrawer);

  function renderProductThumbs() {
    const wrap = $('#f-thumbs');
    wrap.innerHTML = pendingImages.map((url, i) => `
      <div class="thumb">
        <img src="${url}" alt="" />
        <button type="button" data-idx="${i}" aria-label="Remove">&times;</button>
      </div>
    `).join('');
    wrap.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        pendingImages.splice(parseInt(b.dataset.idx, 10), 1);
        renderProductThumbs();
      });
    });
  }

  const upZone = $('#f-upload-zone');
  const upInput = $('#f-photos');
  upZone.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') upInput.click(); });
  upInput.addEventListener('change', async () => {
    const files = Array.from(upInput.files);
    for (const f of files) {
      try {
        const url = await uploadOne(f);
        if (url) pendingImages.push(url);
      } catch (err) { toast('Upload failed: ' + (err.message || ''), true); }
    }
    upInput.value = '';
    renderProductThumbs();
  });

  $('#product-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#f-id').value || slugify($('#f-name').value);
    const priceDollars = parseFloat($('#f-price').value);
    const body = {
      id,
      name: $('#f-name').value.trim(),
      subtitle: $('#f-subtitle').value.trim(),
      category: $('#f-category').value,
      price: Number.isFinite(priceDollars) ? Math.round(priceDollars * 100) : null,
      description: $('#f-description').value.trim(),
      status: document.querySelector('input[name="status"]:checked').value,
      images: pendingImages,
      shipping: $('#f-shipping').checked,
      weight_oz: parseInt($('#f-weight').value, 10) || 0,
    };
    try {
      const isNew = !editing;
      const path = isNew ? '/api/admin/products' : `/api/admin/products/${encodeURIComponent(editing.id)}`;
      await api(path, { method: isNew ? 'POST' : 'PUT', body: JSON.stringify(body) });
      toast(isNew ? 'Product created.' : 'Product saved.');
      closeProductDrawer();
      await loadProducts();
    } catch (err) { toast('Save failed: ' + (err.message || ''), true); }
  });

  // ── media manager ──────────────────────────────────────
  function renderMediaThumbs() {
    const wrap = $('#media-thumbs');
    const empty = $('#media-empty');
    const p = products.find((x) => x.id === mediaProductId);
    if (!p) {
      empty.textContent = 'Select a product to manage photos.';
      wrap.innerHTML = '';
      return;
    }
    const images = Array.isArray(p.images) ? p.images : [];
    if (!images.length) {
      empty.textContent = `${p.name} has no photos yet.`;
      wrap.innerHTML = '';
      return;
    }
    empty.textContent = `Managing photos for ${p.name}`;
    wrap.innerHTML = images.map((url, i) => `
      <div class="thumb">
        <img src="${url}" alt="" />
        <button type="button" data-remove-image="${i}" aria-label="Remove">&times;</button>
      </div>
    `).join('');
    wrap.querySelectorAll('button[data-remove-image]').forEach((b) => {
      b.addEventListener('click', async () => {
        const idx = parseInt(b.dataset.removeImage, 10);
        const next = (p.images || []).filter((_, i) => i !== idx);
        try {
          await saveProduct({ ...p, images: next });
          toast('Photo removed.');
          await loadProducts();
          $('#media-product-select').value = mediaProductId;
        } catch (err) { toast('Could not remove photo.', true); }
      });
    });
  }

  $('#media-product-select').addEventListener('change', (e) => {
    mediaProductId = e.target.value;
    renderMediaThumbs();
  });

  $('#media-upload-zone').addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') $('#media-upload-input').click();
  });

  $('#media-upload-input').addEventListener('change', async () => {
    const p = products.find((x) => x.id === mediaProductId);
    if (!p) {
      $('#media-upload-input').value = '';
      toast('Select a product first.', true);
      return;
    }
    const files = Array.from($('#media-upload-input').files);
    const uploaded = [];
    for (const f of files) {
      try {
        const url = await uploadOne(f);
        if (url) uploaded.push(url);
      } catch (err) { toast('One upload failed: ' + (err.message || ''), true); }
    }
    $('#media-upload-input').value = '';
    if (!uploaded.length) return;
    try {
      await saveProduct({ ...p, images: [...(p.images || []), ...uploaded] });
      toast('Photos added.');
      await loadProducts();
      $('#media-product-select').value = mediaProductId;
    } catch (err) { toast('Could not save photos.', true); }
  });

  // ── reviews ────────────────────────────────────────────
  const reviewDrawer = $('#review-drawer');
  const reviewDrawerOverlay = $('#review-drawer-overlay');

  function renderReviews() {
    const tbody = $('#reviews-tbody');
    if (!reviews.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No reviews yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = reviews.map((r) => `
      <tr data-id="${r.id}">
        <td><span class="admin-table-price">${stars(r.stars || 5)}</span></td>
        <td>
          <span class="admin-table-name">${(r.text || '').slice(0, 110)}${(r.text || '').length > 110 ? '…' : ''}</span>
          ${r.project ? `<span class="admin-table-sub">${r.project}</span>` : ''}
        </td>
        <td>${r.name || '—'}<span class="admin-table-sub">${r.location || ''}</span></td>
        <td>${r.published === false ? 'Hidden' : 'Published'}</td>
        <td style="text-align:right;">
          <button class="btn-admin-ghost" data-review-action="edit">Edit</button>
          <button class="btn-admin-ghost" data-review-action="toggle">${r.published === false ? 'Publish' : 'Hide'}</button>
          <button class="btn-admin-ghost" data-review-action="delete">Delete</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-review-action="edit"]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.closest('tr').dataset.id;
        openReviewDrawer(reviews.find((x) => x.id === id));
      });
    });
    tbody.querySelectorAll('button[data-review-action="toggle"]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.closest('tr').dataset.id;
        const r = reviews.find((x) => x.id === id);
        if (!r) return;
        try {
          await api(`/api/admin/reviews/${encodeURIComponent(r.id)}`, {
            method: 'PUT',
            body: JSON.stringify({ ...r, published: r.published === false }),
          });
          toast('Review updated.');
          await loadReviews();
        } catch (err) { toast('Could not update review.', true); }
      });
    });
    tbody.querySelectorAll('button[data-review-action="delete"]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.closest('tr').dataset.id;
        if (!confirm('Delete this review?')) return;
        try {
          await api(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: 'DELETE' });
          toast('Review deleted.');
          await loadReviews();
        } catch (err) { toast('Could not delete review.', true); }
      });
    });
  }

  async function loadReviews() {
    try {
      reviews = await api('/api/admin/reviews');
      renderReviews();
    } catch (err) {
      console.error(err);
      $('#reviews-tbody').innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load reviews.</td></tr>`;
    }
  }

  function openReviewDrawer(review) {
    editingReview = review || null;
    $('#review-drawer-title').textContent = review ? 'Edit Review' : 'New Review';
    $('#r-id').value = review?.id || '';
    $('#r-name').value = review?.name || '';
    $('#r-location').value = review?.location || '';
    $('#r-project').value = review?.project || '';
    $('#r-stars').value = review?.stars || 5;
    $('#r-text').value = review?.text || '';
    $('#r-published').checked = review?.published !== false;
    reviewDrawer.classList.add('open');
    reviewDrawerOverlay.classList.add('open');
    reviewDrawer.setAttribute('aria-hidden', 'false');
  }

  function closeReviewDrawer() {
    reviewDrawer.classList.remove('open');
    reviewDrawerOverlay.classList.remove('open');
    reviewDrawer.setAttribute('aria-hidden', 'true');
    editingReview = null;
    markClean('review');
  }

  $('#new-review-btn').addEventListener('click', () => openReviewDrawer(null));
  $('#review-drawer-close').addEventListener('click', closeReviewDrawer);
  $('#review-drawer-cancel').addEventListener('click', closeReviewDrawer);
  reviewDrawerOverlay.addEventListener('click', closeReviewDrawer);

  $('#review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      id: $('#r-id').value || slugify(`${$('#r-name').value}-${Date.now()}`),
      name: $('#r-name').value.trim(),
      location: $('#r-location').value.trim(),
      project: $('#r-project').value.trim(),
      stars: parseInt($('#r-stars').value, 10) || 5,
      text: $('#r-text').value.trim(),
      published: $('#r-published').checked,
    };
    try {
      if (editingReview) {
        await api(`/api/admin/reviews/${encodeURIComponent(editingReview.id)}`, {
          method: 'PUT', body: JSON.stringify(body),
        });
      } else {
        await api('/api/admin/reviews', { method: 'POST', body: JSON.stringify(body) });
      }
      toast(editingReview ? 'Review saved.' : 'Review created.');
      closeReviewDrawer();
      await loadReviews();
    } catch (err) { toast('Save failed: ' + (err.message || ''), true); }
  });

  // ── leads ──────────────────────────────────────────────
  async function loadLeads() {
    try {
      const leads = await api('/api/admin/leads');
      const tbody = $('#leads-tbody');
      if (!Array.isArray(leads) || !leads.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No leads yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = leads.map((l) => `
        <tr>
          <td>${new Date(l.created_at).toLocaleString()}</td>
          <td>${[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}</td>
          <td>${l.service || '—'}</td>
          <td>${l.phone ? `<a href="tel:${l.phone}" style="color:var(--color-accent);">${l.phone}</a>` : '—'}</td>
          <td>${l.email ? `<a href="mailto:${l.email}" style="color:var(--color-accent);">${l.email}</a>` : '—'}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error(err);
      $('#leads-tbody').innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load leads.</td></tr>`;
    }
  }

  // ── orders ─────────────────────────────────────────────
  const LIFECYCLE_LABEL = {
    new: 'New',
    in_production: 'In production',
    ready_to_ship: 'Ready to ship',
    shipped: 'Shipped',
    delivered: 'Delivered',
    complete: 'Complete',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };

  let allOrders = [];
  let editingOrder = null;

  async function loadOrders() {
    const tbody = $('#orders-tbody');
    if (!tbody) return;
    try {
      const orders = await api('/api/admin/orders');
      allOrders = Array.isArray(orders) ? orders : [];
      if (!allOrders.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No orders yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = allOrders.map((o) => {
        const when = o.created_at ? new Date(o.created_at).toLocaleString() : '—';
        const customer = o.customer_email
          ? escapeHtml(o.customer_email)
          : (o.customer_name ? escapeHtml(o.customer_name) : '—');
        const items = Array.isArray(o.items) && o.items.length
          ? o.items.map((i) => `${escapeHtml(i.description || i.name || i.product_id || '')} ×${i.quantity || 1}`).join('<br/>')
          : '—';
        const total = typeof o.amount_total === 'number' ? '$' + (o.amount_total / 100).toFixed(2) : '—';
        const stage = LIFECYCLE_LABEL[o.lifecycle] || (o.lifecycle ? escapeHtml(o.lifecycle) : 'New');
        const stripeLink = o.payment_intent
          ? `<a href="https://dashboard.stripe.com/payments/${escapeHtml(o.payment_intent)}" target="_blank" rel="noopener" style="color:var(--color-accent);" onclick="event.stopPropagation()">Open &rarr;</a>`
          : '—';
        return `
          <tr data-order-id="${escapeHtml(o.id)}" style="cursor:pointer;">
            <td>${when}</td>
            <td>${customer}</td>
            <td>${items}</td>
            <td>${total}</td>
            <td><span class="badge badge-${escapeHtml(o.lifecycle || 'new')}">${stage}</span></td>
            <td style="text-align:right;">${stripeLink}</td>
          </tr>
        `;
      }).join('');
      tbody.querySelectorAll('tr[data-order-id]').forEach((row) => {
        row.addEventListener('click', () => {
          const id = row.dataset.orderId;
          const order = allOrders.find((x) => x.id === id);
          if (order) openOrderDrawer(order);
        });
      });
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load orders.</td></tr>`;
    }
  }

  // ── order detail drawer ───────────────────────────────
  const orderDrawer = $('#order-drawer');
  const orderDrawerOverlay = $('#order-drawer-overlay');

  function openOrderDrawer(order) {
    editingOrder = order;
    $('#order-drawer-title').textContent = 'Order — ' + order.id.slice(-12);

    const lines = (order.items || []).map((i) =>
      `<li>${escapeHtml(i.description || i.name || i.product_id || '')} ×${i.quantity || 1} — $${((i.amount_total || 0) / 100).toFixed(2)}</li>`
    ).join('');
    const total = typeof order.amount_total === 'number' ? '$' + (order.amount_total / 100).toFixed(2) : '—';
    const addr = order.shipping_address
      ? [order.shipping_name, order.shipping_address.line1, order.shipping_address.line2,
         `${order.shipping_address.city || ''}${order.shipping_address.state ? ', ' + order.shipping_address.state : ''} ${order.shipping_address.postal_code || ''}`,
         order.shipping_address.country]
          .filter(Boolean).map(escapeHtml).join('<br/>')
      : '<em>No shipping address</em>';

    $('#order-summary').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-5);font-size:.9rem;">
        <div>
          <div style="color:var(--color-text-muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;">Customer</div>
          <div><strong>${escapeHtml(order.customer_name || '—')}</strong></div>
          <div>${order.customer_email ? `<a href="mailto:${escapeHtml(order.customer_email)}" style="color:var(--color-accent);">${escapeHtml(order.customer_email)}</a>` : '—'}</div>
          <div>${escapeHtml(order.customer_phone || '')}</div>
        </div>
        <div>
          <div style="color:var(--color-text-muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;">Ship to</div>
          <div>${addr}</div>
        </div>
      </div>
      <div style="margin-top:var(--space-4);">
        <div style="color:var(--color-text-muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;">Items</div>
        <ul style="margin:6px 0 0;padding-left:1.25rem;">${lines || '<li>—</li>'}</ul>
        <div style="margin-top:var(--space-3);font-weight:600;">Total: ${total}</div>
        <div style="color:var(--color-text-muted);font-size:.75rem;margin-top:var(--space-2);">Stripe session: <code>${escapeHtml(order.id)}</code></div>
      </div>
    `;

    $('#o-lifecycle').value = order.lifecycle || 'new';
    $('#o-tracking-carrier').value = order.tracking_carrier || '';
    $('#o-tracking-number').value = order.tracking_number || '';
    $('#o-notes').value = order.internal_notes || '';

    const hist = (order.status_history || [])
      .map((h) => `<div>${escapeHtml(LIFECYCLE_LABEL[h.stage] || h.stage)} — ${h.at ? new Date(h.at).toLocaleString() : ''} <span style="opacity:.7;">by ${escapeHtml(h.by || 'system')}</span></div>`)
      .reverse()
      .join('');
    $('#o-history').innerHTML = hist || '<em>No transitions yet.</em>';

    orderDrawer.classList.add('open');
    orderDrawerOverlay.classList.add('open');
    orderDrawer.setAttribute('aria-hidden', 'false');
  }

  function closeOrderDrawer() {
    orderDrawer.classList.remove('open');
    orderDrawerOverlay.classList.remove('open');
    orderDrawer.setAttribute('aria-hidden', 'true');
    editingOrder = null;
    markClean('order');
  }

  $('#order-drawer-close')?.addEventListener('click', closeOrderDrawer);
  $('#order-drawer-cancel')?.addEventListener('click', closeOrderDrawer);
  orderDrawerOverlay?.addEventListener('click', closeOrderDrawer);

  $('#order-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingOrder) return;
    const payload = {
      lifecycle: $('#o-lifecycle').value,
      tracking_carrier: $('#o-tracking-carrier').value.trim(),
      tracking_number: $('#o-tracking-number').value.trim(),
      internal_notes: $('#o-notes').value,
    };
    try {
      const updated = await api(`/api/admin/orders/${encodeURIComponent(editingOrder.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      // Update in-memory cache and refresh UI.
      const idx = allOrders.findIndex((x) => x.id === updated.id);
      if (idx >= 0) allOrders[idx] = updated;
      toast('Order updated.');
      closeOrderDrawer();
      await loadOrders();
    } catch (err) {
      toast('Save failed: ' + (err.message || ''), true);
    }
  });

  // ── stripe connect ─────────────────────────────────────
  async function loadConnect() {
    const tbody = $('#connect-tbody');
    if (!tbody) return;
    try {
      const data = await api('/api/admin/stripe-connect?action=list');
      const tenants = Array.isArray(data) ? data : (Array.isArray(data?.tenants) ? data.tenants : []);
      if (!tenants.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No tenants configured.</td></tr>`;
        return;
      }
      tbody.innerHTML = tenants.map((t) => {
        const status = t.stripe_status || {};
        const acct = t.stripe_account_id
          ? `<code style="font-size:.8125rem;">${escapeHtml(t.stripe_account_id)}</code>`
          : `<span style="color:var(--color-text-muted);">Not connected</span>`;
        const pill = (ok, label) => `<span class="badge ${ok ? 'badge-ok' : 'badge-neutral'}">${ok ? '✓ ' : '— '}${label}</span>`;
        const reqs = Array.isArray(status.requirements_currently_due) && status.requirements_currently_due.length
          ? `<span style="color:var(--color-warn,#c79a4a);font-size:.8125rem;">${status.requirements_currently_due.length} pending</span>`
          : `<span style="color:var(--color-text-muted);font-size:.8125rem;">None</span>`;
        const actions = [];
        if (!t.stripe_account_id || !status.details_submitted) {
          actions.push(`<button type="button" class="btn-admin-primary" data-connect-onboard="${escapeHtml(t.id)}">Continue Onboarding</button>`);
        } else {
          actions.push(`<a href="https://dashboard.stripe.com/${escapeHtml(t.stripe_account_id)}" target="_blank" rel="noopener" class="btn-admin-ghost">Open Stripe &rarr;</a>`);
        }
        return `
          <tr>
            <td><strong>${escapeHtml(t.name || t.id)}</strong><br/><span style="color:var(--color-text-muted);font-size:.8125rem;">${escapeHtml(t.id)}</span></td>
            <td>${acct}</td>
            <td>${pill(!!status.charges_enabled, 'Charges')}</td>
            <td>${pill(!!status.payouts_enabled, 'Payouts')}</td>
            <td>${reqs}</td>
            <td style="text-align:right;">${actions.join(' ')}</td>
          </tr>
        `;
      }).join('');
      tbody.querySelectorAll('[data-connect-onboard]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const tenantId = btn.dataset.connectOnboard;
          btn.disabled = true; btn.textContent = 'Opening Stripe…';
          try {
            const res = await api('/api/admin/stripe-connect/onboard', {
              method: 'POST',
              body: JSON.stringify({ tenantId }),
            });
            if (res?.url) {
              window.open(res.url, '_blank', 'noopener');
              toast('Stripe onboarding opened in a new tab.');
              setTimeout(() => loadConnect(), 1000);
            } else {
              toast('Could not start onboarding.', true);
              btn.disabled = false; btn.textContent = 'Continue Onboarding';
            }
          } catch (err) {
            toast('Onboarding failed: ' + (err.message || ''), true);
            btn.disabled = false; btn.textContent = 'Continue Onboarding';
          }
        });
      });
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load Connect status.</td></tr>`;
    }
  }

  // ── users ──────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderUsers() {
    const pending = users.filter((u) => u.status === 'pending');
    const active = users.filter((u) => u.status !== 'pending');
    const pendTbody = $('#users-pending-tbody');
    const actTbody = $('#users-active-tbody');

    if (!pending.length) {
      pendTbody.innerHTML = `<tr><td colspan="4" style="padding:var(--space-5);text-align:center;color:var(--color-text-muted);">No pending requests.</td></tr>`;
    } else {
      pendTbody.innerHTML = pending.map((u) => `
        <tr data-email="${escapeHtml(u.email)}">
          <td><strong>${escapeHtml(u.email)}</strong></td>
          <td>
            ${u.request_name ? escapeHtml(u.request_name) : '—'}
            ${u.request_message ? `<span class="admin-table-sub">${escapeHtml(u.request_message)}</span>` : ''}
          </td>
          <td>${fmtDate(u.created_at)}</td>
          <td style="text-align:right;">
            <button class="btn-admin" data-user-action="approve">Approve</button>
            <button class="btn-admin-ghost" data-user-action="delete">Reject</button>
          </td>
        </tr>
      `).join('');
    }

    if (!active.length) {
      actTbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-5);text-align:center;color:var(--color-text-muted);">No active users.</td></tr>`;
    } else {
      actTbody.innerHTML = active.map((u) => {
        const isMe = me && u.email === me.email;
        const isSuper = u.role === 'super';
        return `
        <tr data-email="${escapeHtml(u.email)}">
          <td><strong>${escapeHtml(u.email)}</strong>${isMe ? ' <em style="color:var(--color-text-muted);">(you)</em>' : ''}</td>
          <td>${escapeHtml(u.role)}${u.passwordSet ? '' : ' <span style="color:var(--color-text-muted);">· no password yet</span>'}</td>
          <td>${escapeHtml(u.status)}</td>
          <td>${fmtDate(u.last_login)}</td>
          <td style="text-align:right;">
            <button class="btn-admin-ghost" data-user-action="reset-password" ${isMe ? 'disabled title="Use sign out + first login flow on yourself"' : ''}>Reset password</button>
            ${u.status === 'disabled'
              ? `<button class="btn-admin-ghost" data-user-action="enable">Enable</button>`
              : `<button class="btn-admin-ghost" data-user-action="disable" ${isSuper ? 'disabled' : ''}>Disable</button>`}
            <button class="btn-admin-ghost" data-user-action="delete" ${(isSuper || isMe) ? 'disabled' : ''}>Delete</button>
          </td>
        </tr>`;
      }).join('');
    }

    document.querySelectorAll('[data-user-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const email = btn.closest('tr').dataset.email;
        const action = btn.dataset.userAction;
        try {
          if (action === 'delete') {
            if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
            await api(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
            toast('User removed.');
          } else if (action === 'reset-password') {
            if (!confirm(`Reset password for ${email}? They will set a new one on next sign-in.`)) return;
            await api(`/api/admin/users/${encodeURIComponent(email)}/reset-password`, { method: 'POST' });
            toast('Password reset. They will create a new one on next login.');
          } else {
            await api(`/api/admin/users/${encodeURIComponent(email)}/${action}`, { method: 'POST' });
            toast(action === 'approve' ? 'Approved.' : action === 'disable' ? 'Disabled.' : action === 'enable' ? 'Enabled.' : 'Done.');
          }
          await loadUsers();
        } catch (err) { toast('Action failed: ' + (err.message || ''), true); }
      });
    });
  }

  async function loadUsers() {
    if (me?.role !== 'super') return;
    try {
      users = await api('/api/admin/users');
      renderUsers();
    } catch (err) {
      console.error(err);
      $('#users-pending-tbody').innerHTML = `<tr><td colspan="4" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load users.</td></tr>`;
    }
  }

  $('#new-user-btn').addEventListener('click', async () => {
    const email = prompt('Email of user to invite:');
    if (!email) return;
    const role = confirm('Make this user a SUPER admin? (Cancel = regular admin)') ? 'super' : 'admin';
    try {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), role }) });
      toast('User invited. They can sign in and set a password.');
      await loadUsers();
    } catch (err) { toast('Invite failed: ' + (err.message || ''), true); }
  });

  // ── categories ─────────────────────────────────────────
  function slugify(s) {
    return (s || '')
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function populateCategoryDropdowns() {
    const active = categories.filter((c) => !c.archived);
    document.querySelectorAll('select[data-dynamic-categories="form"]').forEach((sel) => {
      const current = sel.value;
      sel.innerHTML = active.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
      if (current && active.some((c) => c.id === current)) sel.value = current;
    });
    document.querySelectorAll('select[data-dynamic-categories="filter"]').forEach((sel) => {
      const current = sel.value || 'all';
      sel.innerHTML = `<option value="all">All categories</option>` +
        active.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
      sel.value = current && (current === 'all' || active.some((c) => c.id === current)) ? current : 'all';
    });
  }

  async function loadCategories() {
    try {
      categories = await api('/api/admin/categories');
      categories.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));
      renderCategories();
      populateCategoryDropdowns();
    } catch (err) {
      console.error(err);
      const tb = $('#categories-tbody');
      if (tb) tb.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load categories.</td></tr>`;
    }
  }

  function renderCategories() {
    const tb = $('#categories-tbody');
    if (!tb) return;
    if (!categories.length) {
      tb.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No categories yet.</td></tr>`;
      return;
    }
    tb.innerHTML = categories.map((c) => `
      <tr data-id="${c.id}">
        <td><span class="admin-row-clickable" data-action="edit-cat">${c.name}</span></td>
        <td><code style="font-size:.85em;">${c.slug || c.id}</code></td>
        <td>${c.sort_order ?? 100}</td>
        <td>${c.archived ? '<span class="badge badge-archived">Archived</span>' : '<span class="badge badge-active">Active</span>'}</td>
        <td style="text-align:right;">
          <button class="btn-admin-ghost" data-action="edit-cat">Edit</button>
          <button class="btn-admin-ghost" data-action="${c.archived ? 'restore-cat' : 'archive-cat'}">${c.archived ? 'Restore' : 'Archive'}</button>
        </td>
      </tr>
    `).join('');
    tb.querySelectorAll('[data-action="edit-cat"]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.closest('tr').dataset.id;
        openCategoryDrawer(categories.find((c) => c.id === id));
      });
    });
    tb.querySelectorAll('[data-action="archive-cat"], [data-action="restore-cat"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const cat = categories.find((c) => c.id === id);
        if (!cat) return;
        const archive = btn.dataset.action === 'archive-cat';
        try {
          if (archive) {
            await api(`/api/admin/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
          } else {
            await api(`/api/admin/categories/${encodeURIComponent(id)}`, {
              method: 'PUT',
              body: JSON.stringify({ ...cat, archived: false }),
            });
          }
          toast(archive ? 'Category archived' : 'Category restored');
          await loadCategories();
        } catch (err) { toast('Action failed: ' + (err.message || ''), true); }
      });
    });
  }

  const categoryDrawer = $('#category-drawer');
  const categoryDrawerOverlay = $('#category-drawer-overlay');

  function openCategoryDrawer(cat) {
    editingCategory = cat || null;
    $('#category-drawer-title').textContent = cat ? 'Edit Category' : 'New Category';
    $('#c-id').value = cat?.id || '';
    $('#c-name').value = cat?.name || '';
    $('#c-slug').value = cat?.slug || cat?.id || '';
    $('#c-order').value = cat?.sort_order ?? 100;
    $('#c-archived').checked = !!cat?.archived;
    categoryDrawer.classList.add('open');
    categoryDrawerOverlay.classList.add('open');
    categoryDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeCategoryDrawer() {
    categoryDrawer.classList.remove('open');
    categoryDrawerOverlay.classList.remove('open');
    categoryDrawer.setAttribute('aria-hidden', 'true');
    editingCategory = null;
    markClean('category');
  }
  $('#new-category-btn').addEventListener('click', () => openCategoryDrawer(null));
  $('#category-drawer-close').addEventListener('click', closeCategoryDrawer);
  $('#category-drawer-cancel').addEventListener('click', closeCategoryDrawer);
  categoryDrawerOverlay.addEventListener('click', closeCategoryDrawer);

  $('#category-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#c-name').value.trim();
    if (!name) { toast('Name is required', true); return; }
    const slug = slugify($('#c-slug').value.trim() || name);
    const id = $('#c-id').value || slug;
    const payload = {
      id,
      slug,
      name,
      sort_order: Number($('#c-order').value) || 100,
      archived: $('#c-archived').checked,
    };
    try {
      if (editingCategory) {
        await api(`/api/admin/categories/${encodeURIComponent(editingCategory.id)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/admin/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast('Category saved');
      closeCategoryDrawer();
      await loadCategories();
    } catch (err) {
      toast('Save failed: ' + (err.message || ''), true);
    }
  });

  // ── site media ─────────────────────────────────────────
  async function loadSiteMedia() {
    try {
      siteMedia = await api('/api/admin/site-media');
      renderSiteMedia();
    } catch (err) {
      console.error(err);
      const grid = $('#site-media-grid');
      if (grid) grid.innerHTML = `<div style="padding:var(--space-6);color:var(--color-text-muted);">Could not load site media.</div>`;
    }
  }

  function renderSiteMedia() {
    const grid = $('#site-media-grid');
    if (!grid) return;
    if (!siteMedia.length) {
      grid.innerHTML = `<div style="padding:var(--space-6);color:var(--color-text-muted);">No image slots registered.</div>`;
      return;
    }
    grid.innerHTML = siteMedia.map((s) => `
      <div class="site-media-card" data-slot="${s.slot}">
        <div class="thumb-wrap"><img src="${s.url}" alt="${(s.alt || '').replace(/"/g, '&quot;')}" loading="lazy" /></div>
        <div class="meta">
          <span class="meta-label">${s.label || s.slot}</span>
          <span class="meta-slot">${s.page || ''} &middot; ${s.slot}</span>
          <span class="meta-badge ${s.overridden ? 'overridden' : ''}">${s.overridden ? 'Custom' : 'Default'}</span>
        </div>
      </div>
    `).join('');
    grid.querySelectorAll('.site-media-card').forEach((card) => {
      card.addEventListener('click', () => {
        const slot = card.dataset.slot;
        openSlotDrawer(siteMedia.find((s) => s.slot === slot));
      });
    });
  }

  const slotDrawer = $('#slot-drawer');
  const slotDrawerOverlay = $('#slot-drawer-overlay');

  function openSlotDrawer(slot) {
    editingSlot = slot || null;
    if (!slot) return;
    $('#slot-drawer-title').textContent = 'Edit Image Slot';
    $('#s-slot').value = slot.slot;
    $('#s-label').textContent = `${slot.label || slot.slot} — ${slot.page || ''}`;
    $('#s-preview-img').src = slot.url || '';
    $('#s-preview-img').alt = slot.alt || '';
    $('#s-url').value = slot.overridden ? (slot.url || '') : '';
    $('#s-alt').value = slot.alt || '';
    $('#s-error').textContent = '';
    slotDrawer.classList.add('open');
    slotDrawerOverlay.classList.add('open');
    slotDrawer.setAttribute('aria-hidden', 'false');
  }
  function closeSlotDrawer() {
    slotDrawer.classList.remove('open');
    slotDrawerOverlay.classList.remove('open');
    slotDrawer.setAttribute('aria-hidden', 'true');
    editingSlot = null;
    markClean('slot');
  }
  $('#slot-drawer-close').addEventListener('click', closeSlotDrawer);
  $('#slot-drawer-cancel').addEventListener('click', closeSlotDrawer);
  slotDrawerOverlay.addEventListener('click', closeSlotDrawer);

  $('#s-upload-zone').addEventListener('click', () => $('#s-upload-input').click());
  $('#s-upload-input').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('#s-error').textContent = 'Uploading…';
    try {
      const url = await uploadOne(f);
      if (url) {
        $('#s-url').value = url;
        $('#s-preview-img').src = url;
        $('#s-error').textContent = '';
      } else {
        $('#s-error').textContent = 'Upload failed';
      }
    } catch (err) {
      $('#s-error').textContent = 'Upload failed: ' + (err.message || '');
    } finally {
      e.target.value = '';
    }
  });

  $('#slot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot = $('#s-slot').value;
    const url = $('#s-url').value.trim();
    const alt = $('#s-alt').value.trim();
    if (!slot || !url) { $('#s-error').textContent = 'Image URL is required'; return; }
    try {
      await api(`/api/admin/site-media/${encodeURIComponent(slot)}`, {
        method: 'PUT',
        body: JSON.stringify({ url, alt }),
      });
      toast('Image slot saved');
      closeSlotDrawer();
      await loadSiteMedia();
    } catch (err) {
      $('#s-error').textContent = 'Save failed: ' + (err.message || '');
    }
  });

  $('#slot-reset').addEventListener('click', async () => {
    if (!editingSlot) return;
    if (!confirm('Revert this slot to the default image?')) return;
    try {
      await api(`/api/admin/site-media/${encodeURIComponent(editingSlot.slot)}`, { method: 'DELETE' });
      toast('Slot reverted to default');
      closeSlotDrawer();
      await loadSiteMedia();
    } catch (err) {
      $('#s-error').textContent = 'Revert failed: ' + (err.message || '');
    }
  });

  // ── toast ──────────────────────────────────────────────
  const toastEl = $('#toast');
  function toast(msg, error = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ── boot ────────────────────────────────────────────────
  (async function boot() {
    if (!sessionToken) { window.location.replace('/admin'); return; }
    try {
      me = await api('/api/auth/me');
      if (me) {
        $('#who-am-i').textContent = `${me.email} (${me.role})`;
        const usersNav = document.querySelector('[data-nav-users]');
        if (usersNav) usersNav.hidden = me.role !== 'super';
        const connectNav = document.querySelector('[data-nav-connect]');
        if (connectNav) connectNav.hidden = me.role !== 'super';
      }
      setSection('products');
      // Preload categories so the product editor dropdown is populated
      loadCategories().catch(() => {});
    } catch {
      clearSession();
      window.location.replace('/admin');
    }
  })();
})();
