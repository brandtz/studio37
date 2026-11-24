import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const state = new Map();
const leads = new Map();
let sends = [];
let outcomes = {};
let failWrite = '';

mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    quoteEmailStore: () => ({
      get: async (key) => state.get(key) || null,
      setJSON: async (key, value) => {
        if (key.endsWith(failWrite) && failWrite) throw new Error('test storage failure');
        state.set(key, value);
      },
    }),
    leadStore: () => ({
      list: async () => ({ blobs: [...leads.keys()].map((key) => ({ key })) }),
      get: async (key) => leads.get(key),
    }),
  },
});
mock.module(new URL('../src/netlify/functions/_lib/email.mjs', import.meta.url), {
  namedExports: {
    sendQuoteEmail: async (message, key) => {
      sends.push({ message, key });
      return outcomes[message.kind] || { ok: true, id: 'fake' };
    },
  },
});

const { processQuoteEmails, retryQuoteEmails } = await import('../src/netlify/functions/_lib/quote-email-retry.mjs');
const start = Date.now();
const lead = {
  id: `${start}-example`,
  quoteEmails: { version: 1, queuedAt: start, notification: { kind: 'notification' }, acknowledgement: { kind: 'acknowledgement' } },
};

test('retry state, recovery, concurrency and bounds', async (t) => {
  t.after(() => mock.restoreAll());
  await t.test('failed and successful messages are tracked independently', async () => {
    outcomes = { notification: { ok: false, error: 'no_api_key' } };
    assert.equal(await processQuoteEmails(lead, start), 2);
    assert.equal(state.get(`${lead.id}/notification/attempt-0`).error, 'no_api_key');
    assert.ok(state.get(`${lead.id}/acknowledgement/sent`));
    assert.equal(await processQuoteEmails(lead, start + 60_000), 0);
    outcomes = {};
    leads.set(lead.id, lead);
    assert.equal(await retryQuoteEmails(start + 5 * 60_000), 1);
    assert.equal(sends.length, 3);
    assert.deepEqual(sends[0], sends[2]);
    assert.ok(state.get(`${lead.id}/notification/sent`));
    assert.equal(await retryQuoteEmails(start + 15 * 60_000), 0);
  });

  await t.test('overlapping invocations use identical idempotency keys and payloads', async () => {
    state.clear(); sends = [];
    await Promise.all([processQuoteEmails(lead, start), processQuoteEmails(lead, start)]);
    for (const kind of ['notification', 'acknowledgement']) {
      const calls = sends.filter(({ message }) => message.kind === kind);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      assert.equal(calls[0].key, `quote-${kind}/${lead.id}`);
    }
  });

  await t.test('a lost success record is retried using the same key', async () => {
    state.clear(); sends = [];
    failWrite = '/sent';
    await processQuoteEmails(lead, start);
    failWrite = '';
    await processQuoteEmails(lead, start + 5 * 60_000);
    assert.deepEqual(sends[0], sends[2]);
    assert.deepEqual(sends[1], sends[3]);
  });

  await t.test('pre-send write failure does not send and can recover later', async () => {
    state.clear(); sends = [];
    failWrite = '/attempt-0';
    await processQuoteEmails(lead, start);
    assert.equal(sends.length, 0);
    failWrite = '';
    await processQuoteEmails(lead, start + 5 * 60_000);
    assert.equal(sends.length, 2);
  });

  await t.test('limits attempts and ignores expired and legacy leads', async () => {
    state.clear(); sends = [];
    outcomes = { notification: { ok: false }, acknowledgement: { ok: false } };
    for (const minutes of [0, 5, 15, 45, 120, 360, 720, 721, 1080, 1500]) {
      await processQuoteEmails(lead, start + minutes * 60_000);
    }
    assert.equal(sends.length, 14);
    assert.equal(await processQuoteEmails({ id: 'old' }, start), 0);
    outcomes = {};
  });
});
