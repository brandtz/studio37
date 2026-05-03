/* Studio 37 — Admin panel: products, media, reviews, leads */
(() => {
  const SESSION_KEY = 'studio37_admin_key';
  let adminKey = sessionStorage.getItem(SESSION_KEY) || '';
  let products = [];
  let reviews = [];
  let editing = null;
  let pendingImages = [];
  let editingReview = null;
  let mediaProductId = '';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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

  function stars(n) {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function statusLabel(s) {
    return ({
      available: 'Available',
      out_of_stock: 'Out of Stock',
      by_request: 'By Request',
      archived: 'Archived',
    })[s] || s;
  }

  function showLogin() {
    $('#view-login').hidden = false;
    $('#view-dashboard').hidden = true;
  }

  function showDashboard() {
    $('#view-login').hidden = true;
    $('#view-dashboard').hidden = false;
    setSection('products');
  }

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

  function setSection(section) {
    const sectionMap = ['products', 'media', 'reviews', 'orders', 'leads'];
    sectionMap.forEach((s) => {
      const el = $(`#section-${s}`);
      if (el) el.hidden = s !== section;
    });

    $$('.admin-nav a').forEach((x) => x.classList.toggle('active', x.dataset.section === section));
    $('#section-title').textContent = ({
      products: 'Products',
      media: 'Media',
      reviews: 'Reviews',
      orders: 'Orders',
      leads: 'Leads',
    })[section] || 'Admin';

    $('#new-product-btn').hidden = section !== 'products';
    $('#new-review-btn').hidden = section !== 'reviews';

    if (section === 'products') loadProducts();
    if (section === 'media') loadProducts();
    if (section === 'reviews') loadReviews();
    if (section === 'leads') loadLeads();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#adminKey').value.trim();
    if (!key) return;
    adminKey = key;
    try {
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

  $$('.admin-nav a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      setSection(a.dataset.section);
    });
  });

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
        } catch (err) {
          toast('Archive failed: ' + (err.message || ''), true);
        }
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
        } catch (err) {
          toast('Restore failed: ' + (err.message || ''), true);
        }
      });
    });
  }

  function populateMediaProductSelect() {
    const sel = $('#media-product-select');
    const prev = mediaProductId;
    sel.innerHTML = '<option value="">Select a product</option>' + products
      .filter((p) => p.status !== 'archived')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => `<option value="${p.id}">${p.name}</option>`)
      .join('');

    if (products.some((p) => p.id === prev)) {
      sel.value = prev;
    }
    renderMediaThumbs();
  }

  async function loadProducts() {
    try {
      products = await api('/api/admin/products');
      renderProducts();
      populateMediaProductSelect();
    } catch (err) {
      console.error(err);
    }
  }

  ['#search', '#status-filter', '#category-filter'].forEach((s) => {
    const el = $(s);
    if (el) el.addEventListener('input', renderProducts);
  });

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
  upZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'INPUT') upInput.click();
  });

  upInput.addEventListener('change', async () => {
    const files = Array.from(upInput.files);
    for (const f of files) {
      try {
        const url = await uploadOne(f);
        if (url) pendingImages.push(url);
      } catch (err) {
        toast('Upload failed: ' + (err.message || ''), true);
      }
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
      await api(path, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify(body),
      });
      toast(isNew ? 'Product created.' : 'Product saved.');
      closeProductDrawer();
      await loadProducts();
    } catch (err) {
      toast('Save failed: ' + (err.message || ''), true);
    }
  });

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
        } catch (err) {
          toast('Could not remove photo.', true);
        }
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
      } catch (err) {
        toast('One upload failed: ' + (err.message || ''), true);
      }
    }
    $('#media-upload-input').value = '';
    if (!uploaded.length) return;

    try {
      await saveProduct({ ...p, images: [...(p.images || []), ...uploaded] });
      toast('Photos added.');
      await loadProducts();
      $('#media-product-select').value = mediaProductId;
    } catch (err) {
      toast('Could not save photos.', true);
    }
  });

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
        } catch (err) {
          toast('Could not update review.', true);
        }
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
        } catch (err) {
          toast('Could not delete review.', true);
        }
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
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await api('/api/admin/reviews', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      toast(editingReview ? 'Review saved.' : 'Review created.');
      closeReviewDrawer();
      await loadReviews();
    } catch (err) {
      toast('Save failed: ' + (err.message || ''), true);
    }
  });

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

  const toastEl = $('#toast');
  function toast(msg, error = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', error);
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  if (adminKey) showDashboard();
  else showLogin();
})();
