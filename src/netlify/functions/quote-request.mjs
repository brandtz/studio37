// POST /api/quote-request
// Accepts the contact-form submission, persists to the `leads` blob store,
// and sends an SMS to Drew via Twilio.

import { leadStore, json, nowIso } from './_lib/store.mjs';
import { checkRateLimit, clientIp } from './_lib/rate-limit.mjs';
import { sendLeadNotification, sendLeadAcknowledgement } from './_lib/email.mjs';
import { r2Configured, uploadBufferToR2 } from './_lib/r2.mjs';
import quoteOptions from '../../assets/js/quote-options.js';
import twilio from 'twilio';

const { serviceGroups, serviceLabels, customerTypes, homeGoods } = quoteOptions;
const allowedServices = new Set(['other', ...serviceGroups.flatMap((group) => group.options.map(([value]) => value))]);

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

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

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
  let photoFiles = [];
  if (ct.startsWith('multipart/form-data') || ct.startsWith('application/x-www-form-urlencoded')) {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') {
        fields[k] = v;
      } else if (k === 'photos' && v && typeof v.arrayBuffer === 'function' && v.size > 0) {
        photoFiles.push(v);
      }
    }
  } else if (ct.includes('application/json')) {
    fields = await req.json().catch(() => ({}));
  }

  // Honeypot — silently accept
  if (fields['bot-field']) return json({ ok: true });

  const required = ['firstName', 'lastName', 'email', 'phone', 'customerType', 'city', 'state', 'hasDeadline', 'service', 'description'];
  for (const f of required) {
    if (typeof fields[f] !== 'string' || !fields[f].trim()) return json({ error: `missing field: ${f}` }, 400);
  }

  const customerType = fields.customerType.trim();
  const state = fields.state.trim().toUpperCase();
  const service = fields.service.trim();
  const hasDeadline = fields.hasDeadline.trim();
  if (!Object.hasOwn(customerTypes, customerType)) return json({ error: 'invalid_customer_type' }, 400);
  if (!/^[A-Z]{2}$/.test(state)) return json({ error: 'invalid_state' }, 400);
  if (!allowedServices.has(service)) return json({ error: 'invalid_service' }, 400);
  if (hasDeadline !== 'yes' && hasDeadline !== 'no') return json({ error: 'invalid_deadline' }, 400);
  const deadlineDate = hasDeadline === 'yes' ? String(fields.deadlineDate || '').trim() : '';
  if (hasDeadline === 'yes') {
    const date = new Date(`${deadlineDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== deadlineDate) {
      return json({ error: 'invalid_deadline' }, 400);
    }
  }
  const engravingAddon = fields.engravingAddon === 'yes' || fields.engravingAddon === true;
  if (engravingAddon && !homeGoods.includes(service)) return json({ error: 'invalid_engraving' }, 400);

  // Validate reference photos server-side (client limits are cosmetic only).
  if (photoFiles.length > MAX_PHOTOS) return json({ error: 'too_many_photos' }, 400);
  for (const f of photoFiles) {
    if (f.size > MAX_PHOTO_BYTES) return json({ error: 'photo_too_large' }, 400);
    if (!PHOTO_MIME_EXT[f.type]) return json({ error: 'invalid_photo_type' }, 400);
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

  const trim = (s, max) => String(s || '').trim().slice(0, max);
  const city = trim(fields.city, MAX_FIELD);
  const lead = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: nowIso(),
    firstName: trim(fields.firstName, MAX_NAME),
    lastName: trim(fields.lastName, MAX_NAME),
    email,
    phone: trim(fields.phone, 32),
    service,
    description: trim(fields.description, MAX_DESCRIPTION),
    customerType,
    city,
    state,
    location: `${city}, ${state}`,
    hasDeadline,
    deadlineDate,
    engravingAddon,
    budget: trim(fields.budget, 40),
    contactMethod: trim(fields.contactMethod, 40),
    referral: trim(fields.referral, 40),
    photos: [],
  };

  if (photoFiles.length) {
    if (r2Configured()) {
      for (let i = 0; i < photoFiles.length; i++) {
        try {
          const file = photoFiles[i];
          const ext = PHOTO_MIME_EXT[file.type];
          const key = `leads/${lead.id}/${i}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const buf = Buffer.from(await file.arrayBuffer());
          const url = await uploadBufferToR2(buf, key, file.type);
          lead.photos.push(url);
        } catch (e) {
          console.error('lead photo upload failed', e);
          return json({ error: 'photo_upload_failed' }, 503);
        }
      }
    } else {
      console.error('R2 not configured — cannot upload lead photos');
      return json({ error: 'photo_upload_failed' }, 503);
    }
  }

  // Persist
  try {
    await leadStore().setJSON(lead.id, lead);
  } catch (e) {
    console.error('lead persist failed', e);
    return json({ error: 'lead_save_failed' }, 503);
  }

  // Pre-resolve human labels once and share with both email helpers + SMS.
  const labels = {
    service: serviceLabels[lead.service] || lead.service,
    budget: lead.budget ? (BUDGET_LABEL[lead.budget] || lead.budget) : '',
    customerType: customerTypes[lead.customerType],
    deadline: lead.hasDeadline === 'yes'
      ? `Yes, by ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${lead.deadlineDate}T00:00:00Z`))}`
      : 'No',
  };

  // Email Drew (best-effort — don't fail the request if Resend errors).
  try {
    await sendLeadNotification(lead, labels);
  } catch (e) {
    console.error('lead notify email failed', e);
  }

  // Email the customer a receipt (best-effort).
  try {
    await sendLeadAcknowledgement(lead, labels);
  } catch (e) {
    console.error('lead acknowledgement email failed', e);
  }

  // Send SMS to Drew (best-effort — don't fail the request if Twilio errors).
  try {
    const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, DREW_PHONE } = process.env;
    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DREW_PHONE) {
      const client = twilio(TWILIO_SID, TWILIO_TOKEN);
      const msg = [
        `📋 New Studio 37 Quote Request`,
        `From: ${lead.firstName} ${lead.lastName} (${lead.phone})`,
        `Service: ${labels.service}`,
        `Customer: ${labels.customerType}`,
        labels.budget ? `Budget: ${labels.budget}` : null,
        lead.location ? `Location: ${lead.location}` : null,
        `Deadline: ${labels.deadline}`,
        `Engraving: ${lead.engravingAddon ? 'Yes' : 'No'}`,
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
