// Storefront quote/contact leads → Back Office customers + interactions.
// Imported by quote-request.mjs: keep imports to leadStore + Back Office libs.

import { leadStore } from './store.mjs';
import { postWebsiteEvent, websiteWebhookConfigured } from './backoffice.mjs';
import { runSyncAttempt } from './backoffice-sync.mjs';

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_MESSAGE = 4000;
const UTM_KEYS = [['source', 'utmSource'], ['medium', 'utmMedium'], ['campaign', 'utmCampaign']];

const clean = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Read utm_* values captured by the browser; never trusted beyond trimming. */
export function sanitizeUtm(fields = {}) {
  const out = {};
  for (const [key, field] of UTM_KEYS) {
    const value = clean(fields[field], 100);
    if (value) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function buildLeadPayload(lead) {
  const labels = lead.quotePresentation?.labels || {};
  const name = [clean(lead.firstName, 80), clean(lead.lastName, 80)].filter(Boolean).join(' ')
    || clean(lead.email, 200)
    || 'Website visitor';
  const customer = { name };
  const email = clean(lead.email, 254);
  if (EMAIL_RE.test(email)) customer.email = email;
  const phone = clean(lead.phone, 32);
  if (phone) customer.phone = phone;
  for (const [key, field] of UTM_KEYS) {
    const value = clean(lead.utm?.[key], 100);
    if (value) customer[field] = value;
  }

  const details = [
    ['Service', labels.service || lead.service],
    ['Customer type', labels.customerType || lead.customerType],
    ['Budget', labels.budget || lead.budget],
    ['Location', lead.location],
    ['Deadline', labels.deadline || (lead.hasDeadline === 'yes' ? lead.deadlineDate : '')],
    ['Engraving add-on', lead.engravingAddon ? 'Yes' : ''],
    ['Preferred contact', labels.contactMethod || lead.contactMethod],
    ['Heard about us', labels.referral || lead.referral],
  ].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  const photos = (Array.isArray(lead.photos) ? lead.photos : []).filter((u) => typeof u === 'string');
  const message = [
    clean(lead.description, 3000),
    details.length ? details.join('\n') : '',
    photos.length ? `Reference photos:\n${photos.join('\n')}` : '',
    `Storefront lead: ${lead.id}`,
  ].filter(Boolean).join('\n\n').slice(0, MAX_MESSAGE);

  return { eventId: `lead_${lead.id}`, type: 'lead', customer, message };
}

export const leadSyncHandler = {
  kind: 'lead',
  enabled: websiteWebhookConfigured,
  load: (id) => leadStore().get(id, { type: 'json' }),
  async update(id, fn) {
    const store = leadStore();
    const next = fn(await store.get(id, { type: 'json' }));
    if (next) await store.setJSON(id, next);
  },
  eligible: (lead) => !!lead?.id,
  async send(lead, { timeoutMs } = {}) {
    const data = await postWebsiteEvent(buildLeadPayload(lead), { timeoutMs });
    return { customer_id: data.customerId || null, interaction_id: data.interactionId || null };
  },
  // Back Office has no lead lookup by event id; an ambiguous retry may log a
  // second interaction on the same customer, which is harmless.
};

export function syncLeadToBackOffice(id, opts = {}) {
  return runSyncAttempt(leadSyncHandler, id, opts);
}
