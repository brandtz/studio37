import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import schema from '../src/assets/js/content-schema.js';
import quoteForm from '../src/assets/js/quote-form-schema.js';
import { createQuoteFormReader } from '../src/netlify/functions/_lib/quote-form.mjs';
import { createPublishedContentReader } from '../src/netlify/functions/_lib/published-content.mjs';
import {
  createContentRepository, createScopedContentRepository, createAdminContentHandler, createPublicContentHandler,
  defaults, validateValues,
} from '../src/netlify/functions/_lib/content.mjs';

function memoryStore() {
  const entries = new Map();
  let reads = 0;
  let writes = 0;
  const etag = (key) => entries.has(key) ? '"' + createHash('sha256').update(JSON.stringify(entries.get(key))).digest('hex') + '"' : null;
  return {
    entries,
    get reads() { return reads; },
    get writes() { return writes; },
    async get(key) { reads++; return structuredClone(entries.get(key) || null); },
    async getWithMetadata(key) {
      reads++;
      return entries.has(key) ? { data: structuredClone(entries.get(key)), etag: etag(key), metadata: {} } : null;
    },
    async setJSON(key, value, options = {}) {
      writes++;
      if (options.onlyIfNew && entries.has(key)) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== etag(key)) return { modified: false };
      entries.set(key, structuredClone(value));
      return { modified: true, etag: etag(key) };
    },
    list({ prefix }) {
      return (async function* () {
        const blobs = Array.from(entries.keys()).filter((key) => key.startsWith(prefix)).map((key) => ({ key }));
        // Exercise all pages of the Blobs iterator, not just the first response.
        for (let index = 0; index < blobs.length; index += 1) yield { blobs: blobs.slice(index, index + 1) };
      })();
    },
  };
}
function setup(overrides = {}) {
  const drafts = memoryStore();
  const published = memoryStore();
  const publications = memoryStore();
  const repository = createContentRepository({ drafts: () => drafts, published: () => published, publications: () => publications, ...overrides });
  const handler = createAdminContentHandler({
    repository,
    requireSession: async () => ({ user: { email: 'editor@example.test', role: 'admin' } }),
  });
  return { drafts, published, publications, repository, handler };
}
function request(action, more = {}, page = 'home') {
  return new Request('https://site.test/.netlify/functions/admin-content?page=' + page, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, base: { revision: null, etag: null }, ...more }),
  });
}

test('generated allowlist stays in sync with public templates', () => {
  const result = execFileSync('python', ['scripts\\generate-content-schema.py', '--check'], { encoding: 'utf8' });
  assert.match(result, /Generated CMS schema:/);
});

test('cart text becomes public only after publication and is escaped when rendered', async () => {
  const { repository } = setup();
  const publicHandler = createPublicContentHandler(repository);
  const values = { ...defaults('cart'), empty: '<img src=x onerror=alert(1)>', browse: 'Find a piece' };
  const saved = await repository.save('cart', values, schema.cart.schema, 'admin');
  const publicRequest = () => new Request('https://site.test/.netlify/functions/public-content?page=cart');
  assert.deepEqual((await (await publicHandler(publicRequest())).json()).cart, {});
  await repository.publish('cart', saved.id, saved.base, 'admin');
  const publicCopy = (await (await publicHandler(publicRequest())).json()).cart;
  assert.equal(publicCopy.empty, values.empty);

  const body = { innerHTML: '' };
  const foot = { innerHTML: '' };
  const closeButton = { addEventListener() {}, setAttribute() {} };
  const heading = { textContent: '' };
  const drawer = {
    classList: { contains: () => false, add() {}, remove() {} },
    setAttribute() {},
    querySelector(selector) {
      return { '[data-cart-body]': body, '[data-cart-foot]': foot, '.cart-close': closeButton, '.cart-head h2': heading }[selector];
    },
  };
  let boot;
  let count = 0;
  const document = {
    readyState: 'loading',
    body: { appendChild() {}, style: {} },
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') boot = callback; },
    createElement() { return count++ === 0 ? { classList: { add() {}, remove() {} }, addEventListener() {} } : drawer; },
    querySelectorAll() { return []; },
  };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const window = { addEventListener() {}, location: { search: '' } };
  const context = {
    window, document, localStorage: storage, sessionStorage: storage, URLSearchParams,
    Studio37ContentSchema: schema, requestAnimationFrame() {},
    fetch: async (url) => ({ ok: true, json: async () => url.includes('public-content') ? { cart: publicCopy } : {} }),
    console, setTimeout,
  };
  vm.runInNewContext(readFileSync('src/assets/js/cart.js', 'utf8'), context);
  window.Studio37Cart.open();
  boot();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(body.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(body.innerHTML, /<img src=x/);
  assert.match(body.innerHTML, /Find a piece/);
});

test('text validation rejects unknown fields, stale templates, nontext, and oversized content', () => {
  const original = defaults('home');
  assert.throws(() => validateValues('home', { ...original, injected: '<script>' }, schema.home.schema), /listed page text/);
  assert.throws(() => validateValues('home', original, 'stale'), /template changed/);
  assert.throws(() => validateValues('home', { ...original, 'text-001': {} }, schema.home.schema), /plain text/);
  assert.throws(() => validateValues('home', { ...original, 'text-001': 'x'.repeat(4001) }, schema.home.schema), /4,000/);
  assert.throws(() => validateValues('home', { ...original, 'text-001': 'unsafe\0' }, schema.home.schema), /control/);
  assert.throws(() => defaults('__proto__'), /Unknown/);
});

test('unauthenticated and non-admin requests do not touch content storage', async () => {
  const { repository, drafts, published } = setup();
  const unauthorized = createAdminContentHandler({
    repository, requireSession: async () => ({ error: new Response('unauthorized', { status: 401 }) }),
  });
  assert.equal((await unauthorized(request('save'))).status, 401);
  const forbidden = createAdminContentHandler({
    repository, requireSession: async () => ({ user: { role: 'viewer', email: 'viewer@example.test' } }),
  });
  assert.equal((await forbidden(request('save'))).status, 403);
  assert.equal(drafts.reads + drafts.writes + published.reads + published.writes, 0);
});

test('save drafts persist exact text with private no-store responses and never mutate published content', async () => {
  const { handler, drafts, published } = setup();
  const values = { ...defaults('home'), 'text-001': '<img src=x onerror=alert(1)> & "quoted"' };
  const result = await handler(request('save', { values, schema: schema.home.schema }));
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  const saved = await result.json();
  assert.deepEqual(drafts.entries.get('home/' + saved.id).values, values);
  assert.equal(saved.actor, 'editor@example.test');
  assert.equal(published.writes, 0);
});

test('concurrent draft saves preserve independent revisions and all paginated history', async () => {
  const { repository, drafts } = setup();
  const original = defaults('home');
  const records = await Promise.all([
    repository.save('home', { ...original, 'text-001': 'Editor one' }, schema.home.schema, 'one@example.test'),
    repository.save('home', { ...original, 'text-001': 'Editor two' }, schema.home.schema, 'two@example.test'),
  ]);
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(drafts.entries.size, 2);
  assert.equal((await repository.history('home')).length, 2);
});

test('quote presentation inherits old published labels without reading drafts or overwriting contact data', async () => {
  const { repository, drafts, published } = setup();
  const quoteField = quoteForm.definition.fields.find((field) => field.targets.length && field.default === 'First name');
  const old = { id: 'old-contact', schema: schema.contact.schema, values: { ...defaults('contact'), [quoteField.id]: 'Given name' } };
  published.entries.set('contact', old);
  const draft = await repository.save('quote-form', { ...quoteForm.defaults(), [quoteField.id]: 'PRIVATE' }, quoteForm.definition.schema, 'admin');
  const reads = drafts.reads;
  const current = await createQuoteFormReader(repository)();
  assert.equal(current.values[quoteField.id], 'Given name');
  assert.equal(current.revision, 'contact-old-contact');
  assert.equal(drafts.reads, reads);
  const base = await repository.getPublished('quote-form');
  assert.deepEqual([base.revision, base.etag], [null, null]);
  const saved = await repository.save('quote-form', base.values, base.schema, 'admin', null, base);
  await repository.publish('quote-form', saved.id, saved.base, 'admin');
  assert.equal((await createQuoteFormReader(repository)()).values[quoteField.id], 'Given name');
  assert.deepEqual(published.entries.get('contact'), old);
  assert.equal((await repository.getDraft('quote-form', draft.id)).values[quoteField.id], 'PRIVATE');
});

test('quote choice edits are private until one CAS winner publishes; restore never rewrites history', async () => {
  const { repository } = setup();
  const first = { ...quoteForm.defaults(), 'choices-service': JSON.stringify([{ id: 'new-chair', label: 'Custom chair', group: 'custom-orders' }]) };
  const second = { ...quoteForm.defaults(), 'choices-service': JSON.stringify([{ id: 'new-desk', label: 'Custom desk', group: 'custom-orders' }]) };
  const a = await repository.save('quote-form', first, quoteForm.definition.schema, 'a');
  const b = await repository.save('quote-form', second, quoteForm.definition.schema, 'b');
  assert.equal((await createQuoteFormReader(repository)()).revision, null);
  const outcomes = await Promise.allSettled([
    repository.publish('quote-form', a.id, a.base, 'a'), repository.publish('quote-form', b.id, b.base, 'b'),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((result) => result.status === 'rejected').reason.status, 409);
  const current = await repository.getPublished('quote-form');
  const restored = await repository.restorePublication('quote-form', current.revision, 'c');
  assert.deepEqual(restored.values, current.values);
  assert.deepEqual(await repository.getPublished('quote-form'), current);
  assert.equal((await repository.history('quote-form')).length, 3);
  assert.equal((await repository.publicationHistory('quote-form')).length, 1);
});

test('quote schemas reject invalid/duplicate choice IDs, unavailable services and field-structure changes', () => {
  for (const rows of [
    [], [{ id: 'outdoor-sauna', label: 'Unavailable', group: 'custom-orders' }],
    [{ id: 'custom-offer', label: 'Outdoor Sauna', group: 'custom-orders' }],
    [{ id: '../escape', label: 'Bad ID', group: 'custom-orders' }],
    [{ id: 'test', label: 'Duplicate', group: 'custom-orders' }, { id: 'test', label: 'Another', group: 'custom-orders' }],
    [{ id: 'test', label: 'Duplicate', group: 'custom-orders' }, { id: 'another', label: 'duplicate', group: 'custom-orders' }],
    [{ id: 'test', label: 'Name', group: 'invented' }],
    [{ id: 'test', label: 'Name', group: 'custom-orders', required: false }],
  ]) {
    assert.throws(() => validateValues('quote-form', { ...quoteForm.defaults(), 'choices-service': JSON.stringify(rows) }, quoteForm.definition.schema));
  }
  assert.throws(() => validateValues('quote-form', { ...quoteForm.defaults(), required: 'false' }, quoteForm.definition.schema), /listed/);
  assert.throws(() => validateValues('quote-form', { ...quoteForm.defaults(), submit: '' }, quoteForm.definition.schema), /cannot be empty/);
});

test('quote text hydration retains inline whitespace around editable fragments', () => {
  const field = quoteForm.definition.fields.find((entry) => entry.default === 'First name');
  const node = { nodeType: 3, nodeValue: ' \n First name \n  ' };
  const documentRoot = {
    querySelectorAll: (selector) => selector === field.targets[0].selector ? [{ childNodes: [node] }] : [],
    getElementById: () => null,
  };
  quoteForm.apply({ ...quoteForm.defaults(), [field.id]: '<b>Given name</b>' }, documentRoot);
  assert.equal(node.nodeValue, ' \n <b>Given name</b> \n  ');
});

test('server registry reuses CAS/history and authenticated handler without widening the public allowlist', async () => {
  const stores = [memoryStore(), memoryStore(), memoryStore()];
  const registry = { 'email.private': {
    schema: 'email-v1', defaults: { subject: 'Hello', body: 'Private body' },
    validate(values) { if (/[\r\n]/.test(values.subject)) throw new Error('No subject newlines.'); },
  }, 'email.long': {
    schema: 'email-long-v1', fields: [{ id: 'subject', default: 'Hello', maxLength: 160 }, { id: 'body', default: 'Body', maxLength: 8000 }],
  } };
  const repository = createScopedContentRepository({ registry, drafts: () => stores[0], published: () => stores[1], publications: () => stores[2] });
  const handler = createAdminContentHandler({ repository, requireSession: async () => ({ user: { role: 'admin', email: 'admin' } }) });
  const savedResponse = await handler(request('save', { schema: 'email-v1', values: { subject: 'New subject', body: 'PRIVATE' } }, 'email.private'));
  assert.equal(savedResponse.status, 201);
  const draft = await savedResponse.json();
  await repository.publish('email.private', draft.id, draft.base, 'admin');
  assert.equal((await repository.getPublished('email.private')).values.body, 'PRIVATE');
  assert.equal((await repository.publicationHistory('email.private')).length, 1);
  assert.equal((await repository.restorePublication('email.private', (await repository.getPublished('email.private')).revision, 'admin')).values.body, 'PRIVATE');
  await assert.rejects(repository.save('email.private', { subject: 'Bad\nheader', body: 'x' }, 'email-v1', 'admin'), /subject newlines/);
  await assert.rejects(repository.getPublished('../email.private'), /Unknown/);
  const response = await createPublicContentHandler(repository)(new Request('https://site.test/?page=email.private'));
  assert.equal(response.status, 404);
  assert.equal((await createPublicContentHandler()(new Request('https://site.test/?page=saunas'))).status, 404);
  const long = await repository.save('email.long', { subject: 'Hello', body: 'x'.repeat(6000) }, 'email-long-v1', 'admin');
  await repository.publish('email.long', long.id, long.base, 'admin');
  assert.equal((await repository.getPublished('email.long')).values.body.length, 6000);
  await assert.rejects(repository.save('email.long', { subject: 'x'.repeat(161), body: 'Body' }, 'email-long-v1', 'admin'), /length limit/);
});

test('restore creates a new private draft and retains its original and attribution', async () => {
  const { repository, drafts, published } = setup();
  const original = await repository.save('home', defaults('home'), schema.home.schema, 'first@example.test');
  const restored = await repository.restore('home', original.id, 'second@example.test');
  assert.notEqual(restored.id, original.id);
  assert.equal(restored.restoredFrom, original.id);
  assert.equal(restored.actor, 'second@example.test');
  assert.deepEqual(restored.values, original.values);
  assert.deepEqual(drafts.entries.get('home/' + original.id), original);
  assert.equal(published.writes, 0);
  await assert.rejects(repository.restore('about', original.id, 'second@example.test'), /not found/);
});

test('old-template revisions cannot be silently restored over changed markup', async () => {
  const { repository, drafts } = setup();
  const original = await repository.save('home', defaults('home'), schema.home.schema, 'first@example.test');
  drafts.entries.get('home/' + original.id).schema = 'obsolete';
  await assert.rejects(repository.restore('home', original.id, 'second@example.test'), /template changed/);
  assert.equal(drafts.entries.size, 1);
});

test('public API only reads published storage even when private drafts exist', async () => {
  const { repository, drafts, published } = setup();
  await repository.save('home', { ...defaults('home'), 'text-001': 'SECRET DRAFT' }, schema.home.schema, 'editor@example.test');
  const draftReads = drafts.reads;
  const publicHandler = createPublicContentHandler(repository);
  const result = await publicHandler(new Request('https://site.test/.netlify/functions/public-content?page=home&revision=anything'));
  assert.deepEqual(await result.json(), { shared: {}, home: {} });
  assert.equal(drafts.reads, draftReads);
  published.entries.set('home', { id: 'migration-revision', schema: schema.home.schema, values: defaults('home') });
  const next = await publicHandler(new Request('https://site.test/.netlify/functions/public-content?page=home'));
  assert.deepEqual((await next.json()).home, defaults('home'));
  assert.equal(drafts.reads, draftReads);
});

test('initial concurrent publications have one CAS winner and never commit losing attempts into history', async () => {
  const { handler, repository, published, publications } = setup();
  const original = defaults('home');
  const records = await Promise.all(['First', 'Second'].map((text) =>
    repository.save('home', { ...original, 'text-001': text }, schema.home.schema, 'editor@example.test')));
  const results = await Promise.all(records.map((record) => handler(request('publish', { revision: record.id, base: record.base }))));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const current = await repository.getPublished('home');
  assert.ok(records.some((record) => record.values['text-001'] === current.values['text-001']));
  assert.equal(published.entries.size, 1);
  assert.equal((await repository.publicationHistory('home')).length, 1);
  // A losing candidate may remain as an unreferenced private archive, not committed history.
  assert.ok(publications.entries.size >= 1);
  const losing = records.find((record) => record.id !== published.entries.get('home').sourceDraft);
  assert.ok(await repository.getDraft('home', losing.id));
});

test('replacement publishing uses the original strong ETag and rejects stale or tampered bases', async () => {
  const { repository } = setup();
  const first = await repository.save('home', defaults('home'), schema.home.schema, 'first@example.test');
  await repository.publish('home', first.id, first.base, 'first@example.test');
  const base = await repository.getPublished('home');
  const records = await Promise.all(['One', 'Two'].map((text) =>
    repository.save('home', { ...base.values, 'text-001': text }, schema.home.schema, 'editor@example.test', null, base)));
  const results = await Promise.allSettled(records.map((record) => repository.publish('home', record.id, record.base, 'editor@example.test')));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.status, 409);
  const latest = await repository.getPublished('home');
  assert.notEqual(latest.etag, base.etag);
  assert.equal((await repository.publicationHistory('home')).length, 2);
  await assert.rejects(repository.publish('home', records[0].id, latest, 'editor@example.test'), /original base/);
  await assert.rejects(repository.publish('home', first.id, first.base, 'editor@example.test'), /Content changed/);
});

test('restore a committed publication keeps history and makes a new private draft on the current base', async () => {
  const { repository } = setup();
  const first = await repository.save('home', defaults('home'), schema.home.schema, 'first@example.test');
  const publication = await repository.publish('home', first.id, first.base, 'first@example.test');
  const current = await repository.getPublished('home');
  const next = await repository.save('home', { ...current.values, 'text-001': 'New version' }, schema.home.schema, 'second@example.test', null, current);
  await repository.publish('home', next.id, next.base, 'second@example.test');
  const latest = await repository.getPublished('home');
  const restored = await repository.restorePublication('home', publication.revision, 'restorer@example.test');
  assert.equal(restored.base.revision, latest.revision);
  assert.deepEqual(restored.values, first.values);
  assert.equal((await repository.getPublished('home')).revision, latest.revision);
  await repository.publish('home', restored.id, restored.base, 'restorer@example.test');
  assert.equal((await repository.publicationHistory('home')).length, 3);
});

test('failed archive writes prevent publishing and uncommitted candidates cannot be restored', async () => {
  const broken = setup({ publications: () => ({ setJSON: async () => { throw new Error('history unavailable'); } }) });
  const draft = await broken.repository.save('home', defaults('home'), schema.home.schema, 'editor@example.test');
  await assert.rejects(broken.repository.publish('home', draft.id, draft.base, 'editor@example.test'), /history unavailable/);
  assert.equal(broken.published.writes, 0);
  const { repository, publications } = setup();
  publications.entries.set('home/orphan', { id: 'orphan', values: defaults('home'), schema: schema.home.schema });
  await assert.rejects(repository.restorePublication('home', 'orphan', 'editor@example.test'), /not found/);
});

test('a legacy draft without a base and a backend without conditional results cannot silently publish', async () => {
  const { repository, drafts, published } = setup();
  const draft = await repository.save('home', defaults('home'), schema.home.schema, 'editor@example.test');
  delete drafts.entries.get('home/' + draft.id).base;
  await assert.rejects(repository.publish('home', draft.id, draft.base, 'editor@example.test'), /legacy draft/);
  assert.equal(published.writes, 0);
  const incompatible = setup({ publications: () => ({ setJSON: async () => undefined }) });
  const next = await incompatible.repository.save('home', defaults('home'), schema.home.schema, 'editor@example.test');
  await assert.rejects(incompatible.repository.publish('home', next.id, next.base, 'editor@example.test'), /Conditional-write result/);
  assert.equal(incompatible.published.writes, 0);
});

test('lost successful write response is confirmed without rebasing or an unconditional retry', async () => {
  const { repository, published } = setup();
  const draft = await repository.save('home', defaults('home'), schema.home.schema, 'editor@example.test');
  const write = published.setJSON;
  published.setJSON = async (...args) => { await write(...args); return { modified: false }; };
  const result = await repository.publish('home', draft.id, draft.base, 'editor@example.test');
  assert.equal(result.revision, (await repository.getPublished('home')).revision);
  assert.equal(published.writes, 1);
});

test('compatible legacy published snapshots are archived without rewriting their data', async () => {
  const { repository, published, publications } = setup();
  const legacy = { id: 'legacy-publication', schema: schema.home.schema, values: defaults('home') };
  published.entries.set('home', structuredClone(legacy));
  const base = await repository.getPublished('home');
  const draft = await repository.save('home', { ...base.values, 'text-001': 'Updated' }, schema.home.schema, 'editor@example.test', null, base);
  await repository.publish('home', draft.id, draft.base, 'editor@example.test');
  assert.deepEqual(publications.entries.get('home/legacy-publication'), legacy);
  assert.equal((await repository.publicationHistory('home')).length, 2);
});

test('missing/weak storage ETags and missing parent history stop publication before a head write', async () => {
  for (const etag of [undefined, 'W/"weak"']) {
    const { repository, published } = setup();
    published.entries.set('home', { id: 'legacy-publication', schema: schema.home.schema, values: defaults('home') });
    const read = published.getWithMetadata;
    published.getWithMetadata = async (...args) => ({ ...await read(...args), etag });
    await assert.rejects(repository.getPublished('home'), /strong ETag/);
    assert.equal(published.writes, 0);
  }
  const { repository, published } = setup();
  published.entries.set('home', { id: 'legacy-publication', parentRevision: 'missing', schema: schema.home.schema, values: defaults('home') });
  const base = await repository.getPublished('home');
  const draft = await repository.save('home', defaults('home'), schema.home.schema, 'editor@example.test', null, base);
  await assert.rejects(repository.publish('home', draft.id, draft.base, 'editor@example.test'), /history is incomplete/);
  assert.equal(published.writes, 0);
});

test('server-only published reader can register private email scopes without exposing them publicly', async () => {
  const store = memoryStore();
  const scope = 'email.quote-ack';
  const definitions = {
    [scope]: {
      schema: 'email-v1',
      defaults: { subject: 'Default subject', body: 'Default body' },
      validate: (values) => { if (/[\r\n]/.test(values.subject)) throw new Error('Invalid email subject'); },
    },
  };
  const reader = createPublishedContentReader({ definitions, store: () => store });
  assert.deepEqual((await reader(scope)).values, definitions[scope].defaults);
  store.entries.set(scope, { id: 'published-template', schema: 'email-v1', values: { subject: 'Subject', body: 'Body' } });
  const template = await reader(scope);
  assert.equal(template.revision, 'published-template');
  assert.equal(template.schema, 'email-v1');
  assert.ok(template.etag);
  assert.deepEqual(template.values, { subject: 'Subject', body: 'Body' });
  store.entries.get(scope).values.subject = 'Subject\r\nInjected: header';
  await assert.rejects(reader(scope), /Invalid email subject/);
  await assert.rejects(reader('email.unknown'), /Unknown/);
  const publicHandler = createPublicContentHandler(setup().repository);
  assert.equal((await publicHandler(new Request('https://site.test/.netlify/functions/public-content?page=' + scope))).status, 404);
  assert.equal(store.writes, 0);
});

test('storage errors are never reported as successful draft saves', async () => {
  const { handler } = setup({ drafts: () => ({ setJSON: async () => { throw new Error('storage failure'); } }) });
  const result = await handler(request('save', { values: defaults('home'), schema: schema.home.schema }));
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /No successful change/);
});

test('malformed bodies and methods cannot write drafts', async () => {
  const { handler, drafts } = setup();
  const url = 'https://site.test/.netlify/functions/admin-content?page=home';
  assert.equal((await handler(new Request(url, { method: 'DELETE' }))).status, 405);
  assert.equal((await handler(new Request(url, { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handler(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  }))).status, 400);
  assert.equal((await handler(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(180001),
  }))).status, 413);
  assert.equal(drafts.writes, 0);
});

test('hydration replaces only allowlisted text nodes, preserving layout and making markup inert', () => {
  const first = { nodeType: 3, nodeValue: '\n  Crafted' };
  const lineBreak = { nodeType: 1, tagName: 'BR' };
  const second = { nodeType: 3, nodeValue: 'by Hand.  \n' };
  const element = { childNodes: [first, lineBreak, second] };
  const context = {
    document: { documentElement: { dataset: { page: 'admin-dashboard' } } },
    Studio37ContentSchema: {
      sample: { fields: [{ id: 'title', targets: [{ selector: '#heading', text: 1 }] }] },
    },
  };
  vm.runInNewContext(readFileSync(new URL('../src/assets/js/content.js', import.meta.url), 'utf8'), context);
  context.Studio37Content.apply('sample', { title: '<script>alert(1)</script>', unknown: 'ignored' }, {
    querySelectorAll: (selector) => { assert.equal(selector, '#heading'); return [element]; },
  });
  assert.equal(first.nodeValue, '\n  Crafted');
  assert.equal(second.nodeValue, '<script>alert(1)</script>  \n');
  assert.equal(element.childNodes[1], lineBreak);
});

test('portfolio captions and image descriptions hydrate as attributes, not markup', () => {
  const fields = schema.portfolio.fields.filter((field) => ['data-caption', 'alt'].includes(field.targets[0].attribute));
  assert.ok(fields.some((field) => field.targets[0].attribute === 'data-caption'));
  assert.ok(fields.some((field) => field.targets[0].attribute === 'alt'));
  const elements = new Map(fields.map((field) => [field.targets[0].selector, {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }]));
  const context = {
    document: { documentElement: { dataset: { page: 'admin-dashboard' } } },
    Studio37ContentSchema: schema,
  };
  vm.runInNewContext(readFileSync(new URL('../src/assets/js/content.js', import.meta.url), 'utf8'), context);
  const values = Object.fromEntries(fields.map((field) => [field.id, '<b>Edited description</b>']));
  context.Studio37Content.apply('portfolio', values, {
    querySelectorAll: (selector) => elements.has(selector) ? [elements.get(selector)] : [],
  });
  for (const field of fields) {
    assert.equal(elements.get(field.targets[0].selector).attributes[field.targets[0].attribute], '<b>Edited description</b>');
  }
});

test('dynamic storefront copy uses published text and falls back explicitly on read failure', async () => {
  let requests = 0;
  const context = {
    document: { documentElement: { dataset: { page: 'admin-dashboard' } } },
    Studio37ContentSchema: schema,
    fetch: async () => {
      requests++;
      return { ok: true, json: async () => ({ 'dynamic-copy': { 'shop-add': 'Buy this' } }) };
    },
    console,
  };
  vm.runInNewContext(readFileSync(new URL('../src/assets/js/content.js', import.meta.url), 'utf8'), context);
  const [first, second] = await Promise.all([
    context.Studio37Content.loadScope('dynamic-copy'), context.Studio37Content.loadScope('dynamic-copy'),
  ]);
  assert.equal(first['shop-add'], 'Buy this');
  assert.equal(second['shop-empty'], defaults('dynamic-copy')['shop-empty']);
  assert.equal(requests, 1);
  await assert.rejects(context.Studio37Content.loadScope('unknown'), /Unknown content scope/);

  context.fetch = async () => ({ ok: false, status: 503 });
  context.console = { warn() {} };
  const fallback = await context.Studio37Content.loadScope('cart');
  assert.equal(fallback.title, defaults('cart').title);
});
