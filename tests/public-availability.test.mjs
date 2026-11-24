import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isUnavailableOffering } from '../src/netlify/functions/_lib/public-availability.mjs';

let seedFails = false;
const records = new Map();
let writes = 0;
const store = {
  list: async () => ({ blobs: Array.from(records.keys()).map((key) => ({ key })) }),
  get: async (key) => structuredClone(records.get(key) || null),
  setJSON: async () => { writes++; },
};
mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    ensureProductSeeded: async () => { if (seedFails) throw new Error('test outage'); },
    ensureCategorySeeded: async () => {},
    productStore: () => store, categoryStore: () => store, siteMediaStore: () => store,
    json: (value, status = 200, headers = {}) => Response.json(value, { status, headers }),
  },
});
const products = (await import('../src/netlify/functions/products.mjs')).default;
const categories = (await import('../src/netlify/functions/categories.mjs')).default;
const media = (await import('../src/netlify/functions/site-media.mjs')).default;

test('public catalog filters unavailable products in list, detail and seed fallback without changing stored records', async () => {
  records.set('old-kit', { id: 'old-kit', name: 'Cedar Sauna Kit', category: 'saunas', status: 'by_request' });
  records.set('custom-name', { id: 'custom-name', name: 'Outdoor SAUNA', category: 'custom', status: 'available' });
  records.set('board', { id: 'board', name: 'Cutting board', category: 'small-goods', status: 'available' });
  const before = structuredClone(records);
  const request = (id = '') => new Request('https://site.test/api/products' + (id ? '?id=' + id : ''));
  assert.deepEqual((await (await products(request())).json()).map((row) => row.id), ['board']);
  assert.equal((await products(request('old-kit'))).status, 404);
  assert.equal((await products(request('custom-name'))).status, 404);
  assert.equal((await products(request('board'))).status, 200);
  records.delete('board');
  assert.deepEqual(await (await products(request())).json(), []);
  records.set('board', before.get('board'));
  seedFails = true;
  const fallback = await (await products(request())).json();
  assert.ok(fallback.length > 0);
  assert.ok(fallback.every((product) => !isUnavailableOffering(product)));
  assert.equal((await products(request('sauna-4'))).status, 404);
  seedFails = false;
  assert.deepEqual(records, before);
  assert.equal(writes, 0);
});

test('public categories and media hide unavailable slots while preserving historical data', async () => {
  records.clear();
  records.set('saunas', { id: 'saunas', name: 'Saunas', archived: false });
  records.set('small-goods', { id: 'small-goods', name: 'Small goods', archived: false });
  assert.deepEqual((await (await categories()).json()).map((row) => row.id), ['small-goods']);
  records.clear();
  records.set('saunas.hero', { url: 'https://example.test/private-kit.jpg', alt: 'Sauna' });
  records.set('home.hero', { url: 'https://example.test/home.jpg', alt: 'Workshop' });
  const before = structuredClone(records);
  assert.deepEqual(await (await media()).json(), { 'home.hero': before.get('home.hero') });
  assert.deepEqual(records, before);
  assert.equal(writes, 0);
});

test('public pages and metadata do not promote unavailable offerings; the historical template is server-only', () => {
  for (const file of ['index.html', 'services.html', 'contact.html', 'saunas.html']) {
    const html = readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /\bsaunas?\b/i, file);
  }
  assert.match(readFileSync(new URL('../src/saunas.html', import.meta.url), 'utf8'), /noindex,nofollow/);
  assert.match(readFileSync(new URL('../src/netlify/functions/_lib/saunas.archived.html', import.meta.url), 'utf8'), /Cedar Sauna Kits/);
});
