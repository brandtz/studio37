/* Studio 37 — Admin panel: products, media, reviews, leads, users.
   Auth: Bearer JWT in sessionStorage (issued by /api/auth/login). */
(() => {
  const TOKEN_KEY = 'studio37_session_token';
  let sessionToken = sessionStorage.getItem(TOKEN_KEY) || '';
  let me = null; // { email, role }

  let products = [];
  let reviews = [];
  let users = [];
  let editing = null;
  let pendingImages = [];
  let editingReview = null;
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
      showLogin();
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

  async function unauthApi(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    let body = null;
    try { body = await r.json(); } catch { /* ignore */ }
    return { ok: r.ok, status: r.status, body };
  }

  // ── session helpers ────────────────────────────────────
  function setSession(token, user) {
    sessionToken = token;
    me = user || null;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearSession() {
    sessionToken = '';
    me = null;
    sessionStorage.removeItem(TOKEN_KEY);
  }

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

  // ── view switchers ─────────────────────────────────────
  function showPanel(name) {
    ['signin', 'setpass', 'request'].forEach((p) => {
      const el = document.querySelector(`[data-panel="${p}"]`);
      if (el) el.hidden = p !== name;
    });
  }

  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-dashboard').hidden = true;
    showPanel('signin');
  }

  function showDashboard() {
    $('#view-login').hidden = true;
    $('#view-dashboard').hidden = false;
    if (me) {
      $('#who-am-i').textContent = `${me.email} (${me.role})`;
      const usersNav = document.querySelector('[data-nav-users]');
      if (usersNav) usersNav.hidden = me.role !== 'super';
      const connectNav = document.querySelector('[data-nav-connect]');
      if (connectNav) connectNav.hidden = me.role !== 'super';
    }
    setSection('products');
  }

  // ── auth flow ──────────────────────────────────────────
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    $('#login-error').textContent = '';

    const res = await unauthApi('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (res.ok && res.body?.firstLogin) {
      // Move to set-password panel.
      $('#setpass-email').textContent = res.body.email;
      $('#setpass-form').dataset.setupToken = res.body.setupToken;
      $('#setpass-form').dataset.email = res.body.email;
      $('#setpass1').value = '';
      $('#setpass2').value = '';
      $('#setpass-error').textContent = '';
      showPanel('setpass');
      return;
    }

    if (res.ok && res.body?.token) {
      setSession(res.body.token, res.body.user);
      $('#login-error').textContent = '';
      showDashboard();
      return;
    }

    if (res.status === 403 && res.body?.error === 'pending') {
      $('#login-error').textContent = 'Your account is pending approval.';
    } else if (res.status === 403 && res.body?.error === 'disabled') {
      $('#login-error').textContent = 'Account disabled. Contact Drew.';
    } else {
      $('#login-error').textContent = 'Email or password is incorrect.';
    }
    const card = $('#login-form');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  });

  $('#setpass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const setupToken = $('#setpass-form').dataset.setupToken;
    const p1 = $('#setpass1').value;
    const p2 = $('#setpass2').value;
    const errEl = $('#setpass-error');
    errEl.textContent = '';

    if (p1.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
    if (p1 !== p2)    { errEl.textContent = 'Passwords do not match.'; return; }

    const res = await unauthApi('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ setupToken, password: p1 }),
    });

    if (res.ok && res.body?.token) {
      setSession(res.body.token, res.body.user);
      showDashboard();
      return;
    }
    errEl.textContent = res.body?.message || res.body?.error || 'Could not set password. Please sign in again.';
    setTimeout(() => showPanel('signin'), 2000);
  });

  $('#show-request-access').addEventListener('click', (e) => {
    e.preventDefault();
    $('#request-error').textContent = '';
    $('#request-success').hidden = true;
    showPanel('request');
  });

  $('#show-signin').addEventListener('click', (e) => {
    e.preventDefault();
    showPanel('signin');
  });

  $('#request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#reqEmail').value.trim().toLowerCase();
    const name = $('#reqName').value.trim();
    const message = $('#reqMessage').value.trim();
    $('#request-error').textContent = '';
    $('#request-success').hidden = true;

    const res = await unauthApi('/api/auth/request-access', {
      method: 'POST',
      body: JSON.stringify({ email, name, message }),
    });
    if (res.ok) {
      $('#request-success').hidden = false;
      $('#request-success').textContent = 'Request received. You will be notified once approved.';
      $('#reqEmail').value = ''; $('#reqName').value = ''; $('#reqMessage').value = '';
    } else {
      $('#request-error').textContent = res.body?.message || res.body?.error || 'Could not submit request.';
    }
  });

  $('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    clearSession();
    showLogin();
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
    const sectionMap = ['products', 'media', 'reviews', 'orders', 'leads', 'users', 'connect'];
    sectionMap.forEach((s) => {
      const el = $(`#section-${s}`);
      if (el) el.hidden = s !== section;
    });

    $$('.admin-nav a').forEach((x) => x.classList.toggle('active', x.dataset.section === section));
    $('#section-title').textContent = ({
      products: 'Products', media: 'Media', reviews: 'Reviews',
      orders: 'Orders', leads: 'Leads', users: 'Users', connect: 'Payments',
    })[section] || 'Admin';

    $('#new-product-btn').hidden = section !== 'products';
    $('#new-review-btn').hidden = section !== 'reviews';
    $('#new-user-btn').hidden = section !== 'users';

    if (section === 'products') loadProducts();
    if (section === 'media')    loadProducts();
    if (section === 'reviews')  loadReviews();
    if (section === 'orders')   loadOrders();
    if (section === 'leads')    loadLeads();
    if (section === 'users')    loadUsers();
    if (section === 'connect')  loadConnect();
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
        <td><img class="admin-table-thumb" src="${p.images?.[0] || '/assets/images/logo.png'}" alt="" /></td>
        <td>
          <span class="admin-table-name">${p.name}</span>
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

    tbody.querySelectorAll('button[data-action="edit"]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.closest('tr').dataset.id;
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
    $('#f-category').value = product?.category || 'small-goods';
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
  async function loadOrders() {
    const tbody = $('#orders-tbody');
    if (!tbody) return;
    try {
      const orders = await api('/api/admin/orders');
      if (!Array.isArray(orders) || !orders.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No orders yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = orders.map((o) => {
        const when = o.created_at ? new Date(o.created_at).toLocaleString() : '—';
        const customer = o.customer_email
          ? `<a href="mailto:${escapeHtml(o.customer_email)}" style="color:var(--color-accent);">${escapeHtml(o.customer_email)}</a>`
          : (o.customer_name ? escapeHtml(o.customer_name) : '—');
        const items = Array.isArray(o.items) && o.items.length
          ? o.items.map((i) => `${escapeHtml(i.name || i.id)} ×${i.quantity || 1}`).join('<br/>')
          : '—';
        const total = typeof o.amount_total === 'number' ? '$' + (o.amount_total / 100).toFixed(2) : '—';
        const status = escapeHtml(o.status || 'paid');
        const stripeLink = o.checkout_session_id
          ? `<a href="https://dashboard.stripe.com/payments/${escapeHtml(o.payment_intent_id || '')}" target="_blank" rel="noopener" style="color:var(--color-accent);">Open &rarr;</a>`
          : '—';
        return `
          <tr>
            <td>${when}</td>
            <td>${customer}</td>
            <td>${items}</td>
            <td>${total}</td>
            <td>${status}</td>
            <td style="text-align:right;">${stripeLink}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<tr><td colspan="6" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">Could not load orders.</td></tr>`;
    }
  }

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

  // ── toast ──────────────────────────────────────────────
  const toastEl = $('#toast');
  function toast(msg, error = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ── boot ───────────────────────────────────────────────
  (async function boot() {
    if (!sessionToken) { showLogin(); return; }
    try {
      me = await api('/api/auth/me');
      showDashboard();
    } catch {
      showLogin();
    }
  })();
})();
