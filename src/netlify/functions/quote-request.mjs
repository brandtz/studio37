// POST /api/quote-request
// Accepts the contact-form submission, persists to the `leads` blob store,
// and sends an SMS to Drew via Twilio.

import { leadStore, json, nowIso } from './_lib/store.mjs';
import { checkRateLimit, clientIp } from './_lib/rate-limit.mjs';
import twilio from 'twilio';

const SERVICE_LABEL = {
  cabinetry: 'Cabinetry',
  slab: 'Slab Flattening',
  furniture: 'Custom Furniture',
  'small-goods': 'Small Goods',
  gc: 'GC Work',
  other: 'Other',
};

const BUDGET_LABEL = {
  'under-500': 'Under $500',
  '500-2000': '$500–$2K',
  '2000-5000': '$2K–$5K',
  '5000-plus': '$5K+',
  'not-sure': 'Not sure',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_DESCRIPTION = 5000;
const MAX_NAME = 80;
const MAX_FIELD = 160;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const ip = clientIp(req);

  // Per-IP rate limit: 3 submissions / hour. Stops Twilio cost-bomb attacks.
  const ipRl = await checkRateLimit({ key: `quote:ip:${ip}`, limit: 3, windowMs: 60 * 60 * 1000 });
  if (!ipRl.allowed) {
    return json(
      { error: 'too_many_requests', message: 'Too many requests from this network. Please try again later.', retry_after: ipRl.retryAfterSec },
      429,
      { 'retry-after': String(ipRl.retryAfterSec) },
    );
  }

  const ct = req.headers.get('content-type') || '';
  let fields = {};
  if (ct.startsWith('multipart/form-data') || ct.startsWith('application/x-www-form-urlencoded')) {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') fields[k] = v;
    }
  } else if (ct.includes('application/json')) {
    fields = await req.json().catch(() => ({}));
  }

  // Honeypot — silently accept
  if (fields['bot-field']) return json({ ok: true });

  const required = ['firstName', 'lastName', 'email', 'phone', 'service', 'description'];
  for (const f of required) {
    if (!fields[f]) return json({ error: `missing field: ${f}` }, 400);
  }

  // Validation
  const email = String(fields.email).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);

  const phoneDigits = String(fields.phone).replace(/\D/g, '');
  if (phoneDigits.length < 10) return json({ error: 'invalid_phone' }, 400);

  // Per-email rate limit: 5 / day. Stops single-email spam.
  const emailRl = await checkRateLimit({ key: `quote:email:${email}`, limit: 5, windowMs: 24 * 60 * 60 * 1000 });
  if (!emailRl.allowed) {
    return json(
      { error: 'too_many_requests', message: 'Please give us a chance to respond before sending more requests.', retry_after: emailRl.retryAfterSec },
      429,
      { 'retry-after': String(emailRl.retryAfterSec) },
    );
  }

  const trim = (s, max) => String(s || '').slice(0, max);
  const lead = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: nowIso(),
    firstName: trim(fields.firstName, MAX_NAME),
    lastName: trim(fields.lastName, MAX_NAME),
    email,
    phone: trim(fields.phone, 32),
    service: trim(fields.service, 40),
    description: trim(fields.description, MAX_DESCRIPTION),
    location: trim(fields.location, MAX_FIELD),
    budget: trim(fields.budget, 40),
    contactMethod: trim(fields.contactMethod, 40),
    referral: trim(fields.referral, 40),
  };

  // Persist
  try {
    await leadStore().setJSON(lead.id, lead);
  } catch (e) {
    console.error('lead persist failed', e);
  }

  // Send SMS to Drew (best-effort — don't fail the request if Twilio errors).
  try {
    const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, DREW_PHONE } = process.env;
    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DREW_PHONE) {
      const client = twilio(TWILIO_SID, TWILIO_TOKEN);
      const msg = [
        `📋 New Studio 37 Quote Request`,
        `From: ${lead.firstName} ${lead.lastName} (${lead.phone})`,
        `Service: ${SERVICE_LABEL[lead.service] || lead.service}`,
        lead.budget ? `Budget: ${BUDGET_LABEL[lead.budget] || lead.budget}` : null,
        lead.location ? `Location: ${lead.location}` : null,
        `"${lead.description.slice(0, 240)}${lead.description.length > 240 ? '…' : ''}"`,
        `Reply to: ${lead.email}`,
      ].filter(Boolean).join('\n');
      await client.messages.create({ from: TWILIO_FROM, to: DREW_PHONE, body: msg });
    } else {
      console.warn('Twilio env missing — skipping SMS');
    }
  } catch (e) {
    console.error('twilio send failed', e);
  }

  return json({ ok: true, id: lead.id });
};

export const config = { path: '/.netlify/functions/quote-request' };
