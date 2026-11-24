import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStore } from '@netlify/blobs';

// An atomic in-memory HTTP model exercises the REAL SDK's wire contract.
// It is not Netlify's production backend and cannot certify cloud atomicity.
function transport({ conflictStatus = 412, signed = false } = {}) {
  const entries = new Map();
  const requests = [];
  let generation = 0;
  let barrier = null;
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    const method = (options.method || 'GET').toUpperCase();
    const headers = new Headers(options.headers);
    requests.push({ url: url.toString(), method, headers });
    if (signed && url.hostname === 'api.test' && headers.get('accept')?.includes('signed-url')) {
      return Response.json({ url: 'https://signed.test' + url.pathname.replace('/api/v1/blobs', '') });
    }
    const key = url.pathname;
    if (method === 'PUT' && barrier) {
      const gate = barrier;
      gate.arrivals++;
      if (gate.arrivals === 2) { barrier = null; gate.release(); }
      await gate.promise;
    }
    const current = entries.get(key);
    if (method === 'GET') {
      if (url.pathname.split('/').filter(Boolean).length === 2) {
        return Response.json({
          blobs: Array.from(entries.entries()).filter(([path]) => path.startsWith(key + '/')).map(([path, value]) => ({
            key: path.slice(key.length + 1), etag: value.etag,
          })),
          directories: [],
        });
      }
      if (!current) return new Response(null, { status: 404 });
      return new Response(current.body, { headers: { etag: current.etag, 'content-type': 'application/json' } });
    }
    if (method === 'PUT') {
      if ((headers.get('if-none-match') === '*' && current) ||
          (headers.get('if-match') && headers.get('if-match') !== current?.etag)) {
        return new Response(null, { status: conflictStatus });
      }
      const etag = `"version-${++generation}"`;
      entries.set(key, { body: options.body, etag });
      return new Response(null, { status: 200, headers: { etag } });
    }
    if (method === 'DELETE') { entries.delete(key); return new Response(null, { status: 204 }); }
    throw new Error('Unexpected test request: ' + method);
  };
  return {
    fetch, requests, entries,
    overlapNextTwoWrites() {
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      barrier = { arrivals: 0, release, promise };
    },
  };
}
function options(backend, signed = false) {
  return {
    name: 'cms-contract-test', siteID: 'test-site', token: 'NOT-A-REAL-TOKEN', consistency: 'strong',
    fetch: backend.fetch,
    ...(signed ? { apiURL: 'https://api.test' } :
      { edgeURL: 'https://cached.test', uncachedEdgeURL: 'https://strong.test' }),
  };
}

test('installed SDK sends conditional setJSON headers and reports one winner in overlapping writes', async () => {
  const backend = transport();
  const firstClient = getStore(options(backend));
  const secondClient = getStore(options(backend));
  backend.overlapNextTwoWrites();
  const first = await Promise.all([
    firstClient.setJSON('home', { id: 'one' }, { onlyIfNew: true }),
    secondClient.setJSON('home', { id: 'two' }, { onlyIfNew: true }),
  ]);
  assert.equal(first.filter((result) => result.modified).length, 1);
  assert.ok(backend.requests.filter((request) => request.method === 'PUT').every((request) => request.headers.get('if-none-match') === '*'));
  const entry = await firstClient.getWithMetadata('home', { type: 'json', consistency: 'strong' });
  assert.ok(entry.etag);
  backend.overlapNextTwoWrites();
  const replacements = await Promise.all([
    firstClient.setJSON('home', { id: 'three' }, { onlyIfMatch: entry.etag }),
    secondClient.setJSON('home', { id: 'four' }, { onlyIfMatch: entry.etag }),
  ]);
  assert.equal(replacements.filter((result) => result.modified).length, 1);
  assert.ok(backend.requests.slice(-2).every((request) => request.headers.get('if-match') === entry.etag));
  assert.ok(backend.requests.every((request) => new URL(request.url).hostname === 'strong.test'));
});

test('409 concurrent conflicts become modified:false and conditions reach signed-URL writes too', async () => {
  const backend = transport({ conflictStatus: 409, signed: true });
  const store = getStore(options(backend, true));
  assert.equal((await store.setJSON('home', { id: 'first' }, { onlyIfNew: true })).modified, true);
  assert.deepEqual(await store.setJSON('home', { id: 'loser' }, { onlyIfNew: true }), { modified: false });
  const current = await store.getWithMetadata('home', { type: 'json' });
  assert.equal((await store.setJSON('home', { id: 'next' }, { onlyIfMatch: current.etag })).modified, true);
  assert.deepEqual(await store.setJSON('home', { id: 'stale' }, { onlyIfMatch: current.etag }), { modified: false });
  const writes = backend.requests.filter((request) => request.method === 'PUT' && new URL(request.url).hostname === 'signed.test');
  assert.equal(writes.length, 4); // No retries against a refreshed ETag or unconditional fallback.
  assert.equal(writes[0].headers.get('if-none-match'), '*');
  assert.equal(writes[2].headers.get('if-match'), current.etag);
});

test('v11 reads existing site-wide JSON and preserves unconditional write behavior', async () => {
  const backend = transport();
  for (const name of ['products', 'leads', 'reviews', 'users', 'categories', 'site_media',
    'rate_limits', 'site_settings', 'audit_log', 'tenants', 'orders', 'stripe_product_map']) {
    const definition = { ...options(backend), name };
    const oldPath = `/test-site/site:${name}/compatibility-key`;
    backend.entries.set(oldPath, { body: JSON.stringify({ preserved: name }), etag: '"legacy"' });
    const next = getStore(definition);
    assert.deepEqual(await next.get('compatibility-key', { type: 'json' }), { preserved: name });
    const readPath = new URL(backend.requests.at(-1).url).pathname;
    assert.equal(readPath, oldPath);
    const result = await next.setJSON('compatibility-key', { preserved: name });
    assert.equal(result.modified, true);
    assert.equal(backend.requests.at(-1).headers.get('if-match'), null);
    assert.equal(backend.requests.at(-1).headers.get('if-none-match'), null);
    assert.equal((await next.list()).blobs[0].key, 'compatibility-key');
    for await (const batch of next.list({ paginate: true })) assert.equal(batch.blobs[0].key, 'compatibility-key');
    await next.delete('compatibility-key');
    assert.equal(await next.get('compatibility-key', { type: 'json' }), null);
  }
});
