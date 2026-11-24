import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

function memoryStore() {
  const entries = new Map();
  let version = 0;
  return {
    entries,
    async get(key) { return structuredClone(entries.get(key)?.data || null); },
    async getWithMetadata(key) { return structuredClone(entries.get(key) || null); },
    async setJSON(key, data, options = {}) {
      if ((options.onlyIfNew && entries.has(key)) ||
          (options.onlyIfMatch && entries.get(key)?.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = '"' + ++version + '"';
      entries.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    list({ prefix }) {
      return (async function* () {
        yield { blobs: [...entries.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
      })();
    },
  };
}
const sdkStore = memoryStore();
let readFails = false;
mock.module('@netlify/blobs', { namedExports: { getStore: () => ({
  ...sdkStore,
  getWithMetadata: async (key) => {
    if (readFails) throw new Error('private backend credentials');
    return sdkStore.getWithMetadata(key);
  },
}) } });
const deliveries = [];
mock.module('resend', { namedExports: { Resend: class {
  emails = { send: async (message, options) => {
    deliveries.push({ message: structuredClone(message), options });
    return { data: { id: 'mock-message-id' } };
  } };
} } });
mock.module(new URL('../src/netlify/functions/_lib/rate-limit.mjs', import.meta.url), {
  namedExports: { checkRateLimit: async () => ({ allowed: true }), clientIp: () => 'offline-test' },
});
mock.module('twilio', { defaultExport: () => { throw new Error('SMS must not be called in this test'); } });

const { createScopedContentRepository, createPublicContentHandler } = await import('../src/netlify/functions/_lib/content.mjs');
const {
  emailRegistry, renderEmailCopy, validateEmailHeaders, readEmailCopy, createAdminEmailContentHandler,
} = await import('../src/netlify/functions/_lib/email-content.mjs');
const { prepareQuoteEmailSnapshots, sendQuoteEmail, sendOrderConfirmation, sendOrderNotification } =
  await import('../src/netlify/functions/_lib/email.mjs');
const quoteHandler = (await import('../src/netlify/functions/quote-request.mjs')).default;
const scope = 'email.quote-notification';
const defaults = (key = scope) => Object.fromEntries(emailRegistry[key].fields.map((field) => [field.id, field.default]));
const lead = { id: 'offline-lead', firstName: '<Alex>', lastName: 'Example', email: 'customer@example.test',
  phone: '5415551234', service: 'board', description: '<project>', photos: ['https://example.test/photo.jpg'] };
const request = (action, more = {}, key = scope, preview = false) => new Request(
  'https://site.test/.netlify/functions/admin-email-content?page=' + key + (preview ? '&preview=1' : ''), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, schema: 'email-copy-v2', base: { revision: null, etag: null }, ...more }),
  });

test('safe email interpolation and header validation', () => {
  const rendered = renderEmailCopy(scope, { subject: 'Hello {{firstName}}', body: '<b>{{firstName}}</b> & {{service}}\n{{firstName}}' },
    { firstName: '<img src=x>\r\nBcc: private', service: '$& {{firstName}}' });
  assert.equal(rendered.subject, 'Hello <img src=x>  Bcc: private');
  assert.ok(rendered.html.includes('&lt;b&gt;&lt;img src=x&gt;'));
  assert.ok(rendered.html.includes('$&amp; {{firstName}}'));
  assert.ok(!rendered.html.includes('<img'));
  for (const subject of ['bad\r\nBcc: x', 'bad\tvalue', 'bad\u007f', 'bad\u2028value', '', 'x'.repeat(301)]) {
    assert.throws(() => renderEmailCopy(scope, { subject, body: '' }, {}), /Subject/);
  }
  for (const body of ['{{secret}}', '{{ firstName }}', '{{firstName.toUpperCase()}}', '{{firstName']) {
    assert.throws(() => renderEmailCopy(scope, { subject: 'Test', body }, {}), /variable|placeholder/);
  }
  assert.throws(() => renderEmailCopy(scope, { ...defaults(), to: 'attacker@example.test' }, {}), /Only subject/);
  assert.throws(() => renderEmailCopy(scope, { subject: '{{firstName}}'.repeat(7), body: '' }, {}), /header limit/);
  assert.throws(() => validateEmailHeaders({ subject: 'Test', headers: { 'X-Entity-Ref-ID': 'id\r\nBcc: x' } }), /header/);
});

test('email CMS authorization, private preview, CAS history and restores', async () => {
  const stores = [memoryStore(), memoryStore(), memoryStore()];
  const repository = createScopedContentRepository({
    registry: emailRegistry, drafts: () => stores[0], published: () => stores[1], publications: () => stores[2],
  });
  let user = { role: 'admin', email: 'editor@example.test' };
  const handler = createAdminEmailContentHandler({
    repository, requireSession: async () => user ? { user } : { error: new Response('unauthorized', { status: 401 }) },
  });
  user = null;
  assert.equal((await handler(request('save', { values: defaults() }))).status, 401);
  assert.equal((await handler(request('preview', { values: defaults() }, scope, true))).status, 401);
  user = { role: 'viewer' };
  assert.equal((await handler(request('save', { values: defaults() }))).status, 403);
  assert.equal((await handler(request('preview', { values: defaults() }, scope, true))).status, 403);
  assert.equal(stores[0].entries.size, 0);
  user = { role: 'admin', email: 'editor@example.test' };
  const values = { subject: 'Private {{firstName}}', body: '<img src=x> {{service}}' };
  const preview = await handler(request('preview', { values }, scope, true));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('cache-control'), 'private, no-store');
  assert.ok((await preview.json()).html.includes('&lt;img src=x&gt;'));
  assert.equal(deliveries.length, 0);
  assert.equal(stores[0].entries.size, 0);
  assert.equal((await handler(request('preview', { values: { ...values, body: '{{recipient}}' } }, scope, true))).status, 400);
  assert.equal((await handler(request('save', { values: { ...values, reply_to: 'x' } }))).status, 400);
  const first = await (await handler(request('save', { values }))).json();
  const second = await (await handler(request('save', { values: { ...values, subject: 'Second' } }))).json();
  assert.equal((await handler(request('publish', { revision: first.id, base: first.base }))).status, 200);
  assert.equal((await handler(request('publish', { revision: second.id, base: second.base }))).status, 409);
  assert.equal((await repository.history(scope)).length, 2);
  const restore = await (await handler(request('restore', { revision: second.id }))).json();
  assert.equal((await repository.getPublished(scope)).values.subject, values.subject);
  await repository.publish(scope, restore.id, restore.base, user.email);
  const publication = (await repository.publicationHistory(scope)).find((record) => record.sourceDraft === first.id);
  const restored = await repository.restorePublication(scope, publication.id, user.email);
  assert.equal(restored.values.subject, values.subject);
  assert.equal((await repository.getPublished(scope)).values.subject, 'Second');
  const competitors = await Promise.all([
    repository.save(scope, values, 'email-copy-v2', user.email, null, await repository.getPublished(scope)),
    repository.save(scope, { ...values, subject: 'Concurrent' }, 'email-copy-v2', user.email, null, await repository.getPublished(scope)),
  ]);
  const outcomes = await Promise.allSettled(competitors.map((draft) => repository.publish(scope, draft.id, draft.base, user.email)));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.status, 409);
  assert.equal((await createPublicContentHandler(repository)(new Request('https://site.test/?page=' + scope))).status, 404);
});

test('sending integration preserves locked details and immutable quote snapshot across publications/outages', async (t) => {
  const original = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'offline-test';
  const twilioSid = process.env.TWILIO_SID;
  delete process.env.TWILIO_SID;
  t.after(() => {
    if (original === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = original;
    if (twilioSid === undefined) delete process.env.TWILIO_SID;
    else process.env.TWILIO_SID = twilioSid;
    mock.restoreAll();
  });
  const publish = async (key, values) => sdkStore.setJSON(key, {
    id: randomUUID(), page: key, schema: 'email-copy-v2', values,
  });
  await publish(scope, { subject: 'Edited {{service}}', body: 'Welcome {{firstName}} <script>' });
  const snapshot = await prepareQuoteEmailSnapshots(lead, { service: 'Walnut & board', customerType: 'Private', deadline: 'No' });
  assert.equal(snapshot.notification.subject, 'Edited Walnut & board');
  assert.ok(snapshot.notification.html.includes('Welcome &lt;Alex&gt; &lt;script&gt;'));
  for (const detail of ['customer@example.test', '5415551234', '<project>', 'https://example.test/photo.jpg']) {
    assert.ok(snapshot.notification.text.includes(detail), detail);
  }
  assert.equal(snapshot.templates[scope].fallback, false);
  const before = structuredClone(snapshot);
  await publish(scope, { subject: 'Later edit', body: 'Later copy' });
  await sendQuoteEmail(snapshot.notification, 'quote-notification/offline-lead');
  assert.deepEqual(snapshot, before);
  assert.equal(deliveries.at(-1).message.subject, before.notification.subject);
  assert.equal(deliveries.at(-1).options.idempotencyKey, 'quote-notification/offline-lead');
  assert.ok(snapshot.acknowledgement.text.includes('3–5 business days'));
  const deliveryCount = deliveries.length;
  assert.equal((await sendQuoteEmail({ ...snapshot.notification, subject: 'Unsafe\r\nBcc: x' }, 'offline-invalid')).ok, false);
  assert.equal(deliveries.length, deliveryCount);
  await publish('email.quote-acknowledgement', { subject: 'Receipt {{firstName}}', body: 'Custom acknowledgement {{service}}' });
  const changedReceipt = await prepareQuoteEmailSnapshots(lead, { service: 'Walnut & board' });
  assert.equal(changedReceipt.acknowledgement.subject, 'Receipt <Alex>');
  assert.ok(changedReceipt.acknowledgement.text.includes('Custom acknowledgement Walnut & board'));
  assert.ok(changedReceipt.acknowledgement.html.includes('Custom acknowledgement Walnut &amp; board'));
  assert.ok(changedReceipt.notification.text.includes('Later copy'));
  assert.ok(changedReceipt.notification.html.includes('Later copy'));
  assert.ok(!changedReceipt.acknowledgement.text.includes('3–5 business days'));
  assert.ok(!changedReceipt.acknowledgement.html.includes('3–5 business days'));
  assert.ok(!changedReceipt.acknowledgement.html.includes('3&ndash;5'));
  for (const message of [changedReceipt.notification, changedReceipt.acknowledgement]) {
    assert.ok(!message.text.includes('Reply to this email to respond to'));
    assert.ok(!message.html.includes('Reply to this email to respond to'));
  }
  const quoteResponse = await quoteHandler(new Request('https://site.test/api/quote-request', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...lead, firstName: 'Alex', lastName: 'Example', service: 'cutting-board',
      customerType: 'new-private', city: 'Eugene', state: 'OR', hasDeadline: 'no' }),
  }));
  assert.equal(quoteResponse.status, 200);
  const persisted = await sdkStore.get((await quoteResponse.json()).id);
  assert.equal(persisted.quoteEmails.notification.subject, 'Later edit');
  assert.equal(persisted.quoteEmails.acknowledgement.subject, 'Receipt Alex');
  assert.deepEqual(deliveries.at(-1).message, persisted.quoteEmails.acknowledgement);
  const immutable = structuredClone(persisted.quoteEmails);
  await publish('email.quote-acknowledgement', { subject: 'Future receipt', body: 'Future copy' });
  assert.deepEqual(persisted.quoteEmails, immutable);
  for (const type of ['order-notification', 'order-confirmation']) {
    await publish('email.' + type, { subject: 'Edited #{{orderNumber}}', body: 'Hello {{customerName}} — {{total}}' });
  }
  const order = { id: 'cs_offline_123', customer_name: '<Alex>', customer_email: 'customer@example.test',
    customer_phone: '5415551234', amount_total: 2500, amount_subtotal: 2500, currency: 'usd', payment_status: 'paid',
    items: [{ description: '<Walnut board>', quantity: 1, amount_total: 2500 }] };
  assert.equal((await sendOrderNotification(order)).ok, true);
  assert.equal((await sendOrderConfirmation(order)).ok, true);
  for (const { message } of deliveries.slice(-2)) {
    assert.ok(message.subject.startsWith('Edited #'));
    assert.ok(message.html.includes('&lt;Alex&gt;'));
    assert.ok(message.html.includes('&lt;Walnut board&gt;'));
    assert.ok(message.text.includes('$25.00'));
    assert.ok(message.text.includes('Hello <Alex> — $25.00'));
    assert.ok(message.html.includes('Hello &lt;Alex&gt; — $25.00'));
    for (const removed of ['Thanks for your order from', 'In-stock goods ship in 3–7', "What's next", 'Questions? Reply to this email']) {
      assert.ok(!message.text.includes(removed), removed);
      assert.ok(!message.html.includes(removed), removed);
    }
  }
  for (const [type, send] of [['notification', sendOrderNotification], ['confirmation', sendOrderConfirmation]]) {
    const id = `cs_concurrent_${type}`;
    const beforeRace = deliveries.length;
    const outcomes = await Promise.all([
      send({ ...order, id, customer_name: 'One renderer' }),
      send({ ...order, id, customer_name: 'Another renderer' }),
    ]);
    assert.ok(outcomes.every((result) => result.ok));
    const attempts = deliveries.slice(beforeRace);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.deepEqual(attempts[0].message, (await sdkStore.get(`${id}/${type}`)).message);
    assert.equal(attempts[0].options.idempotencyKey, `order-${type}/${id}`);
  }
  const originalConfirmation = deliveries.find(({ message }) => message.headers['X-Entity-Ref-ID'] === order.id && message.tags.some((tag) => tag.value === 'order_confirmation'));
  assert.equal((await sendOrderConfirmation({ ...order, customer_email: null })).ok, true);
  assert.deepEqual(deliveries.at(-1), originalConfirmation);
  readFails = true;
  const logs = [];
  const logger = mock.method(console, 'error', (...args) => logs.push(args));
  const fallback = await readEmailCopy(scope);
  assert.equal(fallback.fallback, true);
  assert.ok(logs.flat().join(' ').includes('using built-in copy'));
  assert.ok(!JSON.stringify(logs).includes('private backend credentials'));
  assert.equal((await sendOrderNotification({ ...order, id: 'cs_outage' })).ok, true);
  assert.ok(deliveries.at(-1).message.subject.startsWith('New Studio 37 order'));
  const outageSnapshot = await prepareQuoteEmailSnapshots(lead);
  assert.equal(outageSnapshot.templates[scope].fallback, true);
  assert.ok(outageSnapshot.notification.text.includes('customer@example.test'));
  assert.deepEqual(snapshot, before);
  logger.mock.restore();
  readFails = false;
  const corruptLogger = mock.method(console, 'error', () => {});
  await publish(scope, { subject: 'Invalid\r\nheader', body: 'Bad persisted copy' });
  const corruptFallback = await readEmailCopy(scope);
  assert.equal(corruptFallback.fallback, true);
  assert.equal(corruptFallback.values.subject, defaults().subject);
  await sdkStore.setJSON(scope, { id: randomUUID(), page: scope, schema: 'email-copy-v1',
    values: { subject: 'Legacy subject', body: 'Legacy supplemental text' } });
  const legacyFallback = await readEmailCopy(scope);
  assert.equal(legacyFallback.fallback, true);
  assert.equal(legacyFallback.values.body, defaults().body);
  corruptLogger.mock.restore();
});

test('blank editable narratives remove old wording while retaining protected details in both formats', async () => {
  const { buildLeadNotification, buildLeadAcknowledgement } = await import('../src/netlify/functions/_lib/email.mjs');
  const blank = (key) => ({ values: { ...defaults(key), body: '' } });
  const notification = buildLeadNotification(lead, { service: 'Board' }, blank(scope));
  const receipt = buildLeadAcknowledgement(lead, { service: 'Board' }, blank('email.quote-acknowledgement'));
  for (const message of [notification, receipt]) {
    for (const removed of ['Hi ', 'Thanks for reaching out', '3–5 business days', 'If your project is time-sensitive', 'Reply to this email to respond to']) {
      assert.ok(!message.text.includes(removed), removed);
      assert.ok(!message.html.includes(removed), removed);
    }
    assert.ok(message.text.includes('Board'));
    assert.ok(message.html.includes('Board'));
    assert.ok(!message.html.includes('studio37-email-narrative'));
    assert.ok(!message.text.includes('studio37-email-narrative'));
  }
  assert.ok(notification.html.includes('https://example.test/photo.jpg'));
  assert.ok(notification.text.includes('https://example.test/photo.jpg'));
  assert.ok(receipt.html.includes('tel:+15415147720'));
  assert.ok(receipt.text.includes('(541) 514-7720'));
  const { defaultEmailCopy } = await import('../src/netlify/functions/_lib/email-content.mjs');
  assert.ok(defaultEmailCopy('email.order-confirmation').values.body.includes('In-stock goods ship in 3–7 business days'));
});
