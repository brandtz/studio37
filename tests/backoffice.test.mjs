import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const stores = new Map();
const failNextWrite = new Set();
function memoryStore(name) {
  if (!stores.has(name)) stores.set(name, new Map());
  const data = stores.get(name);
  return {
    get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : null),
    setJSON: async (key, value, options = {}) => {
      if (failNextWrite.delete(`${name}/${key}`)) throw new Error('blob write failed');
      if (options.onlyIfNew && data.has(key)) return { modified: false };
      data.set(key, structuredClone(value));
      return { modified: true };
    },
    delete: async (key) => { data.delete(key); },
    list: async ({ prefix = '' } = {}) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
  };
}
mock.module('@netlify/blobs', {
  namedExports: { getStore: (opts) => memoryStore(typeof opts === 'string' ? opts : opts.name) },
});

const { verifyBackOfficeSignature } = await import('../src/netlify/functions/_lib/backoffice.mjs');
const { syncLeadToBackOffice } = await import('../src/netlify/functions/_lib/backoffice-leads.mjs');
const { buildOrderPayload, nextLifecycle, linkBackOfficeOrder, syncOrderToBackOffice } = await import('../src/netlify/functions/_lib/backoffice-orders.mjs');
const { saveCatalogLink, syncCatalogToBackOffice, syncProductToBackOffice } = await import('../src/netlify/functions/_lib/backoffice-catalog.mjs');
const { retryBackOfficeSyncs, importCatalogItemToStorefront } = await import('../src/netlify/functions/_lib/backoffice-storefront.mjs');
const receiver = (await import('../src/netlify/functions/backoffice-webhook.mjs')).default;
const mcp = (await import('../src/netlify/functions/storefront-mcp.mjs')).default;

const ENV_KEYS = [
  'BACKOFFICE_BASE_URL', 'BACKOFFICE_TENANT_SLUG', 'BACKOFFICE_API_KEY', 'BACKOFFICE_WEBSITE_WEBHOOK_SECRET',
  'BACKOFFICE_OUTBOUND_WEBHOOK_SECRET', 'STOREFRONT_MCP_TOKEN', 'SITE_URL', 'URL',
];
const WEBSITE_SECRET = 'whsec_website_test';
const OUTBOUND_SECRET = 'whsec_outbound_test';
const API_KEY = 'bo_key_test';
const MCP_TOKEN = 'mcp-token-0123456789abcdef0123456789abcdef';
const BO_ORDER_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_ID = '22222222-2222-4222-8222-222222222222';

let fetchCalls = [];
let fetchHandler = null;
globalThis.fetch = async (url, init = {}) => {
  const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, raw: init.body };
  call.body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  fetchCalls.push(call);
  if (!fetchHandler) throw new Error(`unexpected fetch ${call.method} ${call.url}`);
  return fetchHandler(call);
};

beforeEach(() => {
  stores.clear();
  failNextWrite.clear();
  fetchCalls = [];
  fetchHandler = null;
  for (const key of ENV_KEYS) delete process.env[key];
});

const store = (name) => memoryStore(name);
const hmac = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');
const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

function signedReceiverRequest(evt, { secret = OUTBOUND_SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(evt);
  return new Request('https://studio37customdesigns.com/api/webhooks/backoffice', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-backoffice-signature': `t=${t},v1=${hmac(secret, `${t}.${raw}`)}` },
    body: raw,
  });
}

const statusEvent = (status, timestamp, orderId = BO_ORDER_ID) => ({
  event: 'order.status_changed',
  tenantId: 'tenant-1',
  timestamp,
  data: { orderId, orderNumber: 'ORD-1001', status },
});

test('verifyBackOfficeSignature accepts only fresh signatures over the exact body', () => {
  const raw = '{"event":"order.created"}';
  const now = 1_750_000_000;
  const sig = (t, secret = OUTBOUND_SECRET, body = raw) => `t=${t},v1=${hmac(secret, `${t}.${body}`)}`;

  assert.deepEqual(verifyBackOfficeSignature(raw, sig(now), OUTBOUND_SECRET, { nowSec: now }), { ok: true, timestamp: now });
  assert.equal(verifyBackOfficeSignature(`${raw} `, sig(now), OUTBOUND_SECRET, { nowSec: now }).ok, false);
  assert.equal(verifyBackOfficeSignature(raw, sig(now, 'whsec_other'), OUTBOUND_SECRET, { nowSec: now }).ok, false);
  assert.deepEqual(verifyBackOfficeSignature(raw, sig(now - 301), OUTBOUND_SECRET, { nowSec: now }), { ok: false, reason: 'stale' });
  assert.equal(verifyBackOfficeSignature(raw, `t=${now},v1=deadbeef,${sig(now).split(',')[1]}`, OUTBOUND_SECRET, { nowSec: now }).ok, true);
  assert.equal(verifyBackOfficeSignature(raw, `v1=${hmac(OUTBOUND_SECRET, raw)}`, OUTBOUND_SECRET, { nowSec: now }).ok, false);
  assert.equal(verifyBackOfficeSignature(raw, sig(now), '', { nowSec: now }).ok, false);
});

test('lead sync is a no-op until the website webhook secret is configured', async () => {
  const res = await syncLeadToBackOffice('lead-1', { record: { id: 'lead-1' } });
  assert.equal(res.status, 'disabled');
  assert.equal(fetchCalls.length, 0);
  assert.equal(stores.size, 0);
});

test('leads are posted once with an HMAC signature over the raw body, retried after failures', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  const lead = {
    id: '1750000000000-abc', created_at: '2025-06-15T00:00:00.000Z',
    firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '503-555-0192',
    description: 'Looking for an 8ft black walnut dining table.', service: 'furniture', photos: [],
    utm: { source: 'instagram', medium: 'social', campaign: 'fall-tables' },
  };
  await store('leads').setJSON(lead.id, lead);

  fetchHandler = () => Response.json({ error: { code: 'VALIDATION_ERROR', message: 'bad' } }, { status: 400 });
  const failed = await syncLeadToBackOffice(lead.id, { record: lead });
  assert.equal(failed.status, 'failed');
  assert.equal((await store('leads').get(lead.id)).backoffice_sync.state, 'failed');
  assert.equal((await store('backoffice_outbox').get(`lead/${lead.id}`)).attempts, 1);
  assert.equal(fetchCalls[0].headers['idempotency-key'], `lead_${lead.id}`);

  fetchCalls = [];
  fetchHandler = () => Response.json({ data: { customerId: 'cust-1', interactionId: 'int-1' } }, { status: 201 });
  const retried = await retryBackOfficeSyncs({ ignoreBackoff: true });
  assert.equal(retried.synced, 1);

  assert.equal(fetchCalls.length, 1);
  const [call] = fetchCalls;
  assert.equal(call.url, 'https://gilgameh.netlify.app/api/webhooks/website');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['x-tenant-slug'], 'studio-37');
  assert.equal(call.headers['x-webhook-signature'], `v1=${hmac(WEBSITE_SECRET, call.raw)}`);
  assert.equal(call.headers['idempotency-key'], `lead_${lead.id}`);
  assert.equal(call.body.eventId, `lead_${lead.id}`);
  assert.equal(call.body.type, 'lead');
  assert.deepEqual(call.body.customer, {
    name: 'Jane Doe', email: 'jane@example.com', phone: '503-555-0192',
    utmSource: 'instagram', utmMedium: 'social', utmCampaign: 'fall-tables',
  });
  assert.match(call.body.message, /8ft black walnut dining table/);

  const saved = await store('leads').get(lead.id);
  assert.equal(saved.backoffice_sync.state, 'synced');
  assert.equal(saved.backoffice_sync.customer_id, 'cust-1');
  assert.equal(await store('backoffice_outbox').get(`lead/${lead.id}`), null);

  const again = await syncLeadToBackOffice(lead.id);
  assert.equal(again.status, 'already_synced');
  assert.equal(fetchCalls.length, 1);
});

test('order payload uses unit prices and linked Back Office catalog items', async () => {
  await saveCatalogLink('walnut-bowl', { id: CATALOG_ID, sku: 'S37-BOWL-13', version: 1 });
  const payload = await buildOrderPayload({
    id: 'cs_test_1', customer_name: 'Jane Doe', customer_email: 'jane@example.com', customer_phone: '503-555-0192',
    items: [
      { description: '13" Turned Walnut Bowl', quantity: 2, unit_amount: 5000, amount_total: 10800, product_id: 'walnut-bowl' },
      { description: 'Coaster set', quantity: 3, amount_subtotal: 7800, amount_total: 8400, product_id: 'unlinked' },
    ],
  });
  assert.deepEqual(payload, {
    eventId: 'order_cs_test_1',
    type: 'order',
    externalOrderId: 'cs_test_1',
    customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '503-555-0192' },
    lines: [
      { description: '13" Turned Walnut Bowl', quantity: 2, unitPriceCents: 5000, catalogItemId: CATALOG_ID },
      { description: 'Coaster set', quantity: 3, unitPriceCents: 2600 },
    ],
  });
});

test('nextLifecycle only moves orders forward', () => {
  assert.equal(nextLifecycle('new', 'confirmed'), null);
  assert.equal(nextLifecycle('new', 'pending'), null);
  assert.equal(nextLifecycle('new', 'in_production'), 'in_production');
  assert.equal(nextLifecycle(undefined, 'ready'), 'ready_to_ship');
  assert.equal(nextLifecycle('shipped', 'ready'), null);
  assert.equal(nextLifecycle('ready_to_ship', 'fulfilled'), 'complete');
  assert.equal(nextLifecycle('complete', 'fulfilled'), null);
  assert.equal(nextLifecycle('in_production', 'cancelled'), 'cancelled');
  assert.equal(nextLifecycle('complete', 'cancelled'), null);
  assert.equal(nextLifecycle('cancelled', 'in_production'), null);
  assert.equal(nextLifecycle('refunded', 'fulfilled'), null);
});

test('an order whose delivery timed out is reconciled instead of posted twice', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  process.env.BACKOFFICE_API_KEY = API_KEY;
  const order = {
    id: 'cs_ambiguous', source: 'website_checkout', payment_status: 'paid', lifecycle: 'new',
    created_at: new Date().toISOString(), customer_name: 'Jane Doe', customer_email: 'jane@example.com',
    items: [{ description: 'Bowl', quantity: 1, unit_amount: 5000 }],
  };
  await store('orders').setJSON(order.id, order);

  fetchHandler = () => { throw timeoutError(); };
  const first = await syncOrderToBackOffice(order.id);
  assert.equal(first.status, 'unknown');
  assert.equal(fetchCalls[0].body.externalOrderId, order.id);
  assert.equal(fetchCalls[0].headers['idempotency-key'], `order_${order.id}`);

  fetchCalls = [];
  fetchHandler = (call) => {
    assert.equal(call.method, 'GET');
    assert.equal(call.headers.authorization, `Bearer ${API_KEY}`);
    assert.match(call.url, /\/api\/v1\/orders\?channel=website/);
    return Response.json({
      data: [{ id: BO_ORDER_ID, externalOrderId: order.id, orderNumber: 'ORD-1001', customerId: 'cust-1', createdAt: new Date().toISOString() }],
      meta: { hasMore: false },
    });
  };
  const second = await syncOrderToBackOffice(order.id);
  assert.equal(second.status, 'synced');
  assert.equal(second.reconciled, true);
  assert.equal(fetchCalls.length, 1, 'no second POST to the website webhook');

  const saved = await store('orders').get(order.id);
  assert.equal(saved.backoffice_sync.state, 'synced');
  assert.equal(saved.backoffice_sync.order_id, BO_ORDER_ID);
  assert.equal(saved.backoffice_sync.order_number, 'ORD-1001');
  assert.equal(await store('backoffice_outbox').get(`order/${order.id}`), null);
  assert.equal((await store('backoffice_order_index').get(BO_ORDER_ID)).local_order_id, order.id);
});

test('a local write failure after Back Office accepts an order never causes a re-send', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  process.env.BACKOFFICE_API_KEY = API_KEY;
  const order = {
    id: 'cs_delivered', source: 'website_checkout', payment_status: 'paid', lifecycle: 'new',
    created_at: new Date().toISOString(), items: [{ description: 'Bowl', quantity: 1, unit_amount: 5000 }],
  };
  await store('orders').setJSON(order.id, order);

  fetchHandler = () => Response.json({ data: { customerId: 'cust-1', orderId: BO_ORDER_ID, orderNumber: 'ORD-1002' } }, { status: 201 });
  failNextWrite.add(`orders/${order.id}`);
  assert.equal((await syncOrderToBackOffice(order.id)).status, 'unknown');
  assert.equal(fetchCalls.length, 1);

  fetchCalls = [];
  fetchHandler = (call) => {
    assert.equal(call.method, 'GET');
    return Response.json({
      data: [{ id: BO_ORDER_ID, externalOrderId: order.id, orderNumber: 'ORD-1002', createdAt: new Date().toISOString() }],
      meta: { hasMore: false },
    });
  };
  const second = await syncOrderToBackOffice(order.id);
  assert.equal(second.status, 'synced');
  assert.equal(second.reconciled, true);
  assert.equal(fetchCalls.filter((c) => c.method === 'POST').length, 0);

  // A failed link write is tolerated: the order is still recorded as delivered.
  const other = { ...order, id: 'cs_unlinked' };
  await store('orders').setJSON(other.id, other);
  fetchCalls = [];
  fetchHandler = () => Response.json({ data: { customerId: 'cust-1', orderId: BO_ORDER_ID, orderNumber: 'ORD-1003' } }, { status: 201 });
  failNextWrite.add(`backoffice_order_index/${BO_ORDER_ID}`);
  assert.equal((await syncOrderToBackOffice(other.id)).status, 'synced');
  assert.equal((await store('orders').get(other.id)).backoffice_sync.order_number, 'ORD-1003');
});

test('malformed successful order responses remain ambiguous and reconcile before retrying', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  process.env.BACKOFFICE_API_KEY = API_KEY;
  const replies = [
    () => new Response('<html>Proxy response</html>'),
    () => new Response(null, { status: 204 }),
    () => Response.json({}),
    () => Response.json({ data: { customerId: 'cust-1' } }),
    () => Response.json({ data: { customerId: 'cust-1', orderId: '', orderNumber: 'ORD-1004' } }),
  ];
  for (const [index, reply] of replies.entries()) {
    const order = {
      id: `cs_bad_response_${index}`, source: 'website_checkout', payment_status: 'paid',
      created_at: new Date().toISOString(), items: [{ description: 'Bowl', quantity: 1, unit_amount: 5000 }],
    };
    await store('orders').setJSON(order.id, order);
    fetchHandler = reply;
    const sent = await syncOrderToBackOffice(order.id);
    assert.equal(sent.status, 'unknown');
    assert.equal((await store('orders').get(order.id)).backoffice_sync.state, 'unknown');
    assert.equal((await store('backoffice_outbox').get(`order/${order.id}`)).last_state, 'unknown');

    fetchCalls = [];
    fetchHandler = (call) => {
      assert.equal(call.method, 'GET', 'an ambiguous delivery must not be blindly posted again');
      return Response.json({
        data: [{ id: BO_ORDER_ID, externalOrderId: order.id, customerId: 'cust-1', orderNumber: 'ORD-1004', createdAt: new Date().toISOString() }],
        meta: { hasMore: false },
      });
    };
    const retried = await syncOrderToBackOffice(order.id);
    assert.equal(retried.status, 'synced');
    assert.equal(retried.reconciled, true);
    assert.equal(fetchCalls.length, 1);
  }
});

test('a lead is not marked synced without the customer and interaction identifiers', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  const lead = { id: 'lead_bad_response', firstName: 'Test', email: 'test@example.com' };
  await store('leads').setJSON(lead.id, lead);
  fetchHandler = () => Response.json({ data: { customerId: 'cust-1' } });
  assert.equal((await syncLeadToBackOffice(lead.id)).status, 'unknown');
  assert.equal((await store('leads').get(lead.id)).backoffice_sync.state, 'unknown');
  assert.ok(await store('backoffice_outbox').get(`lead/${lead.id}`));
});

test('orders that are unpaid, in-person or historical are never sent', async () => {
  process.env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET = WEBSITE_SECRET;
  const cases = [
    { id: 'cs_unpaid', source: 'website_checkout', payment_status: 'unpaid' },
    { id: 'pi_direct', source: 'stripe_direct', payment_status: 'paid' },
    { id: 'cs_old', source: 'website_checkout', payment_status: 'paid', backoffice_sync: { state: 'skipped' } },
  ];
  for (const order of cases) {
    await store('orders').setJSON(order.id, order);
    assert.equal((await syncOrderToBackOffice(order.id)).status, 'ineligible');
  }
  assert.equal(fetchCalls.length, 0);
});

function fakeCatalog() {
  const items = new Map();
  const replays = new Map();
  let seq = 0;
  fetchHandler = (call) => {
    assert.equal(call.headers.authorization, `Bearer ${API_KEY}`);
    const url = new URL(call.url);
    const byId = url.pathname.match(/^\/api\/v1\/catalog\/([^/]+)$/);
    if (url.pathname === '/api/v1/catalog' && call.method === 'GET') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const data = [...items.values()].filter((it) => !q || it.sku.toLowerCase().includes(q) || it.name.toLowerCase().includes(q));
      return Response.json({ data, meta: { hasMore: false } });
    }
    if (url.pathname === '/api/v1/catalog' && call.method === 'POST') {
      const key = call.headers['idempotency-key'];
      if (replays.has(key)) return Response.json({ data: replays.get(key) }, { status: 201, headers: { 'x-idempotent-replayed': 'true' } });
      seq++;
      const item = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, type: 'product', sku: call.body.sku, name: call.body.name,
        description: call.body.description ?? null, basePriceCents: call.body.basePriceCents, attributes: call.body.attributes,
        trackInventory: call.body.trackInventory, isActive: true, verified: true, version: 1,
      };
      items.set(item.id, item);
      replays.set(key, item);
      return Response.json({ data: item }, { status: 201 });
    }
    if (byId && call.method === 'GET') {
      const item = items.get(byId[1]);
      return item ? Response.json({ data: item }) : Response.json({ error: { code: 'NOT_FOUND', message: 'missing' } }, { status: 404 });
    }
    if (byId && call.method === 'PATCH') {
      const item = items.get(byId[1]);
      const { version, ...patch } = call.body;
      if (version !== item.version) return Response.json({ error: { code: 'VERSION_CONFLICT', message: 'stale' } }, { status: 409 });
      const next = { ...item, ...patch, version: item.version + 1 };
      items.set(item.id, next);
      return Response.json({ data: next });
    }
    throw new Error(`unexpected ${call.method} ${call.url}`);
  };
  return items;
}

test('catalog sync is idempotent and matches existing items by SKU', async () => {
  process.env.BACKOFFICE_API_KEY = API_KEY;
  process.env.SITE_URL = 'https://shop.example';
  const items = fakeCatalog();
  const products = [
    { id: 'walnut-bowl', sku: 'S37-BOWL-13', name: '13" Turned Walnut Bowl', description: 'Hand-turned', price: 5000, status: 'available', images: ['/assets/images/bowl.jpg'] },
    { id: 'coaster-set', name: 'Black Walnut Coaster (Set of 4)', price: 2600, status: 'by_request', images: [] },
    { id: 'old-sign', name: 'Old sign', price: 1000, status: 'archived', images: [] },
  ];
  const writes = () => fetchCalls.filter((c) => c.method !== 'GET');

  const first = await syncCatalogToBackOffice(products);
  assert.deepEqual({ ...first, errors: first.errors.length }, { created: 2, updated: 0, unchanged: 0, skipped: 1, failed: 0, remaining: 0, errors: 0 });
  const posts = writes();
  assert.deepEqual(posts.map((c) => c.headers['idempotency-key']).sort(), ['catalog-import-S37-BOWL-13', 'catalog-import-S37-COASTER-SET']);
  const bowl = posts.find((c) => c.body.sku === 'S37-BOWL-13').body;
  assert.equal(bowl.trackInventory, true);
  assert.equal(bowl.initialQuantityOnHand, 0);
  assert.equal(bowl.basePriceCents, 5000);
  assert.deepEqual(bowl.attributes.images, ['https://shop.example/assets/images/bowl.jpg']);
  const coaster = posts.find((c) => c.body.sku === 'S37-COASTER-SET').body;
  assert.equal(coaster.trackInventory, false);
  assert.equal('initialQuantityOnHand' in coaster, false);

  fetchCalls = [];
  const second = await syncCatalogToBackOffice(products);
  assert.equal(second.unchanged, 2);
  assert.equal(second.created, 0);
  assert.equal(writes().length, 0);

  // Lost links fall back to an exact SKU match rather than creating duplicates.
  stores.get('backoffice_catalog_map').clear();
  fetchCalls = [];
  assert.equal((await syncProductToBackOffice(products[0])).action, 'unchanged');
  assert.equal(writes().length, 0);
  assert.equal(items.size, 2);

  fetchCalls = [];
  const repriced = await syncProductToBackOffice({ ...products[0], price: 5500 });
  assert.equal(repriced.action, 'updated');
  assert.deepEqual(writes().map((c) => c.body), [{ basePriceCents: 5500, version: 1 }]);

  fetchCalls = [];
  assert.equal((await syncProductToBackOffice({ ...products[0], price: 5500, status: 'archived' })).action, 'updated');
  const [archive] = writes();
  assert.equal(archive.body.isActive, false);
  assert.equal(archive.body.version, 2);
  assert.equal(archive.body.attributes.storefrontStatus, 'archived');
});

test('publishing a Back Office product onto an archived listing relists it', async () => {
  process.env.BACKOFFICE_API_KEY = API_KEY;
  const items = fakeCatalog();
  items.set(CATALOG_ID, {
    id: CATALOG_ID, type: 'product', sku: 'TEST-PUBLISH-1', name: 'Walnut Bowl v2', description: 'Refreshed listing',
    basePriceCents: 6000, attributes: {}, isActive: true, verified: true, version: 1,
  });
  await store('products').setJSON('old-test-bowl', {
    id: 'old-test-bowl', sku: 'TEST-PUBLISH-1', name: 'Old bowl', price: 5000, status: 'archived', images: [],
    created_at: '2024-01-01T00:00:00.000Z',
  });

  const res = await importCatalogItemToStorefront(CATALOG_ID);
  assert.equal(res.ok, true);
  assert.equal(res.action, 'updated');
  assert.equal(res.product.id, 'old-test-bowl');
  assert.equal(res.product.status, 'available');
  assert.equal(res.product.price, 6000);
  assert.equal((await store('products').get('old-test-bowl')).name, 'Walnut Bowl v2');
  assert.equal(fetchCalls.some((c) => c.method === 'PATCH' && c.body.isActive === false), false);
  assert.equal(items.get(CATALOG_ID).isActive, true);
});

test('status webhook rejects unconfigured, unsigned and stale requests', async () => {
  const evt = statusEvent('in_production', new Date().toISOString());
  assert.equal((await receiver(signedReceiverRequest(evt))).status, 503);

  process.env.BACKOFFICE_OUTBOUND_WEBHOOK_SECRET = OUTBOUND_SECRET;
  assert.equal((await receiver(new Request('https://x.test/', { method: 'GET' }))).status, 405);
  assert.equal((await receiver(signedReceiverRequest(evt, { secret: 'whsec_wrong' }))).status, 401);
  assert.equal((await receiver(signedReceiverRequest(evt, { t: Math.floor(Date.now() / 1000) - 600 }))).status, 401);
  const unsigned = new Request('https://x.test/', { method: 'POST', body: JSON.stringify(evt) });
  assert.equal((await receiver(unsigned)).status, 401);
});

test('status webhook moves linked orders forward only', async () => {
  process.env.BACKOFFICE_OUTBOUND_WEBHOOK_SECRET = OUTBOUND_SECRET;
  await store('orders').setJSON('cs_hook', { id: 'cs_hook', source: 'website_checkout', lifecycle: 'new', status_history: [] });
  await store('backoffice_order_index').setJSON(BO_ORDER_ID, { local_order_id: 'cs_hook' });
  const at = (minute) => `2025-06-15T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const send = async (status, minute) => {
    const res = await receiver(signedReceiverRequest(statusEvent(status, at(minute))));
    assert.equal(res.status, 200);
    return (await store('orders').get('cs_hook'));
  };

  let order = await send('in_production', 1);
  assert.equal(order.lifecycle, 'in_production');
  assert.equal(order.backoffice_status, 'in_production');
  assert.equal(order.backoffice_order_number, 'ORD-1001');
  assert.deepEqual(order.status_history.map((h) => [h.stage, h.by]), [['in_production', 'Back Office']]);

  order = await send('confirmed', 2);
  assert.equal(order.lifecycle, 'in_production');
  assert.equal(order.backoffice_status, 'confirmed');

  await store('orders').setJSON('cs_hook', { ...order, lifecycle: 'shipped' });
  order = await send('ready', 3);
  assert.equal(order.lifecycle, 'shipped');

  order = await send('in_production', 0); // delivered late, older than the last event
  assert.equal(order.backoffice_status, 'ready');

  order = await send('fulfilled', 4);
  assert.equal(order.lifecycle, 'complete');
  order = await send('cancelled', 5);
  assert.equal(order.lifecycle, 'complete');
});

test('status updates that arrive before the order is linked are applied on link', async () => {
  process.env.BACKOFFICE_OUTBOUND_WEBHOOK_SECRET = OUTBOUND_SECRET;
  await store('orders').setJSON('cs_race', { id: 'cs_race', source: 'website_checkout', lifecycle: 'new', status_history: [] });

  const res = await receiver(signedReceiverRequest(statusEvent('ready', new Date().toISOString())));
  assert.deepEqual(await res.json(), { received: true, pending: true });
  assert.equal((await store('orders').get('cs_race')).lifecycle, 'new');

  await linkBackOfficeOrder(BO_ORDER_ID, 'cs_race', { orderNumber: 'ORD-1001' });
  const order = await store('orders').get('cs_race');
  assert.equal(order.lifecycle, 'ready_to_ship');
  assert.equal(order.backoffice_order_number, 'ORD-1001');
  assert.equal(fetchCalls.length, 0);
});

function mcpRequest(body, token = MCP_TOKEN) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request('https://studio37customdesigns.com/api/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('MCP endpoint is disabled without a token and requires the bearer token', async () => {
  const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  assert.equal((await mcp(mcpRequest(list))).status, 404);

  process.env.STOREFRONT_MCP_TOKEN = MCP_TOKEN;
  assert.equal((await mcp(mcpRequest(list, null))).status, 401);
  assert.equal((await mcp(mcpRequest(list, `${MCP_TOKEN}x`))).status, 401);

  const init = await (await mcp(mcpRequest({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }))).json();
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal((await mcp(mcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);

  const tools = await (await mcp(mcpRequest(list))).json();
  assert.deepEqual(tools.result.tools.map((t) => t.name), [
    'list_storefront_products', 'sync_catalog_to_backoffice', 'publish_product_from_backoffice', 'list_recent_storefront_leads',
  ]);
});

test('MCP lead listing omits contact details', async () => {
  process.env.STOREFRONT_MCP_TOKEN = MCP_TOKEN;
  await store('leads').setJSON('1750000000000-a', {
    id: '1750000000000-a', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '503-555-0192',
    service: 'furniture', backoffice_sync: { state: 'synced', customer_id: 'cust-1' },
  });
  const res = await (await mcp(mcpRequest({
    jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_recent_storefront_leads', arguments: { limit: 5 } },
  }))).json();
  assert.equal(res.result.isError, false);
  const [lead] = res.result.structuredContent.leads;
  assert.equal(lead.name, 'Jane Doe');
  assert.equal(lead.backoffice_sync_state, 'synced');
  assert.doesNotMatch(JSON.stringify(res.result), /jane@example\.com|503-555-0192/);
});
