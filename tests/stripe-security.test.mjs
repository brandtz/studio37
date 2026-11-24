import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';

process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
process.env.SITE_URL = 'https://studio37.example';

let tenant = { id: 'studio37', stripe_account_id: 'acct_example', currency: 'usd' };
let product = { id: 'item', name: 'Item', price: 1000 };
const links = [];
const checkouts = [];

mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    json: (body, status = 200) => Response.json(body, { status }),
    nowIso: () => '2025-01-01T00:00:00Z',
    ensureProductSeeded: async () => {},
    productStore: () => ({ get: async () => product }),
  },
});
mock.module(new URL('../src/netlify/functions/_lib/auth.mjs', import.meta.url), {
  namedExports: { requireSession: async () => ({ user: { role: 'super' } }) },
});
mock.module(new URL('../src/netlify/functions/_lib/stripe.mjs', import.meta.url), {
  namedExports: {
    stripe: () => ({
      accountLinks: { create: async (params) => { links.push(params); return { url: 'https://connect.stripe.com/example' }; } },
      checkout: { sessions: { create: async (params) => { checkouts.push(params); return { id: 'session', url: 'https://checkout.stripe.com/example' }; } } },
    }),
    resolveTenant: async () => tenant,
    tenantHasAccount: (value) => !!value?.stripe_account_id,
    requireConnectedTenant: async () => ({ tenant }),
    saveTenant: async () => {},
    listTenants: async () => [],
  },
});
mock.module(new URL('../src/netlify/functions/_lib/stripe-product-sync.mjs', import.meta.url), {
  namedExports: { syncAllProductsToStripe: async () => {} },
});
mock.module(new URL('../src/netlify/functions/_lib/stripe-order-sync.mjs', import.meta.url), {
  namedExports: { importHistoricalPayments: async () => {} },
});

const { default: admin } = await import('../src/netlify/functions/admin-stripe-connect.mjs');
const { default: refresh } = await import('../src/netlify/functions/stripe-connect-refresh.mjs');
const { default: checkout } = await import('../src/netlify/functions/stripe-checkout-session.mjs');

test('Stripe onboarding and checkout restrict redirects and refresh capabilities', async (t) => {
  t.after(() => mock.restoreAll());
  await t.test('only an account-bound, unexpired capability refreshes a link', async () => {
    const response = await admin(new Request('https://untrusted.example/api/admin/stripe-connect?action=onboard', { method: 'POST' }));
    assert.equal(response.status, 200);
    const refreshUrl = links[0].refresh_url;
    assert.equal(new URL(refreshUrl).origin, 'https://studio37.example');
    assert.equal((await refresh(new Request('https://studio37.example/stripe/onboarding-refresh'))).status, 403);
    assert.equal((await refresh(new Request(`${refreshUrl}tampered`))).status, 403);
    const expired = await new SignJWT({ tenantId: tenant.id, accountId: tenant.stripe_account_id })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('studio37').setAudience('stripe-onboarding-refresh')
      .setExpirationTime('1 second ago').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    assert.equal((await refresh(new Request(`https://studio37.example/stripe/onboarding-refresh?token=${expired}`))).status, 403);
    assert.equal(links.length, 1);
    tenant = { ...tenant, stripe_account_id: 'acct_changed' };
    assert.equal((await refresh(new Request(refreshUrl))).status, 302);
    assert.equal(links.length, 1);
    tenant = { ...tenant, stripe_account_id: 'acct_example' };
    const valid = await refresh(new Request(refreshUrl));
    assert.equal(valid.status, 302);
    assert.equal(valid.headers.get('location'), 'https://connect.stripe.com/example');
    assert.equal(valid.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(links.length, 2);
    assert.equal(links[1].refresh_url, refreshUrl);
  });

  await t.test('checkout rejects off-site or malformed return URLs', async () => {
    const request = (extra) => new Request('https://untrusted.example/api/stripe/checkout-session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 'item', quantity: 1 }], ...extra }),
    });
    for (const target of ['https://evil.example/', 'https://studio37.example@evil.example/', '//evil.example/', 'javascript:alert(1)']) {
      const response = await checkout(request({ successUrl: target }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'invalid_return_url');
    }
    assert.equal((await checkout(request({ cancelUrl: 'https://evil.example/' }))).status, 400);
    assert.equal(checkouts.length, 0);
    assert.equal((await checkout(request({}))).status, 200);
    assert.equal(checkouts[0].success_url, 'https://studio37.example/order/confirmed?session_id={CHECKOUT_SESSION_ID}');
    assert.equal((await checkout(request({ successUrl: 'https://studio37.example/custom' }))).status, 200);
  });

  await t.test('cached or direct checkout cannot purchase hidden sauna products', async () => {
    product = { id: 'item', name: 'Cedar Sauna Kit', price: 1000, status: 'available' };
    const response = await checkout(new Request('https://studio37.example/api/stripe/checkout-session', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ id: 'item', quantity: 1 }] }),
    }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'product_unavailable');
    assert.equal(checkouts.length, 2);
  });
});
