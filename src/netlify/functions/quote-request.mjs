// POST /api/quote-request
// Accepts the contact-form submission, persists to the `leads` blob store,
// and sends an SMS to Drew via Twilio.

import { leadStore, json, nowIso } from './_lib/store.mjs';
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

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

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

  const lead = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: nowIso(),
    firstName: fields.firstName,
    lastName: fields.lastName,
    email: fields.email,
    phone: fields.phone,
    service: fields.service,
    description: fields.description,
    location: fields.location || '',
    budget: fields.budget || '',
    contactMethod: fields.contactMethod || '',
    referral: fields.referral || '',
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
