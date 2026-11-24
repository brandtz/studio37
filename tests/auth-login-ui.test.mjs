import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../src/assets/js/admin-login.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../src/admin/index.html', import.meta.url), 'utf8');
function page({ hash = '', session = '', response = { status: 202, body: { message: 'Check your inbox.' } }, offline = false } = {}) {
  const elements = new Map();
  const panels = new Map();
  const calls = [];
  const history = [];
  const redirects = [];
  const storage = new Map(session ? [['studio37_session_token', session]] : []);
  function element() {
    return {
      value: '', textContent: '', hidden: false, disabled: false, dataset: {},
      handlers: {}, classList: { add() {}, remove() {} },
      addEventListener(name, callback) { this.handlers[name] = callback; },
      async fire(name) { await this.handlers[name]({ preventDefault() {} }); },
    };
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(`#${match[1]}`, element());
  for (const match of html.matchAll(/<form[^>]*\bid="([^"]+)"[^>]*data-panel="([^"]+)"[^>]*>/g)) {
    const el = elements.get(`#${match[1]}`);
    el.hidden = match[0].includes('hidden');
    panels.set(match[2], el);
  }
  for (const id of ['setpass-form', 'setup-request-form']) elements.set(`#${id} button[type="submit"]`, element());
  const back = [...html.matchAll(/data-back-signin/g)].map(() => element());
  const context = {
    URLSearchParams, TextEncoder, Date,
    document: {
      querySelector(selector) {
        const panel = selector.match(/^\[data-panel="([^"]+)"\]$/);
        const el = panel ? panels.get(panel[1]) : elements.get(selector);
        assert.ok(el, `Missing HTML selector: ${selector}`);
        return el;
      },
      querySelectorAll: () => back,
    },
    window: { location: { hash, pathname: '/admin', search: '', replace: (url) => redirects.push(url) } },
    history: { replaceState: (_state, _title, url) => history.push(url) },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (path, options) => {
      calls.push({ path, options });
      if (offline) throw new Error('offline');
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  };
  runInNewContext(script, context);
  return { elements, panels, calls, history, redirects, storage, back };
}

test('login UI requires an inbox link, strips its fragment, and never stores it in DOM/session storage', async () => {
  const token = 'test.claims.signature';
  const p = page({ hash: `#setup=${token}`, session: 'existing-session', response: { status: 200, body: { token: 'new-session' } } });
  assert.deepEqual(p.history, ['/admin']);
  assert.equal(p.panels.get('setpass').hidden, false);
  assert.equal(p.panels.get('signin').hidden, true);
  assert.deepEqual(p.redirects, []);
  for (const el of p.elements.values()) assert.deepEqual(el.dataset, {});
  assert.ok(![...p.storage.values()].includes(token));
  p.elements.get('#setpass1').value = 'my new password';
  p.elements.get('#setpass2').value = 'my new password';
  await p.elements.get('#setpass-form').fire('submit');
  assert.equal(p.calls[0].path, '/api/auth/set-password');
  assert.deepEqual(JSON.parse(p.calls[0].options.body), { setupToken: token, password: 'my new password' });
  assert.equal(p.calls[0].options.cache, 'no-store');
  assert.equal(p.calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(p.storage.get('studio37_session_token'), 'new-session');
  assert.equal(p.elements.get('#setpass1').value, '');
  assert.deepEqual(p.redirects, ['/admin/dashboard']);
});

test('users can request an initial link without supplying a password', async () => {
  const p = page();
  p.elements.get('#loginEmail').value = 'Approved@Example.test';
  await p.elements.get('#show-password-setup').fire('click');
  assert.equal(p.panels.get('setup-request').hidden, false);
  assert.equal(p.elements.get('#setupEmail').value, 'Approved@Example.test');
  await p.elements.get('#setup-request-form').fire('submit');
  assert.equal(p.calls[0].path, '/.netlify/functions/auth-request-password-setup');
  assert.deepEqual(JSON.parse(p.calls[0].options.body), { email: 'approved@example.test' });
  assert.equal(p.elements.get('#setup-request-message').textContent, 'Check your inbox.');
  assert.equal(p.elements.get('#setup-request-form button[type="submit"]').disabled, false);
});

test('legacy login firstLogin response cannot open password setup or issue a session', async () => {
  const p = page({ response: { status: 200, body: { firstLogin: true, setupToken: 'unsafe-old-token', email: 'approved@example.test' } } });
  p.elements.get('#loginEmail').value = 'approved@example.test';
  p.elements.get('#loginPassword').value = 'attacker value';
  await p.elements.get('#login-form').fire('submit');
  assert.equal(p.panels.get('setpass').hidden, true);
  assert.deepEqual(p.redirects, []);
  assert.equal(p.storage.size, 0);
  await p.elements.get('#setpass-form').fire('submit');
  assert.equal(p.calls.length, 1);
  assert.match(p.elements.get('#setpass-error').textContent, /emailed setup link/);
});

test('expired link remains actionable; a new request clears credential and password fields', async () => {
  const p = page({ hash: '#setup=test.claims.signature', response: { status: 401, body: { error: 'invalid_or_expired_token' } } });
  p.elements.get('#setpass1').value = 'my new password';
  p.elements.get('#setpass2').value = 'my new password';
  await p.elements.get('#setpass-form').fire('submit');
  assert.equal(p.panels.get('setpass').hidden, false);
  assert.match(p.elements.get('#setpass-error').textContent, /request a new link/i);
  await p.elements.get('#request-new-setup').fire('click');
  assert.equal(p.panels.get('setup-request').hidden, false);
  assert.equal(p.elements.get('#setpass1').value, '');
  assert.equal(p.elements.get('#setpass2').value, '');
});

test('malformed fragments and network failures do not leave forms stuck or expose tokens', async () => {
  const invalid = page({ hash: '#setup=invalid' });
  assert.deepEqual(invalid.history, ['/admin']);
  assert.match(invalid.elements.get('#setpass-error').textContent, /invalid/);
  const offline = page({ offline: true });
  await offline.elements.get('#show-password-setup').fire('click');
  offline.elements.get('#setupEmail').value = 'approved@example.test';
  await offline.elements.get('#setup-request-form').fire('submit');
  assert.match(offline.elements.get('#setup-request-message').textContent, /Connection failed/);
  assert.equal(offline.elements.get('#setup-request-form button[type="submit"]').disabled, false);
});

test('normal stored sessions still redirect, but setup links take precedence', () => {
  const p = page({ session: 'existing-session' });
  assert.deepEqual(p.redirects, ['/admin/dashboard']);
});

test('login surfaces revocation-storage outages without misreporting a wrong password', async () => {
  const p = page({ response: { status: 503, body: { message: 'Sign-in is unavailable. Try again later or contact the site owner.' } } });
  p.elements.get('#loginEmail').value = 'approved@example.test';
  p.elements.get('#loginPassword').value = 'my correct password';
  await p.elements.get('#login-form').fire('submit');
  assert.match(p.elements.get('#login-error').textContent, /Sign-in is unavailable/);
  assert.equal(p.storage.size, 0);
});
