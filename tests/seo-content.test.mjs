import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import seoSchema from '../src/assets/js/seo-schema.js';
import { createContentRepository, createAdminContentHandler, defaults, validateValues } from '../src/netlify/functions/_lib/content.mjs';
import { createPublicSeoHandler } from '../src/netlify/functions/public-seo.mjs';
import { config, handleSeo, renderMetadata } from '../src/netlify/edge-functions/seo.mjs';

function store() {
  const entries = new Map();
  const etag = (value) => '"' + createHash('sha256').update(JSON.stringify(value)).digest('hex') + '"';
  return {
    async get(key) { return structuredClone(entries.get(key) || null); },
    async getWithMetadata(key) {
      const value = entries.get(key);
      return value ? { data: structuredClone(value), etag: etag(value) } : null;
    },
    async setJSON(key, value, options = {}) {
      const old = entries.get(key);
      if ((options.onlyIfNew && old) || (options.onlyIfMatch && (!old || etag(old) !== options.onlyIfMatch))) return { modified: false };
      entries.set(key, structuredClone(value));
      return { modified: true, etag: etag(value) };
    },
    list({ prefix }) {
      return (async function* () { yield { blobs: [...entries.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })) }; })();
    },
  };
}
function setup() {
  const drafts = store(), published = store(), publications = store();
  const repository = createContentRepository({ drafts: () => drafts, published: () => published, publications: () => publications });
  const admin = createAdminContentHandler({ repository, requireSession: async () => ({ user: { role: 'admin', email: 'editor@example.test' } }) });
  const publicSeo = createPublicSeoHandler(repository);
  return { repository, admin, publicSeo };
}
const staticHtml = () => readFileSync('src/index.html', 'utf8');
const publicRequest = () => new Request('https://example.test/.netlify/functions/public-seo?page=seo-home');
const staticResponse = (body = staticHtml(), extra = {}) => new Response(body, {
  status: extra.status || 200,
  headers: { 'content-type': extra.type || 'text/html; charset=utf-8', 'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "default-src 'self'", 'etag': '"static"', 'cache-control': 'public, max-age=3600', ...extra.headers },
});
const edge = (request, response, fetcher) => handleSeo(request, { next: async () => response }, fetcher);

test('SEO draft remains private until publish and history restores only through a new publication', async () => {
  const { repository, admin, publicSeo } = setup();
  const payload = { ...defaults('seo-home'), title: '</title><script>alert("x")</script> & "Hello"', description: 'A "quote" & <tag>\nNext' };
  const request = (body) => new Request('https://example.test/.netlify/functions/admin-content?page=seo-home', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const savedResponse = await admin(request({ action: 'save', schema: seoSchema['seo-home'].schema, values: payload, base: { revision: null, etag: null } }));
  assert.equal(savedResponse.status, 201);
  const saved = await savedResponse.json();
  assert.deepEqual(await (await publicSeo(publicRequest())).json(), { revision: null, values: null });
  const fetchSeo = (url, options) => publicSeo(new Request(url, options));
  let html = await (await edge(new Request('https://example.test/'), staticResponse(), fetchSeo)).text();
  assert.equal(html, staticHtml());
  assert.equal((await admin(request({ action: 'publish', revision: saved.id, base: saved.base }))).status, 200);
  const current = await (await publicSeo(publicRequest())).json();
  assert.equal(current.values.title, payload.title);
  const rendered = await edge(new Request('https://example.test/?utm=x'), staticResponse(), fetchSeo);
  html = await rendered.text();
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;Hello&quot;<\/title>/);
  assert.match(html, /content="A &quot;quote&quot; &amp; &lt;tag&gt;&#10;Next"/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<link rel="canonical" href="https:\/\/studio37customdesigns.com\/"/);
  assert.equal(rendered.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(rendered.headers.get('content-security-policy'), "default-src 'self'");
  assert.equal(rendered.headers.get('cache-control'), 'no-store');
  assert.equal(rendered.headers.get('etag'), null);
  const restored = await repository.restore('seo-home', saved.id, 'editor');
  assert.equal((await repository.history('seo-home')).length, 2);
  assert.equal((await repository.publicationHistory('seo-home')).length, 1);
  assert.equal((await (await publicSeo(publicRequest())).json()).revision, current.revision);
  await repository.publish('seo-home', restored.id, restored.base, 'editor');
  assert.equal((await repository.publicationHistory('seo-home')).length, 2);
});

test('SEO endpoint rejects other scopes and unauthorized edits', async () => {
  const { repository, publicSeo } = setup();
  assert.equal((await publicSeo(new Request('https://example.test/?page=home'))).status, 404);
  assert.equal((await publicSeo(new Request('https://example.test/?page=seo-home', { method: 'POST' }))).status, 405);
  const handler = createAdminContentHandler({ repository, requireSession: async () => ({ user: { role: 'viewer' } }) });
  assert.equal((await handler(new Request('https://example.test/?page=seo-home'))).status, 403);
  await assert.rejects(repository.save('seo-home', { ...defaults('seo-home'), title: 'x'.repeat(301) }, 'seo-v1', 'editor'), /plain text/);
});

test('required text rejects whitespace while optional fields may remain empty', () => {
  const registry = { example: { schema: 'v1', fields: [
    { id: 'label', default: 'Image', requiredText: true },
    { id: 'help', default: '', requiredText: false },
  ] } };
  assert.throws(() => validateValues('example', { label: ' \n\t', help: '' }, 'v1', registry), /cannot be empty/);
  assert.deepEqual(validateValues('example', { label: '  Image  ', help: '' }, 'v1', registry), { label: '  Image  ', help: '' });
});

test('all configured page templates have replaceable metadata, without touching canonical links', () => {
  const decode = (text) => text.replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  for (const [scope, definition] of Object.entries(seoSchema)) {
    const path = definition.path === '/' ? 'src/index.html' : 'src' + definition.path + '.html';
    const html = readFileSync(path, 'utf8');
    const values = defaults(scope);
    const tag = (name, value) => html.match(new RegExp('<meta\\s+' + name + '="' + value + '"\\s+content="([^"]*)"'))?.[1];
    assert.equal(decode(html.match(/<title>(.*?)<\/title>/)[1]), values.title, scope);
    for (const [key, name, attribute] of [['description', 'name', 'description'], ['og-title', 'property', 'og:title'], ['og-description', 'property', 'og:description']]) {
      if (Object.hasOwn(values, key)) assert.equal(decode(tag(name, attribute)), values[key], scope);
    }
    const rendered = renderMetadata(html, values, definition.fields.map((field) => field.id));
    assert.ok(rendered, scope);
    assert.equal(rendered.match(/<link rel="canonical"[^>]*>/)?.[0], html.match(/<link rel="canonical"[^>]*>/)?.[0]);
    assert.equal(rendered.match(/<meta name="robots"[^>]*>/)?.[0], html.match(/<meta name="robots"[^>]*>/)?.[0]);
    assert.equal(config.path, '/*');
  }
  assert.equal(renderMetadata('<html><head><title>x</title></head></html>', defaults('seo-home')), null);
  assert.equal(renderMetadata(staticHtml(), { ...defaults('seo-home'), title: {} }), null);
  assert.equal(renderMetadata(staticHtml(), { ...defaults('seo-home'), extra: 'x' }), null);
});

test('non-HTML, redirects, range requests and storage failures preserve the downstream response', async () => {
  let calls = 0;
  const fail = async () => { calls++; throw new Error('offline'); };
  const request = (path = '/', options = {}) => new Request('https://example.test' + path, options);
  for (const response of [staticResponse('plain', { type: 'application/json' }), staticResponse('redirect', { status: 302, headers: { location: '/elsewhere' } })]) {
    assert.equal(await edge(request(), response, fail), response);
  }
  const range = staticResponse('part', { status: 206 });
  assert.equal(await edge(request('/', { headers: { range: 'bytes=0-3' } }), range, fail), range);
  const unknown = staticResponse();
  assert.equal(await edge(request('/missing'), unknown, fail), unknown);
  const nonSite404 = staticResponse('<html><head><title>Other 404</title></head></html>', { status: 404 });
  assert.equal(await edge(request('/missing'), nonSite404, fail), nonSite404);
  const fallback = await edge(request(), staticResponse(), fail);
  assert.equal(await fallback.text(), staticHtml());
  assert.equal(fallback.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 1);
  const encoded = staticResponse('encoded', { headers: { 'content-encoding': 'gzip', 'content-length': '7' } });
  const untouched = await edge(request(), encoded, fail);
  assert.equal(untouched.headers.get('content-encoding'), 'gzip');
  assert.equal(untouched.headers.get('content-length'), '7');
  assert.equal(await untouched.text(), 'encoded');
  assert.equal(calls, 1);
});

test('SEO middleware requests an uncompressed downstream response for transformation', async () => {
  let downstream;
  const original = new Request('https://example.test/', { headers: { 'accept-encoding': 'gzip, br', 'accept-language': 'en' } });
  const response = await handleSeo(original, {
    next: async (request) => { downstream = request; return staticResponse(); },
  }, async () => Response.json({ revision: null, values: null }));
  assert.equal(downstream.headers.get('accept-encoding'), 'identity');
  assert.equal(downstream.headers.get('accept-language'), 'en');
  assert.equal(await response.text(), staticHtml());
});

test('additional SEO scopes publish only existing metadata and retain status, robots and redirects', async () => {
  const { repository, publicSeo } = setup();
  const fetchSeo = (url, options) => publicSeo(new Request(url, options));
  const cases = [
    { scope: 'seo-product', path: '/shop/product?id=abc', file: 'src/shop/product.html', aliases: ['/shop/product.html'] },
    { scope: 'seo-404', path: '/missing-page', file: 'src/404.html', status: 404, aliases: ['/404', '/404.html'] },
    { scope: 'seo-order-confirmed', path: '/order/confirmed', file: 'src/order/confirmed.html', aliases: ['/order/confirmed.html'], robots: true },
    { scope: 'seo-stripe-onboarding-complete', path: '/stripe/onboarding-complete', file: 'src/stripe/onboarding-complete.html', aliases: ['/stripe/onboarding-complete.html'], robots: true },
  ];
  for (const item of cases) {
    const original = readFileSync(item.file, 'utf8');
    const values = { ...defaults(item.scope), title: 'Published <title> & "' + item.scope };
    if (values.description !== undefined) values.description = 'Description " & <tag>';
    if (values['og-title'] !== undefined) values['og-title'] = 'Shared <title>';
    const draft = await repository.save(item.scope, values, seoSchema[item.scope].schema, 'editor');
    const request = (path) => new Request('https://example.test' + path);
    const baseline = () => staticResponse(original, { status: item.status || 200 });
    const before = await edge(request(item.path), baseline(), fetchSeo);
    assert.equal(await before.text(), original, item.scope);
    assert.equal(before.status, item.status || 200);
    await repository.publish(item.scope, draft.id, draft.base, 'editor');
    for (const path of [item.path, ...item.aliases]) {
      const response = await edge(request(path), baseline(), fetchSeo);
      const html = await response.text();
      assert.equal(response.status, item.status || 200, path);
      assert.match(html, /<title>Published &lt;title&gt; &amp; &quot;seo-/);
      if (values.description !== undefined) assert.match(html, /content="Description &quot; &amp; &lt;tag&gt;"/);
      if (values['og-title'] !== undefined) assert.match(html, /property="og:title" content="Shared &lt;title&gt;"/);
      assert.equal(html.match(/<link rel="canonical"[^>]*>/)?.[0], original.match(/<link rel="canonical"[^>]*>/)?.[0]);
      assert.equal(html.match(/<meta name="robots"[^>]*>/)?.[0], original.match(/<meta name="robots"[^>]*>/)?.[0]);
      assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    if (item.robots) {
      const missingRobots = original.replace(/<meta name="robots"[^>]*>\s*/, '');
      const response = await edge(request(item.path), staticResponse(missingRobots), fetchSeo);
      assert.equal(await response.text(), missingRobots);
    }
    const redirect = staticResponse('redirect', { status: 302, headers: { location: '/elsewhere' } });
    assert.equal(await edge(request(item.path), redirect, fetchSeo), redirect);
  }
});

test('product-specific browser metadata wins over generic published fallback when data loads', async () => {
  const runProduct = async (subtitle) => {
    const root = { innerHTML: '', querySelectorAll: () => [] };
    const meta = { content: 'Generic fallback', setAttribute(name, value) { if (name === 'content') this.content = value; } };
    const document = {
      title: 'Generic fallback',
      getElementById(id) { return id === 'product-detail' ? root : null; },
      querySelector() { return meta; },
    };
    const context = {
      document, location: { search: '?id=one' }, URLSearchParams, window: {},
      Studio37ContentSchema: { 'dynamic-copy': { fields: [] } },
      Studio37Content: { loadScope: () => new Promise(() => {}) },
      fetch: async () => ({ ok: true, json: async () => ({ name: 'Walnut table', subtitle, status: 'available', price: 10000 }) }),
    };
    vm.runInNewContext(readFileSync('src/assets/js/product-detail.js', 'utf8'), context);
    await new Promise((resolve) => setImmediate(resolve));
    return { title: document.title, description: meta.content };
  };
  assert.deepEqual(await runProduct('One of a kind'), { title: 'Walnut table — Studio 37', description: 'One of a kind' });
  assert.deepEqual(await runProduct(''), { title: 'Walnut table — Studio 37', description: 'Generic fallback' });
});

test('crawler product metadata comes from the public product API with safe generic fallbacks', async () => {
  const { repository, publicSeo } = setup();
  const original = readFileSync('src/shop/product.html', 'utf8');
  const draft = await repository.save('seo-product', { title: 'Generic title', description: 'Generic description' }, 'seo-v1', 'editor');
  await repository.publish('seo-product', draft.id, draft.base, 'editor');
  let product = { id: 'item-1', name: 'Walnut <table>', subtitle: 'A "special" & piece' };
  let seoAvailable = true;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: new URL(url), options });
    if (url.pathname === '/.netlify/functions/public-seo') {
      return seoAvailable ? publicSeo(new Request(url, options)) : new Response('', { status: 503 });
    }
    if (url.pathname === '/.netlify/functions/products') {
      if (product === null) return new Response('', { status: 404 });
      return new Response(JSON.stringify(product), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected request');
  };
  const render = async (search = '?id=item-1') => {
    const response = await edge(new Request('https://example.test/shop/product' + search, { headers: { cookie: 'private=1' } }), staticResponse(original), fetcher);
    return response.text();
  };
  let html = await render();
  assert.match(html, /<title>Walnut &lt;table&gt; — Studio 37<\/title>/);
  assert.match(html, /content="A &quot;special&quot; &amp; piece"/);
  const productCall = calls.find(({ url }) => url.pathname.endsWith('/products'));
  assert.equal(productCall.url.search, '?id=item-1');
  assert.equal(productCall.options.headers, undefined);
  assert.equal(productCall.options.redirect, 'manual');
  product = { id: 'item-1', name: 'Table', subtitle: '' };
  html = await render();
  assert.match(html, /<title>Table — Studio 37<\/title>/);
  assert.match(html, /content="Generic description"/);
  for (const invalid of [null, { id: 'different', name: 'Wrong' }, { id: 'item-1', name: '  ' }, { id: 'item-1', name: 'x'.repeat(301) }]) {
    product = invalid;
    html = await render();
    assert.match(html, /<title>Generic title<\/title>/);
    assert.match(html, /content="Generic description"/);
  }
  seoAvailable = false;
  product = { id: 'item-1', name: 'Desk', subtitle: 'Solid walnut' };
  html = await render();
  assert.match(html, /<title>Desk — Studio 37<\/title>/);
  assert.match(html, /content="Solid walnut"/);
  product = null;
  assert.equal(await render(), original);
  calls.length = 0;
  await render('');
  assert.equal(calls.some(({ url }) => url.pathname.endsWith('/products')), false);
});

test('dynamic-copy uses a synthetic escaped private text preview without fetching a public page', async () => {
  const encode = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelectorAll() { return []; }
    removeAttribute() {}
    get outerHTML() { return '<' + this.tag + '>' + encode(this.textContent) + this.children.map((child) => child.outerHTML).join('') + '</' + this.tag + '>'; }
  }
  const nodes = new Map();
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    createElement(tag) { return new Element(tag); },
    implementation: { createHTMLDocument() {
      const body = new Element('body');
      return { body, createElement: (tag) => new Element(tag), get documentElement() { return { outerHTML: '<html>' + body.outerHTML + '</html>' }; } };
    } },
  };
  const field = { id: 'notice', label: 'Notice', default: 'Default', targets: [] };
  const dynamic = { label: 'Dynamic copy', path: '/', schema: 'dynamic-v1', fields: [field] };
  const window = {
    Studio37ContentSchema: { home: { label: 'Home', path: '/', schema: 'dynamic-v1', fields: [] }, 'dynamic-copy': dynamic },
    Studio37SeoSchema: {}, Studio37QuoteForm: { scope: 'quote-form', definition: { label: 'Quote', fields: [] } },
    Studio37EmailTemplates: { registry: {} },
  };
  const helpers = {
    markClean() {}, markDirty() {},
    async api() {
      return { schema: dynamic.schema, current: { values: { notice: '<img src=x onerror=alert(1)>' }, revision: null, etag: null }, history: [], publications: [], canPublish: true };
    },
  };
  vm.runInNewContext(readFileSync('src/assets/js/content-admin.js', 'utf8'), {
    window, document, fetch() { throw new Error('Synthetic preview must not fetch'); }, console,
  });
  const select = document.getElementById('content-page');
  await window.Studio37ContentAdmin.load(helpers);
  select.value = 'dynamic-copy';
  await select.events.change();
  await document.getElementById('content-preview').events.click();
  const frame = document.getElementById('content-preview-frame');
  assert.equal(frame.hidden, false);
  assert.match(frame.srcdoc, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(frame.srcdoc, /<img/);
});
