/* Studio 37 — Admin login page.
   Handles auth forms only. On success, redirects to /admin/dashboard. */
(() => {
  const TOKEN_KEY = 'studio37_session_token';
  // Keep the email credential only in this closure, never storage or DOM attributes.
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const hasSetupLink = fragment.has('setup');
  let setupToken = fragment.get('setup') || '';
  if (window.location.hash) {
    history.replaceState({}, '', window.location.pathname + window.location.search);
  }
  if (setupToken.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(setupToken)) setupToken = '';

  async function unauthApi(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    try {
      const r = await fetch(path, Object.assign({}, opts, { headers, cache: 'no-store', referrerPolicy: 'no-referrer' }));
      let body = null;
      try { body = await r.json(); } catch { /* ignore */ }
      return { ok: r.ok, status: r.status, body };
    } catch {
      return { ok: false, status: 0, body: { message: 'Connection failed. Please try again.' } };
    }
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
    ['signin', 'setpass', 'request', 'setup-request'].forEach((p) => {
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
  if (hasSetupLink) {
    showPanel('setpass');
    if (!setupToken) $('#setpass-error').textContent = 'This setup link is invalid. Request a new link below.';
  } else if (sessionStorage.getItem(TOKEN_KEY)) {
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

    if (res.ok && res.body?.token) {
      setSession(res.body.token);
      window.location.replace('/admin/dashboard');
      return;
    }

    if (res.status === 0 || res.status === 429 || res.status === 503) {
      $('#login-error').textContent = res.body?.message || 'Too many attempts. Please try again later.';
    } else if (res.status === 400 && res.body?.error === 'password_required') {
      $('#login-error').textContent = 'Please enter your password.';
    } else if (res.status === 403 && res.body?.error === 'pending') {
      $('#login-error').textContent = 'Your account is pending approval.';
    } else if (res.status === 403 && res.body?.error === 'disabled') {
      $('#login-error').textContent = 'Account disabled. Contact the site owner.';
    } else {
      $('#login-error').textContent = 'Email or password is incorrect. If you have not set a password, request an emailed setup link below.';
    }
    const card = $('#login-form');
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
  });

  // ── Set-password form (email link only) ────────────────
  $('#setpass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('#setpass1').value;
    const p2 = $('#setpass2').value;
    const errEl = $('#setpass-error');
    errEl.textContent = '';

    if (!setupToken) { errEl.textContent = 'Open your emailed setup link, or request a new one below.'; return; }
    if (p1.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
    if (new TextEncoder().encode(p1).length > 72) { errEl.textContent = 'Password must be at most 72 UTF-8 bytes.'; return; }
    if (p1 !== p2)    { errEl.textContent = 'Passwords do not match.'; return; }

    const button = $('#setpass-form button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    const res = await unauthApi('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify({ setupToken, password: p1 }),
    });
    button.disabled = false;

    if (res.ok && res.body?.token) {
      setupToken = '';
      $('#setpass1').value = '';
      $('#setpass2').value = '';
      setSession(res.body.token);
      window.location.replace('/admin/dashboard');
      return;
    }
    if (res.status === 401 || res.status === 409) {
      setupToken = '';
      errEl.textContent = 'This link is invalid, expired, or already used. Sign in if setup is complete, or request a new link below.';
    } else {
      errEl.textContent = res.body?.message || 'Could not complete setup. Try signing in or request a new link.';
    }
  });

  // ── Panel navigation ────────────────────────────────────
  function requestSetup(e) {
    e.preventDefault();
    setupToken = '';
    $('#setpass1').value = '';
    $('#setpass2').value = '';
    $('#setupEmail').value = $('#loginEmail').value;
    $('#setup-request-message').textContent = '';
    showPanel('setup-request');
  }
  $('#show-password-setup').addEventListener('click', requestSetup);
  $('#request-new-setup').addEventListener('click', requestSetup);
  document.querySelectorAll('[data-back-signin]').forEach((link) => link.addEventListener('click', (e) => {
    e.preventDefault();
    setupToken = '';
    $('#setpass1').value = '';
    $('#setpass2').value = '';
    showPanel('signin');
  }));

  $('#setup-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#setup-request-form button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    $('#setup-request-message').textContent = 'Requesting setup link…';
    // Use the native function route; no new redirect/configuration is required.
    const res = await unauthApi('/.netlify/functions/auth-request-password-setup', {
      method: 'POST',
      body: JSON.stringify({ email: $('#setupEmail').value.trim().toLowerCase() }),
    });
    button.disabled = false;
    $('#setup-request-message').textContent = res.body?.message || 'Could not request a link. Please try again later.';
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
