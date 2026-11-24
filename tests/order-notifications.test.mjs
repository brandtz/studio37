import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const orders = new Map();
const deliveries = [];
let currentEvent;
let checkoutSession = null;
let failOwner = false;
let failSave = false;
let failOwnerFlag = false;
const store = {
  get: async (id) => structuredClone(orders.get(id) || null),
  setJSON: async (id, value) => {
    if (failSave) throw new Error('test storage failure');
    if (failOwnerFlag && value.owner_email_sent) throw new Error('test flag failure');
    orders.set(id, structuredClone(value));
  },
};

mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: { json: (body, status = 200) => Response.json(body, { status }) },
});
mock.module(new URL('../src/netlify/functions/_lib/stripe.mjs', import.meta.url), {
  namedExports: {
    orderStore: () => store,
    stripe: () => ({
      webhooks: { constructEvent: () => currentEvent },
      checkout: { sessions: {
        listLineItems: async () => ({ data: [{ description: 'Walnut <board>', quantity: 1, amount_total: 2500 }] }),
        list: async () => ({ data: checkoutSession ? [checkoutSession] : [] }),
      } },
    }),
  },
});
mock.module('twilio', { defaultExport: () => { throw new Error('Twilio should not be called'); } });
mock.module('resend', {
  namedExports: { Resend: class {
    emails = { send: async (message, options) => {
      deliveries.push({ message, options });
      if (failOwner && message.tags.some((tag) => tag.value === 'order_notification')) {
        return { error: { message: 'test delivery failure' } };
      }
      return { data: { id: 'email-test' } };
    } };
  } },
});

const handler = (await import('../src/netlify/functions/stripe-webhook.mjs')).default;
const { importPaymentIntentAsOrder } = await import('../src/netlify/functions/_lib/stripe-order-sync.mjs');
const session = {
  id: 'cs_test_123', payment_intent: 'pi_test_123', customer_details: { name: 'Alex', email: 'alex@example.test' },
  amount_subtotal: 2500, amount_total: 2500, currency: 'usd', payment_status: 'paid', status: 'complete',
};
const payment = { id: 'pi_direct_123', status: 'succeeded', amount: 1200, currency: 'usd', description: 'In-person sale' };

function request() {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'test' }, body: '{}',
  });
}

test('Stripe events notify Drew independently of customer receipts', async (t) => {
  const keys = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET_PLATFORM', 'RESEND_API_KEY', 'ORDER_NOTIFY_TO', 'RESEND_FROM', 'RESEND_REPLY_TO', 'TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM', 'DREW_PHONE'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.STRIPE_WEBHOOK_SECRET = 'test';
  process.env.RESEND_API_KEY = 'test';
  process.env.ORDER_NOTIFY_TO = 'owner@example.test';
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    mock.restoreAll();
  });

  await t.test('notifies for a checkout and does not resend on replay', async () => {
    currentEvent = { type: 'checkout.session.completed', data: { object: session } };
    assert.equal((await handler(request())).status, 200);
    assert.equal(deliveries.length, 2);
    const owner = deliveries.find(({ message }) => message.to === 'owner@example.test');
    assert.ok(owner.message.text.includes('Walnut <board>'));
    assert.ok(owner.message.text.includes('$25.00'));
    assert.ok(owner.message.html.includes('Walnut &lt;board&gt;'));
    assert.equal(owner.message.reply_to, 'alex@example.test');
    assert.equal(owner.options.idempotencyKey, 'order-notification/cs_test_123');
    assert.equal(orders.get(session.id).owner_email_sent, true);
    assert.equal((await handler(request())).status, 200);
    assert.equal(deliveries.length, 2);
  });

  await t.test('retries a failed owner email without resending the customer receipt', async () => {
    orders.clear(); deliveries.length = 0;
    failOwner = true;
    assert.equal((await handler(request())).status, 500);
    assert.equal(orders.get(session.id).email_sent, true);
    assert.equal(orders.get(session.id).owner_email_sent, false);
    failOwner = false;
    assert.equal((await handler(request())).status, 200);
    assert.equal(orders.get(session.id).owner_email_sent, true);
    assert.equal(deliveries.filter(({ message }) => message.to === 'alex@example.test').length, 1);
    assert.equal(deliveries.filter(({ message }) => message.to === 'owner@example.test').length, 2);
  });

  await t.test('notifies for a direct payment without a customer email', async () => {
    orders.clear(); deliveries.length = 0;
    currentEvent = { type: 'payment_intent.succeeded', data: { object: payment } };
    assert.equal((await handler(request())).status, 200);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].message.to, 'owner@example.test');
    assert.ok(deliveries[0].message.text.includes('New Studio 37 payment'));
    assert.equal(orders.get(payment.id).owner_email_sent, true);
    assert.equal((await handler(request())).status, 200);
    assert.equal(deliveries.length, 1);
  });

  await t.test('retries an already-imported checkout through the payment event', async () => {
    orders.clear(); deliveries.length = 0;
    checkoutSession = session;
    currentEvent = { type: 'payment_intent.succeeded', data: { object: { ...payment, id: 'pi_test_123' } } };
    failOwner = true;
    assert.equal((await handler(request())).status, 500);
    assert.equal(orders.get(session.id).owner_email_sent, false);
    failOwner = false;
    assert.equal((await handler(request())).status, 200);
    assert.equal(orders.get(session.id).owner_email_sent, true);
    assert.equal(deliveries.filter(({ message }) => message.to === 'alex@example.test').length, 1);
    checkoutSession = null;
  });

  await t.test('reuses the idempotency key if saving the sent flag fails', async () => {
    orders.clear(); deliveries.length = 0;
    currentEvent = { type: 'checkout.session.completed', data: { object: session } };
    failOwnerFlag = true;
    assert.equal((await handler(request())).status, 500);
    failOwnerFlag = false;
    assert.equal((await handler(request())).status, 200);
    const attempts = deliveries.filter(({ message }) => message.to === 'owner@example.test');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].options.idempotencyKey, attempts[1].options.idempotencyKey);
    assert.equal(orders.get(session.id).owner_email_sent, true);
  });

  await t.test('does not notify for historical imports or old records', async () => {
    orders.clear(); deliveries.length = 0;
    currentEvent = { type: 'payment_intent.succeeded', data: { object: payment } };
    await importPaymentIntentAsOrder(payment, 'studio37', null, { historicalImport: true });
    assert.equal((await handler(request())).status, 200);
    orders.set(session.id, { id: session.id, sms_sent: true, email_sent: true });
    currentEvent = { type: 'checkout.session.completed', data: { object: session } };
    assert.equal((await handler(request())).status, 200);
    assert.equal(deliveries.length, 0);
  });

  await t.test('returns an error when the order cannot be saved', async () => {
    orders.clear(); deliveries.length = 0; failSave = true;
    assert.equal((await handler(request())).status, 500);
    assert.equal(deliveries.length, 0);
    failSave = false;
  });

  await t.test('does not process Stripe test events on a live deployment', async () => {
    orders.clear(); deliveries.length = 0;
    process.env.STRIPE_SECRET_KEY = 'sk_live_test';
    currentEvent = { type: 'checkout.session.completed', livemode: false, data: { object: session } };
    assert.equal((await handler(request())).status, 200);
    assert.equal(orders.size, 0);
    assert.equal(deliveries.length, 0);
    process.env.STRIPE_SECRET_KEY = 'sk_test_test';
    currentEvent.livemode = true;
    assert.equal((await handler(request())).status, 503);
    assert.equal(orders.size, 0);
    delete process.env.STRIPE_SECRET_KEY;
  });
});
