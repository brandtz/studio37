import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const original = [
  { id: 'old', created_at: '2026-01-01', firstName: 'Old', photos: [] },
  { id: 'new', created_at: '2026-02-01', firstName: 'New', email: 'customer@example.test',
    phone: '5415551234', service: 'cutting-board', description: 'Custom board', customerType: 'new-private',
    city: 'Eugene', state: 'OR', hasDeadline: 'no', engravingAddon: true,
    photos: ['https://example.test/photo.jpg'],
    quoteEmails: { notification: { html: 'private snapshot' }, acknowledgement: { text: 'private receipt' } } },
  null,
];
let authorized = true;
let reads = 0;
mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    leadStore: () => ({
      list: async () => { reads++; return { blobs: original.map((_, i) => ({ key: String(i) })) }; },
      get: async (key) => original[Number(key)],
    }),
    json: (body, status = 200) => Response.json(body, { status }),
  },
});
mock.module(new URL('../src/netlify/functions/_lib/auth.mjs', import.meta.url), {
  namedExports: { requireSession: async () => authorized ? {} : { error: Response.json({ error: 'unauthorized' }, { status: 401 }) } },
});
const handler = (await import('../src/netlify/functions/admin-leads.mjs')).default;

test('admin lead response omits retry payloads without changing stored leads or access behavior', async (t) => {
  t.after(() => mock.restoreAll());
  const response = await handler(new Request('http://localhost/api/admin/leads'));
  assert.equal(response.status, 200);
  const { quoteEmails, ...expected } = original[1];
  assert.deepEqual(await response.json(), [expected, original[0]]);
  assert.equal(original[1].quoteEmails, quoteEmails);
  assert.equal(quoteEmails.notification.html, 'private snapshot');
  authorized = false;
  assert.equal((await handler(new Request('http://localhost/api/admin/leads'))).status, 401);
  authorized = true;
  assert.equal((await handler(new Request('http://localhost/api/admin/leads', { method: 'POST' }))).status, 405);
  assert.equal(reads, 1);
});
