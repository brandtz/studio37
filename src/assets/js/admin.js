/* Studio 37 — Admin panel: login, product CRUD, image upload, leads view */
(() => {
  const SESSION_KEY = 'studio37_admin_key';
  let adminKey = sessionStorage.getItem(SESSION_KEY) || '';
  let products = [];
  let editing = null; // current product being edited (null => create)
  let pendingImages = []; // urls captured during this edit session

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ── API helpers ────────────────────────────────────────
  async function api(path, opts = {}) {
    const headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {},
      { 'X-Admin-Key': adminKey },
    );
    if (opts.body instanceof FormData) delete headers['Content-Type'];
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    if (r.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      adminKey = '';
      showLogin();
      throw new Error('Unauthorized');
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.status === 204 ? null : r.json();
  }

  // ── Views ──────────────────────────────────────────────
  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-dashboard').hidden = true;
  }
  function showDashboard() {
    $('#view-login').hidden = true;
    $('#view-dashboard').hidden = false;
    loadProducts();
  }

  // ── Login ──────────────────────────────────────────────
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#adminKey').value.trim();
    if (!key) return;
    adminKey = key;
    try {
      // Validate by attempting to load products
      const r = await fetch('/api/admin/products', { headers: { 'X-Admin-Key': key } });
      if (r.status === 401) throw new Error('bad key');
      if (!r.ok) throw new Error('server');
      sessionStorage.setItem(SESSION_KEY, key);
      $('#login-error').textContent = '';
      showDashboard();
    } catch (err) {
      $('#login-error').textContent = 'Incorrect password.';
      const card = $('.admin-login-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      adminKey = '';
    }
  });

  $('#logout').addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem(SESSION_KEY);
    adminKey = '';
    showLogin();
  });

  // ── Section switching ──────────────────────────────────
  $$('.admin-nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      $$('.admin-nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      const sec = a.dataset.section;
      $('#section-title').textContent = a.textContent.trim();
      ['products', 'orders', 'leads'].forEach((s) => {
        $(`#section-${s}`).hidden = s !== sec;
      });
      if (sec === 'leads') loadLeads();
    });
  });

  // ── Products ───────────────────────────────────────────
  function fmtMoney(cents) {
    if (cents == null) return '—';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  function statusLabel(s) {
    return ({
      available: 'Available',
      out_of_stock: 'Out of Stock',
      by_request: 'By Request',
      archived: 'Archived',
    })[s] || s;
  }

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
        <td>
          <img class="admin-table-thumb" src="${p.images?.[0] || '/assets/images/logo.png'}" alt="" />
        </td>
        <td>
          <span class="admin-table-name">${p.name}</span>
          ${p.subtitle ? `<span class="admin-table-sub">${p.subtitle}</span>` : ''}
        </td>
        <td><span class="admin-table-price">${fmtMoney(p.price)}</span></td>
        <td>
          <span class="admin-status-dot admin-status-${p.status}"></span>
          ${statusLabel(p.status)}
        </td>
        <td style="text-align:right;">
          <button class="btn-admin-ghost" data-action="edit">Edit</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-action="edit"]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.closest('tr').dataset.id;
        openDrawer(products.find((p) => p.id === id));
      });
    });
  }

  async function loadProducts() {
    try {
      products = await api('/api/admin/products');
      renderProducts();
    } catch (err) {
      console.error(err);
    }
  }

  ['#search', '#status-filter', '#category-filter'].forEach((s) => {
    $(s).addEventListener('input', renderProducts);
  });

  // ── Drawer ─────────────────────────────────────────────
  const drawer = $('#drawer');
  const drawerOverlay = $('#drawer-overlay');

  function openDrawer(product) {
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

    renderThumbs();

    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    editing = null;
    pendingImages = [];
  }

  $('#new-product-btn').addEventListener('click', () => openDrawer(null));
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-cancel').addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  function renderThumbs() {
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
        renderThumbs();
      });
    });
  }

  // Image upload
  const upZone = $('#f-upload-zone');
  const upInput = $('#f-photos');
  upZone.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') upInput.click(); });
  upInput.addEventListener('change', async () => {
    const files = Array.from(upInput.files);
    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await api('/api/admin/upload', { method: 'POST', body: fd });
        if (res?.url) pendingImages.push(res.url);
      } catch (err) {
        toast('Upload failed: ' + (err.message || ''), true);
      }
    }
    upInput.value = '';
    renderThumbs();
  });

  // Save
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
      await api(path, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      toast(isNew ? 'Product created.' : 'Product saved.');
      closeDrawer();
      loadProducts();
    } catch (err) {
      toast('Save failed: ' + (err.message || ''), true);
    }
  });

  function slugify(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  // ── Leads ──────────────────────────────────────────────
  async function loadLeads() {
    try {
      const leads = await api('/api/admin/products?leads=1').catch(() => []);
      // NOTE: leads endpoint is not yet implemented; placeholder rendering.
      const tbody = $('#leads-tbody');
      if (!Array.isArray(leads) || !leads.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-7);text-align:center;color:var(--color-text-muted);">No leads yet (or endpoint not yet wired).</td></tr>`;
        return;
      }
      tbody.innerHTML = leads.map((l) => `
        <tr>
          <td>${new Date(l.created_at).toLocaleString()}</td>
          <td>${l.firstName} ${l.lastName}</td>
          <td>${l.service}</td>
          <td>${l.phone}</td>
          <td>${l.email}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error(err);
    }
  }

  // ── Toast ──────────────────────────────────────────────
  const toastEl = $('#toast');
  function toast(msg, error = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ── Boot ───────────────────────────────────────────────
  if (adminKey) showDashboard();
  else showLogin();
})();
