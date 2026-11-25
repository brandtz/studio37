import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import quoteForm from '../src/assets/js/quote-form-schema.js';
mock.module('@netlify/blobs', { namedExports: { getStore: () => ({ getWithMetadata: async () => null }) } });

let presentation = { schema: quoteForm.definition.schema, revision: null, values: quoteForm.defaults() };
let presentationFails = false;
mock.module(new URL('../src/netlify/functions/_lib/quote-form.mjs', import.meta.url), {
  namedExports: {
    readQuoteForm: async () => {
      if (presentationFails) throw new Error('test content outage');
      return structuredClone(presentation);
    },
    quoteChoiceMaps: (record) => Object.fromEntries(quoteForm.selectNames.map((name) => [
      name, new Map(quoteForm.parseChoices(name, record.values['choices-' + name]).map((row) => [row.id, row.label])),
    ])),
  },
});

const saved = [];
const emails = [];
const emailOptions = [];
const messages = [];
const attempts = new Map();
let uploadFails = false;
let saveFails = false;
let emailFails = false;
let emailResponse;

mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    leadStore: () => ({ setJSON: async (id, lead) => {
      if (saveFails) throw new Error('test save failure');
      saved.push({ id, lead });
    } }),
    quoteEmailStore: () => ({
      get: async (key) => attempts.get(key) || null,
      setJSON: async (key, value) => { attempts.set(key, value); },
    }),
    json: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
    nowIso: () => '2027-01-01T00:00:00.000Z',
  },
});
mock.module(new URL('../src/netlify/functions/_lib/rate-limit.mjs', import.meta.url), {
  namedExports: { checkRateLimit: async () => ({ allowed: true }), clientIp: () => 'test' },
});
mock.module(new URL('../src/netlify/functions/_lib/r2.mjs', import.meta.url), {
  namedExports: {
    r2Configured: () => true,
    uploadBufferToR2: async () => {
      if (uploadFails) throw new Error('test upload failure');
      return 'https://example.test/photo.jpg';
    },
  },
});
mock.module('resend', {
  namedExports: { Resend: class {
    emails = { send: async (message, options) => {
      emails.push(message);
      emailOptions.push(options);
      return emailResponse || (emailFails ? { error: { message: 'test failure' } } : { data: { id: 'test' } });
    } };
  } },
});
mock.module('twilio', {
  defaultExport: () => ({ messages: { create: async (message) => { messages.push(message); } } }),
});

const handler = (await import('../src/netlify/functions/quote-request.mjs')).default;
const valid = {
  firstName: 'Alex', lastName: 'Example', phone: '5415551234', email: 'alex@example.test',
  customerType: 'new-private', city: 'Eugene', state: 'or', hasDeadline: 'yes',
  deadlineDate: '2027-03-14', service: 'cutting-board', engravingAddon: 'yes',
  description: 'A custom board',
};

function request(fields, photo = false) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (photo) form.set('photos', new Blob(['image'], { type: 'image/jpeg' }), 'photo.jpg');
  return new Request('http://localhost/api/quote-request', { method: 'POST', body: form });
}

test('quote submission validates and carries details through mocked services', async (t) => {
  const keys = ['RESEND_API_KEY', 'TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM', 'DREW_PHONE',
    'QUOTE_TURNSTILE_SITE_KEY', 'QUOTE_TURNSTILE_SECRET_KEY', 'QUOTE_TURNSTILE_HOSTNAMES', 'CONTEXT'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys.slice(0, 5)) process.env[key] = 'test';
  delete process.env.QUOTE_TURNSTILE_SITE_KEY;
  delete process.env.QUOTE_TURNSTILE_SECRET_KEY;
  delete process.env.QUOTE_TURNSTILE_HOSTNAMES;
  t.after(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    mock.restoreAll();
  });

  await t.test('rejects invalid values and deadline dates', async () => {
    for (const [changes, error] of [
      [{ customerType: 'invented' }, 'invalid_customer_type'],
      [{ service: 'invented' }, 'invalid_service'],
      [{ deadlineDate: '2027-02-30' }, 'invalid_deadline'],
      [{ deadlineDate: '' }, 'invalid_deadline'],
      [{ service: 'outdoor-sauna' }, 'invalid_service'],
    ]) {
      const response = await handler(request({ ...valid, ...changes }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, error);
    }
    assert.equal(saved.length, 0);
  });

  await t.test('saves and notifies with all fields and a photo', async () => {
    const response = await handler(request(valid, true));
    assert.equal(response.status, 200);
    const body = await response.json();
    const { lead } = saved[0];
    assert.equal(body.id, lead.id);
    assert.deepEqual(
      [lead.customerType, lead.city, lead.state, lead.location, lead.hasDeadline, lead.deadlineDate, lead.engravingAddon, lead.photos],
      ['new-private', 'Eugene', 'OR', 'Eugene, OR', 'yes', '2027-03-14', true, ['https://example.test/photo.jpg']],
    );
    assert.equal(emails.length, 2);
    assert.deepEqual(emailOptions.slice(0, 2), [
      { idempotencyKey: `quote-notification/${lead.id}` },
      { idempotencyKey: `quote-acknowledgement/${lead.id}` },
    ]);
    for (const value of ['Cutting Board', 'New Customer: Private Party for Personal Residence', 'Eugene, OR', 'Yes, by Mar 14, 2027', 'Engraving add-on: Yes', 'https://example.test/photo.jpg']) {
      assert.ok(emails[0].text.includes(value), value);
    }
    assert.ok(emails[1].html.includes('<strong>Cutting Board</strong>'));
    for (const value of ['Cutting Board', 'New Customer: Private Party for Personal Residence', 'Eugene, OR', 'Yes, by Mar 14, 2027', 'Engraving: Yes']) {
      assert.ok(messages[0].body.includes(value), value);
    }
  });

  await t.test('ignores a date when deadline is no', async () => {
    const response = await handler(request({ ...valid, hasDeadline: 'no', deadlineDate: 'bad', engravingAddon: 'no' }));
    assert.equal(response.status, 200);
    assert.equal(saved[1].lead.deadlineDate, '');
    assert.equal(saved[1].lead.engravingAddon, false);
    assert.ok(emails[2].text.includes('Deadline: No'));
    assert.ok(!emails[2].text.includes('Engraving add-on:'));
  });

  await t.test('reports upload and storage failures instead of success', async () => {
    uploadFails = true;
    let response = await handler(request(valid, true));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'photo_upload_failed');
    uploadFails = false;
    saveFails = true;
    response = await handler(request(valid));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'lead_save_failed');
    assert.equal(saved.length, 2);
    assert.equal(emails.length, 4);
    assert.equal(messages.length, 2);
    saveFails = false;
  });

  await t.test('persists retry payloads and returns success when emails fail', async () => {
    emailFails = true;
    const response = await handler(request(valid, true));
    assert.equal(response.status, 200);
    const { id } = await response.json();
    const lead = saved[2].lead;
    assert.equal(lead.id, id);
    assert.ok(lead.quoteEmails.notification.text.includes('https://example.test/photo.jpg'));
    assert.ok(lead.quoteEmails.acknowledgement.html.includes('<strong>Cutting Board</strong>'));
    assert.equal(attempts.get(`${id}/notification/attempt-0`).error, 'send_failed');
    assert.equal(attempts.get(`${id}/acknowledgement/attempt-0`).error, 'send_failed');
    emailFails = false;
  });

  await t.test('missing email credentials are recorded for later retry', async () => {
    delete process.env.RESEND_API_KEY;
    const before = emails.length;
    const response = await handler(request(valid));
    const { id } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(emails.length, before);
    assert.equal(attempts.get(`${id}/notification/attempt-0`).error, 'no_api_key');
    assert.equal(attempts.get(`${id}/acknowledgement/attempt-0`).error, 'no_api_key');
    process.env.RESEND_API_KEY = 'test';
  });

  await t.test('missing message IDs remain pending and provider failures retain only safe diagnostics', async () => {
    const { sendQuoteEmail } = await import('../src/netlify/functions/_lib/email.mjs');
    for (const data of [null, {}, { id: '' }, { id: '   ' }, { id: 123 }]) {
      emailResponse = { data, error: null };
      assert.deepEqual(await sendQuoteEmail({ subject: 'Test' }, 'test-key'), { ok: false, error: 'missing_message_id' });
    }
    const response = await handler(request(valid));
    const { id } = await response.json();
    assert.equal(response.status, 200);
    assert.equal(attempts.get(`${id}/notification/attempt-0`).error, 'missing_message_id');
    assert.equal(attempts.has(`${id}/notification/sent`), false);
    assert.equal(attempts.has(`${id}/acknowledgement/sent`), false);

    emailResponse = { error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'private recipient and credential' } };
    const failureResponse = await handler(request(valid));
    const failureId = (await failureResponse.json()).id;
    const { startedAt, ...failure } = attempts.get(`${failureId}/notification/attempt-0`);
    assert.deepEqual(failure, { error: 'send_failed', providerCode: 'rate_limit_exceeded', providerStatus: 429 });
    emailResponse = { error: { name: 'private secret', statusCode: '429', message: 'private' } };
    assert.deepEqual(await sendQuoteEmail({ subject: 'Test' }, 'test-key'), { ok: false, error: 'send_failed' });
    emailResponse = undefined;
  });

  await t.test('published choices drive validation, stable lead IDs and immutable label/email snapshots', async () => {
    const values = quoteForm.defaults();
    const serviceChoices = [{ id: 'custom-board', label: 'Custom board <special>', group: 'home-goods' }];
    values['choices-service'] = JSON.stringify(serviceChoices);
    values['choices-budget'] = JSON.stringify([{ id: 'custom-budget', label: 'Discuss pricing' }]);
    values['choices-referral'] = JSON.stringify([{ id: 'custom-referral', label: 'Community event' }]);
    presentation = { schema: quoteForm.definition.schema, revision: 'publication-1', values };
    const before = saved.length;
    const originalRecords = structuredClone(saved);
    for (const [changes, error] of [
      [{ service: 'cutting-board' }, 'invalid_service'],
      [{ service: 'saunas' }, 'invalid_service'],
      [{ service: 'outdoor-sauna' }, 'invalid_service'],
      [{ budget: 'under-500' }, 'invalid_budget'],
      [{ referral: 'google' }, 'invalid_referral'],
      [{ contactMethod: 'invented' }, 'invalid_contact_method'],
    ]) {
      const response = await handler(request({ ...valid, service: 'custom-board', ...changes }));
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, error);
    }
    const stale = await handler(request({ ...valid, service: 'custom-board', quoteSchema: presentation.schema, quoteRevision: '' }));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error, 'quote_form_changed');
    assert.equal(saved.length, before);

    const fields = { ...valid, service: 'custom-board', budget: 'custom-budget', referral: 'custom-referral',
      quoteSchema: presentation.schema, quoteRevision: presentation.revision };
    assert.equal((await handler(request(fields))).status, 200);
    const lead = saved.at(-1).lead;
    assert.equal(lead.service, 'custom-board');
    assert.equal(lead.budget, 'custom-budget');
    assert.equal(lead.referral, 'custom-referral');
    assert.equal(lead.quotePresentation.labels.service, 'Custom board <special>');
    assert.ok(lead.quoteEmails.acknowledgement.html.includes('Custom board &lt;special&gt;'));
    const snapshot = structuredClone(lead);
    presentation.values['choices-service'] = JSON.stringify([{ ...serviceChoices[0], label: 'Renamed board' }]);
    assert.deepEqual(saved.slice(0, before), originalRecords);
    assert.deepEqual(lead, snapshot);
    const response = await handler(request(fields));
    assert.equal(response.status, 200);
    assert.equal(saved.at(-1).lead.quotePresentation.labels.service, 'Renamed board');
    assert.notEqual(saved.at(-1).lead.id, lead.id);

    presentationFails = true;
    const logs = [];
    const logger = mock.method(console, 'error', (...args) => logs.push(args));
    const unavailable = await handler(request(fields));
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error, 'quote_form_unavailable');
    assert.equal(saved.length, before + 2);
    assert.deepEqual(logs, [['[quote-form] published configuration read failed']]);
    logger.mock.restore();
    presentationFails = false;
    presentation = { schema: quoteForm.definition.schema, revision: null, values: quoteForm.defaults() };
  });

  await t.test('honeypots stop notifications without creating leads', async () => {
    const before = [saved.length, emails.length, messages.length];
    for (const field of ['bot-field', 'website']) {
      const response = await handler(request({ ...valid, [field]: 'spam' }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    }
    assert.deepEqual([saved.length, emails.length, messages.length], before);
  });

  await t.test('Turnstile verification is required when configured and fails closed', async () => {
    const before = [saved.length, emails.length, messages.length];
    process.env.QUOTE_TURNSTILE_SITE_KEY = 'test-site';
    const contentHandler = (await import('../src/netlify/functions/quote-form-content.mjs')).default;
    assert.equal((await contentHandler(new Request('https://site.test/'))).status, 503);
    let response = await handler(request(valid));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'verification_unavailable');
    process.env.QUOTE_TURNSTILE_SECRET_KEY = 'test-secret';
    const configResponse = await contentHandler(new Request('https://site.test/'));
    const publicConfig = await configResponse.json();
    assert.equal(publicConfig.turnstileSiteKey, 'test-site');
    assert.ok(!JSON.stringify(publicConfig).includes('test-secret'));

    let outcome = { success: true, action: 'quote_request', hostname: 'studio37customdesigns.com' };
    const calls = [];
    const fetchMock = mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, options });
      if (outcome instanceof Error) throw outcome;
      return Response.json(outcome);
    });
    try {
      for (const token of ['', 'x'.repeat(2049)]) {
        response = await handler(request({ ...valid, 'cf-turnstile-response': token }));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'verification_failed');
      }
      assert.equal(calls.length, 0);
      for (const invalid of [
        { success: false, 'error-codes': ['timeout-or-duplicate'] },
        { success: true, action: 'other_form', hostname: 'studio37customdesigns.com' },
        { success: true, action: 'quote_request', hostname: 'untrusted.example' },
        { success: true, action: 'quote_request' },
      ]) {
        outcome = invalid;
        response = await handler(request({ ...valid, 'cf-turnstile-response': 'token' }));
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error, 'verification_failed');
      }
      for (const unavailable of [
        { success: false, 'error-codes': ['invalid-input-secret'] },
        new Error('network failure'),
        { unexpected: true },
      ]) {
        outcome = unavailable;
        response = await handler(request({ ...valid, 'cf-turnstile-response': 'token' }));
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error, 'verification_unavailable');
      }
      assert.deepEqual([saved.length, emails.length, messages.length], before);
      process.env.CONTEXT = 'production';
      process.env.QUOTE_TURNSTILE_HOSTNAMES = 'localhost';
      response = await handler(request({ ...valid, 'cf-turnstile-response': 'token' }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'verification_unavailable');
      delete process.env.QUOTE_TURNSTILE_HOSTNAMES;
      outcome = { success: true, action: 'quote_request', hostname: 'studio37customdesigns.com' };
      response = await handler(request({ ...valid, 'cf-turnstile-response': 'token' }));
      assert.equal(response.status, 200);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), { secret: 'test-secret', response: 'token' });
      assert.equal(saved.length, before[0] + 1);
      assert.equal(emails.length, before[1] + 2);
      assert.equal(messages.length, before[2] + 1);
    } finally {
      fetchMock.mock.restore();
      delete process.env.QUOTE_TURNSTILE_SITE_KEY;
      delete process.env.QUOTE_TURNSTILE_SECRET_KEY;
      delete process.env.QUOTE_TURNSTILE_HOSTNAMES;
    }
  });
});
