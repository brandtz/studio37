import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderEmailSnapshotRepository } from '../src/netlify/functions/_lib/order-email-snapshot.mjs';

const message = (subject) => ({
  from: 'Studio 37 <sender@example.test>', to: 'customer@example.test', reply_to: 'reply@example.test',
  subject, text: 'Protected order details', html: '<p>Protected order details</p>',
  headers: { 'X-Entity-Ref-ID': 'cs_offline' }, tags: [{ name: 'type', value: 'order_confirmation' }],
});
function setup() {
  const entries = new Map();
  const options = [];
  const store = {
    get: async (key) => structuredClone(entries.get(key) || null),
    setJSON: async (key, value, condition) => {
      options.push(condition);
      if (entries.has(key)) return { modified: false };
      entries.set(key, structuredClone(value));
      return { modified: true };
    },
  };
  return { entries, options, store, repository: createOrderEmailSnapshotRepository({ store: () => store }) };
}

test('concurrent renderers send only the same atomically committed winner', async () => {
  const { entries, options, repository } = setup();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let renders = 0;
  const render = (subject) => async () => {
    if (++renders === 2) release();
    await barrier;
    return message(subject);
  };
  const results = await Promise.all([
    repository.getOrCreate('cs_offline', 'confirmation', render('Publication one')),
    repository.getOrCreate('cs_offline', 'confirmation', render('Publication two')),
  ]);
  assert.equal(renders, 2);
  assert.equal(entries.size, 1);
  assert.deepEqual(options, [{ onlyIfNew: true }, { onlyIfNew: true }]);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], entries.get('cs_offline/confirmation'));
  assert.equal(results[0].idempotencyKey, 'order-confirmation/cs_offline');
  const retry = await repository.getOrCreate('cs_offline', 'confirmation', () => { throw new Error('CMS must not be reread'); });
  assert.deepEqual(retry, results[0]);
});

test('snapshot outages, unknown conditional-write results and invalid winners fail closed', async () => {
  for (const mode of ['read-fails', 'write-fails', 'unsupported', 'lost-winner', 'invalid-winner']) {
    const { repository, store } = setup();
    if (mode === 'read-fails') store.get = async () => { throw new Error('private credentials'); };
    if (mode === 'write-fails') store.setJSON = async () => { throw new Error('private credentials'); };
    if (mode === 'unsupported') store.setJSON = async () => undefined;
    if (mode === 'lost-winner') store.setJSON = async () => ({ modified: true });
    if (mode === 'invalid-winner') store.get = async () => ({ version: 1, orderId: 'wrong' });
    await assert.rejects(repository.getOrCreate('cs_offline', 'confirmation', () => message('Test')),
      (error) => ['snapshot_unavailable', 'snapshot_invalid'].includes(error.code) && !error.message.includes('private'));
  }
});

test('invalid payloads are not persisted and ambiguous writes recover the original snapshot on retry', async () => {
  const { repository, entries, store } = setup();
  await assert.rejects(repository.getOrCreate('cs_offline', 'confirmation', () => ({
    ...message('Test'), headers: { 'X-Entity-Ref-ID': 'cs_wrong' },
  })), (error) => error.code === 'snapshot_invalid');
  assert.equal(entries.size, 0);
  const write = store.setJSON;
  store.setJSON = async (...args) => { await write(...args); throw new Error('response lost after commit'); };
  await assert.rejects(repository.getOrCreate('cs_offline', 'confirmation', () => message('Original')),
    (error) => error.code === 'snapshot_unavailable');
  const retry = await repository.getOrCreate('cs_offline', 'confirmation', () => message('Changed publication'));
  assert.equal(retry.message.subject, 'Original');
});
