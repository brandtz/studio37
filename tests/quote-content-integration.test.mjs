import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import quoteForm from '../src/assets/js/quote-form-schema.js';
import { createContentRepository, createPublicContentHandler } from '../src/netlify/functions/_lib/content.mjs';
import { createQuoteFormReader } from '../src/netlify/functions/_lib/quote-form.mjs';

const leads = [];
mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    leadStore: () => ({ setJSON: async (_id, lead) => leads.push(structuredClone(lead)) }),
    nowIso: () => '2027-01-01T00:00:00Z',
    json: (value, status = 200) => Response.json(value, { status }),
  },
});
mock.module(new URL('../src/netlify/functions/_lib/rate-limit.mjs', import.meta.url), {
  namedExports: { checkRateLimit: async () => ({ allowed: true }), clientIp: () => 'offline' },
});
mock.module(new URL('../src/netlify/functions/_lib/r2.mjs', import.meta.url), {
  namedExports: { r2Configured: () => false, uploadBufferToR2: async () => { throw new Error('No uploads in this test'); } },
});
mock.module(new URL('../src/netlify/functions/_lib/email.mjs', import.meta.url), {
  namedExports: {
    prepareQuoteEmailSnapshots: async (_lead, labels) => ({
      notification: { text: labels.service }, acknowledgement: { text: labels.service },
    }),
  },
});
mock.module(new URL('../src/netlify/functions/_lib/quote-email-retry.mjs', import.meta.url), {
  namedExports: { processQuoteEmails: async () => {} },
});
mock.module('twilio', { defaultExport: () => ({ messages: { create: async () => {} } }) });
const { createQuoteRequestHandler } = await import('../src/netlify/functions/quote-request.mjs');

function store() {
  const records = new Map();
  let version = 0;
  return {
    get: async (key) => structuredClone(records.get(key)?.data || null),
    getWithMetadata: async (key) => structuredClone(records.get(key) || null),
    setJSON: async (key, data, options = {}) => {
      if ((options.onlyIfNew && records.has(key)) || (options.onlyIfMatch && records.get(key)?.etag !== options.onlyIfMatch)) return { modified: false };
      const etag = '"' + ++version + '"';
      records.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
    list: ({ prefix }) => (async function* () {
      yield { blobs: Array.from(records.keys()).filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
    })(),
  };
}

test('quote submission displays the published validation message as plain text', async () => {
  const values = { ...quoteForm.defaults(), 'message-invalid_email': '<strong>Check your email</strong>' };
  const listeners = {};
  const status = { textContent: '', focus() {} };
  const button = { disabled: false, textContent: '' };
  const service = { value: '', options: [], addEventListener() {} };
  const description = { value: '' };
  const fileInput = { files: [], addEventListener() {} };
  const zone = { addEventListener() {} };
  const deadline = { value: '', disabled: false };
  const form = {
    elements: { engravingAddon: {}, hasDeadline: { value: 'no' }, deadlineDate: deadline },
    querySelector(selector) {
      return {
        '#service': service, '#description': description, '[name="bot-field"]': { value: '' },
        'button[type="submit"]': button,
      }[selector];
    },
    querySelectorAll() { return []; },
    addEventListener(name, callback) { listeners[name] = callback; },
    reportValidity() { return true; },
  };
  const elements = {
    'quote-form': form, 'form-success': {}, 'success-name': {}, 'quote-form-status': status,
    'engraving-field': {}, 'deadline-field': {}, 'upload-zone': zone,
    photos: fileInput, 'upload-list': {},
  };
  const document = { getElementById: (id) => elements[id] };
  const context = {
    document, location: { search: '' }, URLSearchParams, Date,
    window: {
      Studio37QuoteOptions: { serviceLabels: {} }, Studio37QuoteForm: { ...quoteForm, apply() {} },
      Studio37Content: { loadScope: async () => ({}) },
    },
    FormData: class { set() {} },
    fetch: async (url) => url.includes('quote-form-content')
      ? { ok: true, json: async () => ({ schema: quoteForm.definition.schema, revision: 'published', values }) }
      : { ok: false, json: async () => ({ error: 'invalid_email' }) },
    console: { error() {} },
  };
  vm.runInNewContext(readFileSync('src/assets/js/contact.js', 'utf8'), context);
  await listeners.submit({ preventDefault() {} });
  assert.equal(status.textContent, '<strong>Check your email</strong>');
  assert.equal(button.disabled, false);
});

test('CMS committed head drives both public quote presentation and submission; unpublished/removal edits cannot corrupt past leads', async () => {
  const stores = [store(), store(), store()];
  const repository = createContentRepository({ drafts: () => stores[0], published: () => stores[1], publications: () => stores[2] });
  const read = createQuoteFormReader(repository);
  const handler = createQuoteRequestHandler({ readPresentation: read });
  const publicHandler = createPublicContentHandler(repository);
  const values = {
    ...quoteForm.defaults(),
    'choices-service': JSON.stringify([{ id: 'custom-console', label: 'Console commission', group: 'custom-orders' }]),
    'message-invalid_email': 'Please check your email address.',
  };
  const draft = await repository.save('quote-form', values, quoteForm.definition.schema, 'editor');
  const fields = {
    firstName: 'Offline', lastName: 'Example', phone: '5415551234', email: 'offline@example.test', city: 'Eugene', state: 'OR',
    customerType: 'new-private', service: 'custom-console', hasDeadline: 'no', description: 'Offline test only',
  };
  const request = (extra = {}) => new Request('https://site.test/api/quote-request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...fields, ...extra }),
  });
  assert.equal((await handler(request())).status, 400);
  assert.equal(leads.length, 0);
  const publication = await repository.publish('quote-form', draft.id, draft.base, 'editor');
  const publicValues = await (await publicHandler(new Request('https://site.test/?page=quote-form&revision=' + draft.id))).json();
  assert.equal(publicValues['quote-form']['choices-service'], values['choices-service']);
  assert.equal(publicValues['quote-form']['message-invalid_email'], 'Please check your email address.');
  await assert.rejects(repository.save('quote-form', { ...values, 'message-invalid_email': '' }, quoteForm.definition.schema, 'editor'), /cannot be empty/);
  assert.equal((await read()).revision, publication.revision);
  assert.equal((await handler(request({ quoteSchema: quoteForm.definition.schema, quoteRevision: publication.revision }))).status, 200);
  assert.equal(leads[0].service, 'custom-console');
  assert.equal(leads[0].quotePresentation.labels.service, 'Console commission');
  assert.equal(leads[0].quoteEmails.notification.text, 'Console commission');
  const oldLead = structuredClone(leads[0]);

  const current = await repository.getPublished('quote-form');
  const removed = await repository.save('quote-form', quoteForm.defaults(), current.schema, 'editor', null, current);
  assert.equal((await handler(request())).status, 200);
  await repository.publish('quote-form', removed.id, removed.base, 'editor');
  assert.equal((await handler(request({ quoteSchema: current.schema, quoteRevision: current.revision }))).status, 409);
  assert.equal((await handler(request())).status, 400);
  assert.equal(leads.length, 2);
  assert.deepEqual(leads[0], oldLead);
  const restored = await repository.restorePublication('quote-form', publication.revision, 'editor');
  assert.equal((await handler(request())).status, 400);
  await repository.publish('quote-form', restored.id, restored.base, 'editor');
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(leads[0], oldLead);
});
