/* Studio 37 — Admin login page.
   Handles auth forms only. On success, redirects to /admin/dashboard. */
(() => {
  const TOKEN_KEY = 'studio37_session_token';

  async function unauthApi(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const r = await fetch(path, Object.assign({}, opts, { headers }));
    let body = null;
    try { body = await r.json(); } catch { /* ignore */ }
    return { ok: r.ok, status: r.status, body };
  }

  function setSession(token) {
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      const now = String(Date.now());
      sessionStorage.setItem('studio37_login_at', now);
      sessionStorage.setItem('studio37_activity_at', now);
    }
  }

  const $ = (s) => document.querySelector(s);

  function showPanel(name) {
    ['signin', 'setpass', 'request'].forEach((p) => {
      const el = $(`[data-panel="${p}"]`);
      if (el) el.hidden = p !== name;
    });
  }

  // Surface session-expiry reason from query string (set by dashboard forceLogout).
  (() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (!reason) return;
    const msg = reason === 'idle'
      ? 'Signed out due to inactivity. Please sign in again.'
      : reason === 'expired'
        ? 'Your session expired. Please sign in again.'
        : '';
    if (msg) {
      const el = $('#login-error');
      if (el) el.textContent = msg;
    }
    // Strip the query so a reload doesn't re-show it.
    history.replaceState({}, '', '/admin');
  })();

  // ── Already authenticated? Go straight to dashboard. ──
  if (sessionStorage.getItem(TOKEN_KEY)) {
    window.location.replace('/admin/dashboard');
  }

  // ── Login form ─────────────────────────────────────────
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
      setSession(res.body.token);
      window.location.replace('/admin/dashboard');
      return;
    }

    if (res.status === 400 && res.body?.error === 'password_required') {
      $('#login-error').textContent = 'Please enter your password.';
    } else if (res.status === 403 && res.body?.error === 'pending') {
      $('#login-error').textContent = 'Your account is pending approval.';
    } else if (res.status === 403 && res.body?.error === 'disabled') {
      $('#login-error').textContent = 'Account disabled. Contact the site owner.';
    } else {
      $('#login-error').textContent = 'Email or password is incorrect.';
    }
    const card = $('#login-form');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  });

  // ── Set-password form (first login) ────────────────────
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
      setSession(res.body.token);
      window.location.replace('/admin/dashboard');
      return;
    }
    errEl.textContent = res.body?.message || res.body?.error || 'Could not set password. Please sign in again.';
    setTimeout(() => showPanel('signin'), 2000);
  });

  // ── Panel navigation ────────────────────────────────────
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

  // ── Request-access form ─────────────────────────────────
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
})();
