// Run: node --experimental-test-module-mocks --test tests/auth-password-setup.test.mjs
// All storage and Resend calls are mocked; these tests never access Netlify or send mail.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';

const users = new Map();
const setup = new Map();
const rate = new Map();
const sent = [];
let failure = '';
let mailFailure = '';
let beforeDelete = null;
let afterUserWrite = null;
const clone = (value) => value == null ? null : structuredClone(value);
const store = (map, name) => ({
  get: async (key) => {
    if (failure === `${name}:get`) throw new Error('private provider failure');
    return clone(map.get(key));
  },
  setJSON: async (key, value) => {
    if (failure === `${name}:set`) throw new Error('private provider failure');
    map.set(key, clone(value));
    if (name === 'users' && afterUserWrite) afterUserWrite(key);
  },
  delete: async (key) => {
    if (failure === `${name}:delete`) throw new Error('private provider failure');
    if (beforeDelete) beforeDelete();
    map.delete(key);
  },
  list: async () => ({ blobs: [...map.keys()].map((key) => ({ key })) }),
});
mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    userStore: () => store(users, 'users'),
    rateLimitStore: () => store(rate, 'rate'),
    ensureUserSeeded: async () => {},
    nowIso: () => new Date().toISOString(),
    json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
  },
});
mock.module('@netlify/blobs', {
  namedExports: {
    getStore: (options) => {
      assert.equal(options.name, 'auth_password_setup_v2');
      assert.equal(options.consistency, 'strong');
      return store(setup, 'setup');
    },
  },
});
mock.module('resend', {
  namedExports: { Resend: class {
    emails = { send: async (message) => {
      sent.push(clone(message));
      if (mailFailure === 'throw') throw new Error('private Resend failure');
      if (mailFailure === 'error') return { error: { message: 'private Resend failure' } };
      if (mailFailure === 'missing-id') return { data: {} };
      return { data: { id: 'mock-delivery' } };
    } };
  } },
});

const auth = await import('../src/netlify/functions/_lib/auth.mjs');
const login = (await import('../src/netlify/functions/auth-login.mjs')).default;
const requestSetup = (await import('../src/netlify/functions/auth-request-password-setup.mjs')).default;
const setPassword = (await import('../src/netlify/functions/auth-set-password.mjs')).default;
const changePassword = (await import('../src/netlify/functions/auth-change-password.mjs')).default;
const adminUsers = (await import('../src/netlify/functions/admin-users.mjs')).default;
const logout = (await import('../src/netlify/functions/auth-logout.mjs')).default;
const email = 'approved@example.test';
const password = 'correct horse battery';
const secret = 'test-only-auth-secret-not-for-production';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const accountKey = `account/${sha(email)}`;
const approved = () => ({
  email, role: 'admin', status: 'approved', passwordHash: null, passwordSet: false,
  created_at: '2026-01-01T00:00:00Z', approved_at: '2026-01-02T00:00:00Z', last_login: null,
});
function reset() {
  users.clear(); setup.clear(); rate.clear(); sent.length = 0;
  failure = ''; mailFailure = ''; beforeDelete = null; afterUserWrite = null;
  users.set(email, approved());
  process.env.JWT_SECRET = secret;
  process.env.RESEND_API_KEY = 'mock-only';
}
function request(body, ip = '192.0.2.1', method = 'POST') {
  return new Request('https://attacker.example.test/api/auth', {
    method,
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip, 'x-forwarded-host': 'attacker.example.test' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}
async function emailedToken() {
  const response = await requestSetup(request({ email: ` ${email.toUpperCase()} `, redirect: 'https://attacker.example.test', to: 'attacker@example.test' }));
  assert.equal(response.status, 202);
  const text = await response.text();
  assert.ok(!text.includes('setupToken') && !text.includes(secret));
  const link = new URL(sent.at(-1).text.match(/https:\/\/\S+/)[0]);
  assert.equal(link.origin, 'https://studio37customdesigns.com');
  assert.equal(link.pathname, '/admin');
  assert.equal(link.search, '');
  return new URLSearchParams(link.hash.slice(1)).get('setup');
}
function sessionRequest(token, body = {}) {
  const req = request(body);
  req.headers.set('authorization', `Bearer ${token}`);
  return req;
}
async function adminRequest(action, body = {}, method = 'POST') {
  const operatorEmail = 'operator@example.test';
  if (!users.has(operatorEmail)) users.set(operatorEmail, {
    ...approved(), email: operatorEmail, role: 'super', passwordSet: true, passwordHash: 'mock-operator-hash',
  });
  const operator = await auth.signSession(users.get(operatorEmail));
  const query = action ? `?email=${encodeURIComponent(email)}&action=${action}` : '';
  return new Request(`https://example.test/api/admin/users${query}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${operator}` },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

test('email-ownership verified initial password setup', async (t) => {
  const savedEnv = Object.fromEntries(['JWT_SECRET', 'RESEND_API_KEY', 'RESEND_FROM'].map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    mock.restoreAll();
  });

  await t.test('an attacker submitting any password gets neither setup credential nor session', async () => {
    reset();
    for (const submitted of ['', 'attacker guessed value', password]) {
      const response = await login(request({ email, password: submitted }));
      assert.ok([400, 401].includes(response.status));
      const body = await response.json();
      assert.equal(body.setupToken, undefined);
      assert.equal(body.token, undefined);
      assert.equal(body.firstLogin, undefined);
    }
    assert.equal(setup.size, 0);
    assert.equal(sent.length, 0);
    const response = await requestSetup(request({ email }));
    const body = await response.json();
    assert.equal(body.setupToken, undefined);
    assert.equal(body.token, undefined);
    assert.equal((await setPassword(request({ setupToken: 'guessed', password }))).status, 401);
    assert.equal(users.get(email).passwordHash, null);
  });

  await t.test('legitimate inbox owner sets a password, logs in, and cannot reuse the link', async () => {
    reset();
    const token = await emailedToken();
    assert.deepEqual(sent[0].to, [email]);
    assert.equal(sent[0].cc, undefined);
    assert.equal(sent[0].bcc, undefined);
    assert.equal(sent[0].html, undefined);
    const record = setup.get(accountKey);
    assert.equal(record.digest, sha(token));
    assert.ok(!JSON.stringify([...setup.values()]).includes(token));
    assert.deepEqual(users.get(email), approved());
    const response = await setPassword(request({ setupToken: token, password }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.ok(body.token);
    assert.equal(await auth.verifyPassword(password, users.get(email).passwordHash), true);
    assert.equal(setup.has(accountKey), false);
    assert.equal((await setPassword(request({ setupToken: token, password: 'attacker password' }))).status, 401);
    assert.equal((await login(request({ email, password }))).status, 200);
    assert.equal((await login(request({ email, password: 'incorrect' }))).status, 401);
    const sessionReq = request({});
    sessionReq.headers.set('authorization', `Bearer ${body.token}`);
    assert.equal((await auth.getSession(sessionReq)).user.email, email);
  });

  await t.test('old pre-fix JWTs, session tokens, malformed tokens, and expired JWTs fail', async () => {
    reset();
    const legacy = await new SignJWT({ email, purpose: 'setup' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('studio37')
      .setAudience('studio37-setup').setExpirationTime('15m').sign(new TextEncoder().encode(secret));
    const session = await auth.signSession({ ...approved(), passwordSet: true, passwordHash: 'mock-password-hash' });
    for (const token of [legacy, session, 'malformed', 'x'.repeat(3000)]) {
      assert.equal((await setPassword(request({ setupToken: token, password }))).status, 401);
    }
    const valid = await auth.signSetupToken(users.get(email));
    const payload = decodeJwt(valid);
    const expired = await new SignJWT({ ...payload, iat: Math.floor(Date.now() / 1000) - 1000, exp: Math.floor(Date.now() / 1000) - 1 })
      .setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(secret));
    setup.get(accountKey).digest = sha(expired);
    assert.equal((await setPassword(request({ setupToken: expired, password }))).status, 401);
    assert.equal(users.get(email).passwordHash, null);
  });

  await t.test('server-side expiry and issuance of a newer link revoke the earlier link', async () => {
    reset();
    const old = await emailedToken();
    const latest = await emailedToken();
    assert.ok(old !== latest);
    assert.equal((await setPassword(request({ setupToken: old, password }))).status, 401);
    setup.get(accountKey).expiresAt = Date.now() - 1;
    assert.equal((await setPassword(request({ setupToken: latest, password }))).status, 401);
  });

  await t.test('unknown, pending, disabled, and password-set accounts receive identical replies and no email', async () => {
    reset();
    const baseline = await requestSetup(request({ email }));
    const expected = await baseline.text();
    for (const user of [null, { ...approved(), status: 'pending' }, { ...approved(), status: 'disabled' },
      { ...approved(), passwordSet: true, passwordHash: await auth.hashPassword(password) },
      { ...approved(), passwordSet: true }, { ...approved(), passwordHash: 'inconsistent-hash' }]) {
      reset();
      if (user) users.set(email, user);
      else users.delete(email);
      const response = await requestSetup(request({ email }));
      assert.equal(response.status, 202);
      assert.equal(await response.text(), expected);
      assert.equal(sent.length, 0);
      assert.equal(setup.has(accountKey), false);
    }
  });

  await t.test('disabled, pending, deleted, or changed users cannot redeem a previously emailed link', async () => {
    for (const change of [
      (u) => ({ ...u, status: 'disabled' }),
      (u) => ({ ...u, status: 'pending' }),
      () => null,
      (u) => ({ ...u, role: 'super' }),
      (u) => ({ ...u, passwordSet: true }),
    ]) {
      reset();
      const token = await auth.signSetupToken(users.get(email));
      const changed = change(users.get(email));
      if (changed) users.set(email, changed);
      else users.delete(email);
      assert.equal((await setPassword(request({ setupToken: token, password }))).status, 401);
      assert.deepEqual(users.get(email) || null, changed);
    }
  });

  await t.test('disabling during hashing/consumption is rechecked; disabling before session issuance rejects it', async () => {
    reset();
    let token = await auth.signSetupToken(users.get(email));
    beforeDelete = () => users.set(email, { ...users.get(email), status: 'disabled' });
    assert.equal((await setPassword(request({ setupToken: token, password }))).status, 401);
    assert.equal(users.get(email).status, 'disabled');
    assert.equal(users.get(email).passwordHash, null);
    reset();
    token = await auth.signSetupToken(users.get(email));
    afterUserWrite = () => users.set(email, { ...users.get(email), status: 'disabled' });
    assert.equal((await setPassword(request({ setupToken: token, password }))).status, 401);
    assert.equal(users.get(email).status, 'disabled');
  });

  await t.test('invalid password validation does not consume the link', async () => {
    reset();
    const token = await auth.signSetupToken(users.get(email));
    for (const invalid of ['short', 'a'.repeat(73), '🔑'.repeat(20)]) {
      assert.equal((await setPassword(request({ setupToken: token, password: invalid }))).status, 400);
      assert.ok(await auth.verifySetupToken(token));
    }
    assert.equal((await setPassword(request({ setupToken: token, password }))).status, 200);
  });

  await t.test('IP and email throttles prevent further email; redemption is also rate limited', async () => {
    reset();
    for (let i = 0; i < 5; i++) {
      const response = await requestSetup(request({ email }));
      assert.equal(response.status, 202);
    }
    assert.equal(sent.length, 3);
    const blocked = await requestSetup(request({ email: 'other@example.test' }));
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    // New IP cannot evade the per-email bucket and sees the generic reply.
    assert.equal((await requestSetup(request({ email }, '192.0.2.2'))).status, 202);
    assert.equal(sent.length, 3);
    for (let i = 0; i < 10; i++) assert.equal((await setPassword(request({ setupToken: 'bad', password }))).status, 401);
    assert.equal((await setPassword(request({ setupToken: 'bad', password }))).status, 429);
  });

  await t.test('provider failures and missing configuration reveal no details or tokens', async () => {
    reset();
    const goodReply = await (await requestSetup(request({ email }))).text();
    for (const providerFailure of ['error', 'throw', 'missing-id']) {
      reset(); mailFailure = providerFailure;
      const response = await requestSetup(request({ email }));
      assert.equal(response.status, 202);
      assert.equal(await response.text(), goodReply);
      assert.equal(users.get(email).passwordHash, null);
    }
    for (const key of ['RESEND_API_KEY', 'JWT_SECRET']) {
      reset(); delete process.env[key];
      const response = await requestSetup(request({ email }));
      assert.equal(await response.text(), goodReply);
      assert.equal(sent.length, 0);
    }
  });

  await t.test('storage/rate-limit failures fail closed; consumed-token save failure requires a new link', async () => {
    for (const mode of ['setup:get', 'setup:set', 'users:get']) {
      reset(); failure = mode;
      const response = await requestSetup(request({ email }));
      assert.equal(response.status, 202);
      assert.equal(sent.length, 0);
      assert.ok(!JSON.stringify(await response.json()).includes('private'));
    }
    for (const mode of ['setup:get', 'setup:set', 'setup:delete', 'users:get', 'users:set']) {
      reset();
      const token = await auth.signSetupToken(users.get(email));
      failure = mode;
      const response = await setPassword(request({ setupToken: token, password }));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.token, undefined);
      assert.ok(!JSON.stringify(body).includes('private'));
      assert.equal(users.get(email).passwordHash, null);
      failure = '';
      if (mode === 'users:set') {
        assert.equal((await setPassword(request({ setupToken: token, password }))).status, 401);
        // Revocation persisted before the failed password write: administrator
        // recovery creates a new epoch; retrying the old epoch must fail closed.
        await assert.rejects(auth.signSetupToken(users.get(email)));
        users.set(email, { ...users.get(email), authVersion: auth.newAuthVersion() });
        const replacement = await auth.signSetupToken(users.get(email));
        assert.equal((await setPassword(request({ setupToken: replacement, password }))).status, 200);
      }
    }
  });

  await t.test('old sessions cannot bypass email setup through change-password; normal changes still work', async () => {
    reset();
    const oldSession = await new SignJWT({ email, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('studio37')
      .setAudience('studio37-session').setExpirationTime('9h').sign(new TextEncoder().encode(secret));
    const req = request({ currentPassword: '', newPassword: password });
    req.headers.set('authorization', `Bearer ${oldSession}`);
    assert.equal((await changePassword(req)).status, 401);
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const normal = request({ currentPassword: password, newPassword: 'new correct password' });
    normal.headers.set('authorization', `Bearer ${await auth.signSession(users.get(email))}`);
    assert.equal((await changePassword(normal)).status, 200);
    assert.equal(await auth.verifyPassword('new correct password', users.get(email).passwordHash), true);
  });

  await t.test('legacy sessions are rejected for already-password-set users; new sessions remain usable', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const old = await new SignJWT({ email, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('studio37')
      .setAudience('studio37-session').setExpirationTime('9h').sign(new TextEncoder().encode(secret));
    assert.equal((await auth.getSession(sessionRequest(old))).error.status, 401);
    const incomplete = await new SignJWT({ email, role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('studio37')
      .setAudience('studio37-session-v3').setExpirationTime('9h').sign(new TextEncoder().encode(secret));
    assert.equal((await auth.getSession(sessionRequest(incomplete))).error.status, 401);
    const normal = await auth.signSession(users.get(email));
    assert.equal((await auth.getSession(sessionRequest(normal))).user.email, email);
  });

  await t.test('admin reset invalidates sessions permanently, even after setup reuses the same password', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const old = await auth.signSession(users.get(email));
    const response = await adminUsers(await adminRequest('reset-password'));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authVersion, undefined);
    assert.equal(body.passwordHash, undefined);
    assert.equal(body.passwordSet, false);
    assert.equal((await auth.getSession(sessionRequest(old))).error.status, 401);
    assert.equal((await login(request({ email, password: 'attacker password' }))).status, 401);
    const setupToken = await emailedToken();
    const completed = await setPassword(request({ setupToken, password }));
    assert.equal(completed.status, 200);
    assert.equal((await auth.getSession(sessionRequest(old))).error.status, 401);
    assert.equal((await auth.getSession(sessionRequest((await completed.json()).token))).user.email, email);
    assert.equal((await setPassword(request({ setupToken, password }))).status, 401);
  });

  await t.test('resetting an already-unset account and disable/re-enable permanently invalidate inbox links', async () => {
    for (const actions of [['reset-password'], ['disable', 'enable']]) {
      reset();
      const oldUser = clone(users.get(email));
      const setupToken = await auth.signSetupToken(users.get(email));
      for (const action of actions) assert.equal((await adminUsers(await adminRequest(action))).status, 200);
      assert.equal(users.get(email).status, 'approved');
      assert.equal(users.get(email).passwordHash, null);
      assert.equal((await setPassword(request({ setupToken, password }))).status, 401);
      assert.ok(await auth.signSetupToken(users.get(email)));
      // Simulate a delayed pre-reset write restoring the original user snapshot.
      // Append-only revocation must still prevent its link from coming back.
      users.set(email, oldUser);
      assert.equal((await setPassword(request({ setupToken, password }))).status, 401);
      await assert.rejects(auth.signSetupToken(oldUser));
    }
  });

  await t.test('disable/re-enable and role changes revoke sessions without resurrecting stale snapshots', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const originalUser = clone(users.get(email));
    const token = await auth.signSession(originalUser);
    assert.equal((await adminUsers(await adminRequest('disable'))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    assert.equal((await adminUsers(await adminRequest('enable'))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    const current = await auth.signSession(users.get(email));
    assert.equal((await auth.getSession(sessionRequest(current))).user.email, email);
    assert.equal((await adminUsers(await adminRequest('role', { role: 'super' }))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(current))).error.status, 401);
    users.set(email, originalUser);
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    await assert.rejects(auth.signSession(originalUser));
  });

  await t.test('delete/recreate gives the account a fresh epoch and rejects old sessions', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const token = await auth.signSession(users.get(email));
    assert.equal((await adminUsers(await adminRequest('delete', {}, 'DELETE'))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    assert.equal((await adminUsers(await adminRequest('', { email }))).status, 201);
    const setupToken = await auth.signSetupToken(users.get(email));
    assert.equal((await setPassword(request({ setupToken, password }))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
  });

  await t.test('password change revokes all sessions, but incorrect password does not revoke them', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const one = await auth.signSession(users.get(email));
    const two = await auth.signSession(users.get(email));
    const wrong = sessionRequest(one, { currentPassword: 'wrong', newPassword: 'changed password' });
    assert.equal((await changePassword(wrong)).status, 401);
    assert.ok((await auth.getSession(sessionRequest(one))).user);
    const response = await changePassword(sessionRequest(one, { currentPassword: password, newPassword: 'changed password' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reauthenticate, true);
    for (const token of [one, two]) assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    assert.equal((await login(request({ email, password }))).status, 401);
    assert.equal((await login(request({ email, password: 'changed password' }))).status, 200);
  });

  await t.test('logout revokes only its session, refuses GET, and fails closed on storage errors', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const one = await auth.signSession(users.get(email));
    const two = await auth.signSession(users.get(email));
    assert.equal((await logout(new Request('https://example.test/logout'))).status, 405);
    assert.equal((await logout(sessionRequest(one))).status, 200);
    assert.equal((await auth.getSession(sessionRequest(one))).error.status, 401);
    assert.equal((await auth.getSession(sessionRequest(two))).user.email, email);
    failure = 'setup:set';
    assert.equal((await logout(sessionRequest(two))).status, 503);
    failure = 'setup:get';
    assert.equal((await auth.getSession(sessionRequest(two))).error.status, 503);
    failure = '';
    assert.equal((await logout(sessionRequest(two))).status, 200);
  });

  await t.test('admin mutation failures do not claim success; persisted revocation survives a failed user save', async () => {
    reset();
    users.set(email, { ...approved(), passwordHash: await auth.hashPassword(password), passwordSet: true });
    const original = clone(users.get(email));
    const token = await auth.signSession(original);
    const beforeRevokeFailure = await adminRequest('reset-password');
    failure = 'setup:set';
    assert.equal((await adminUsers(beforeRevokeFailure)).status, 503);
    assert.deepEqual(users.get(email), original);
    failure = '';
    assert.ok((await auth.getSession(sessionRequest(token))).user);
    const beforeUserFailure = await adminRequest('reset-password');
    failure = 'users:set';
    assert.equal((await adminUsers(beforeUserFailure)).status, 503);
    assert.deepEqual(users.get(email), original);
    failure = '';
    assert.equal((await auth.getSession(sessionRequest(token))).error.status, 401);
    assert.equal((await adminUsers(await adminRequest('reset-password'))).status, 200);
    assert.ok(await auth.signSetupToken(users.get(email)));
  });
});
