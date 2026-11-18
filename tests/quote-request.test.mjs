import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const saved = [];
const emails = [];
const messages = [];
let uploadFails = false;
let saveFails = false;

mock.module(new URL('../src/netlify/functions/_lib/store.mjs', import.meta.url), {
  namedExports: {
    leadStore: () => ({ setJSON: async (id, lead) => {
      if (saveFails) throw new Error('test save failure');
      saved.push({ id, lead });
    } }),
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
    emails = { send: async (message) => { emails.push(message); return { data: { id: 'test' } }; } };
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
  const keys = ['RESEND_API_KEY', 'TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM', 'DREW_PHONE'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'test';
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
      [{ service: 'outdoor-sauna' }, 'invalid_engraving'],
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
  });
});
