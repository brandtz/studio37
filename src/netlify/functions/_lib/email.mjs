// Resend transactional email helper.
// Helpers report failures to their callers; quote retries persist their payloads.
//
// Env vars (set in Netlify):
//   RESEND_API_KEY     required — Production API key from resend.com
//   RESEND_FROM        optional — defaults to "Studio 37 Custom Designs <orders@studio37customdesigns.com>"
//   RESEND_REPLY_TO    optional — defaults to "Drew@studio37customdesigns.com"
//   LEAD_NOTIFY_TO     optional — defaults to Drew's email
//   ORDER_NOTIFY_TO    optional — defaults to Drew's email

import { Resend } from 'resend';
import { readEmailCopy, defaultEmailCopy, applyEmailCopy, validateEmailHeaders } from './email-content.mjs';
import { orderEmailSnapshots, OrderEmailSnapshotError } from './order-email-snapshot.mjs';

const DEFAULT_FROM = 'Studio 37 Custom Designs <orders@studio37customdesigns.com>';
const DEFAULT_REPLY_TO = 'Drew@studio37customdesigns.com';
const DREW_NOTIFY_TO = 'Drew@studio37customdesigns.com';

function client() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fmtMoney(cents, currency = 'usd') {
  if (cents == null || !Number.isFinite(cents)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(cents / 100);
}

function shortId(sessionId) {
  if (!sessionId) return '';
  // Stripe session ids look like cs_live_a1b2c3...; show last 8 chars uppercased.
  return sessionId.slice(-8).toUpperCase();
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderItemsHtml(items, currency) {
  if (!items?.length) return '';
  const rows = items.map((i) => {
    const desc = escapeHtml(i.description || 'Item');
    const qty = i.quantity || 1;
    const amt = fmtMoney(i.amount_total, currency);
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e9e3d8;font-family:Georgia,serif;color:#3a322a;">${qty}× ${desc}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e9e3d8;text-align:right;font-family:Georgia,serif;color:#3a322a;white-space:nowrap;">${amt}</td>
    </tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">${rows}</table>`;
}

function renderItemsText(items, currency) {
  if (!items?.length) return '';
  return items.map((i) => {
    const qty = i.quantity || 1;
    const amt = fmtMoney(i.amount_total, currency);
    return `  ${qty}× ${i.description || 'Item'} — ${amt}`;
  }).join('\n');
}

/**
 * Send the customer an order-confirmation email.
 * @param {object} order Persisted order object from stripe-webhook.
 * @returns {Promise<{ok:boolean, id?:string, error?:string, skipped?:boolean}>}
 */
async function buildOrderConfirmationMessage(order) {
  const from = process.env.RESEND_FROM || DEFAULT_FROM;
  const replyTo = process.env.RESEND_REPLY_TO || DEFAULT_REPLY_TO;
  const orderNum = shortId(order.id);
  const firstName = (order.customer_name || '').split(' ')[0] || 'there';
  const currency = order.currency || 'usd';
  const subtotal = fmtMoney(order.amount_subtotal, currency);
  const total = fmtMoney(order.amount_total, currency);

  const itemsHtml = renderItemsHtml(order.items, currency);
  const itemsText = renderItemsText(order.items, currency);

  const subject = `Thanks for your order — Studio 37 #${orderNum}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5efe4;font-family:Georgia,'Times New Roman',serif;color:#3a322a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf1;border:1px solid #e2d8c4;border-radius:6px;">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <h1 style="margin:0 0 4px;font-size:22px;font-weight:normal;letter-spacing:0.04em;color:#3a322a;">Studio 37 Custom Designs</h1>
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a8b73;">Order #${escapeHtml(orderNum)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <!--studio37-email-narrative-->
        </td></tr>
        <tr><td style="padding:0 32px;">
          ${itemsHtml}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;">
            ${subtotal ? `<tr><td style="padding:4px 0;color:#6e6055;">Subtotal</td><td style="padding:4px 0;text-align:right;color:#6e6055;">${subtotal}</td></tr>` : ''}
            ${total ? `<tr><td style="padding:8px 0 0;font-weight:bold;color:#3a322a;border-top:1px solid #e9e3d8;">Total</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#3a322a;border-top:1px solid #e9e3d8;">${total}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <p><a href="tel:+15415147720" style="color:#9a6a3a;">(541) 514-7720</a></p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;text-align:center;border-top:1px solid #e9e3d8;">
          <p style="margin:0;font-size:12px;letter-spacing:0.08em;color:#9a8b73;">— Studio 37 Custom Designs</p>
          <p style="margin:6px 0 0;font-size:12px;color:#9a8b73;"><a href="https://studio37customdesigns.com" style="color:#9a6a3a;text-decoration:none;">studio37customdesigns.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Studio 37 Custom Designs — Order #${orderNum}`,
    '',
    '[[studio37-email-narrative]]',
    '',
    itemsText,
    subtotal ? `  Subtotal: ${subtotal}` : null,
    total ? `  Total:    ${total}` : null,
    '',
    '(541) 514-7720',
    '',
    '— Studio 37 Custom Designs',
    'https://studio37customdesigns.com',
  ].filter((l) => l !== null).join('\n');

  const current = await readEmailCopy('email.order-confirmation');
  return applyEmailCopy({
    from,
    to: order.customer_email,
    reply_to: replyTo,
    subject,
    html,
    text,
    headers: {
      'X-Entity-Ref-ID': order.id,
    },
    tags: [
      { name: 'type', value: 'order_confirmation' },
      { name: 'tenant', value: order.tenant_id || 'studio37' },
    ],
  }, 'email.order-confirmation', current, {
    orderNumber: orderNum, firstName, customerName: order.customer_name || '', total,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Order notifications
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Notify Drew of a new order or payment, independently of the customer receipt.
 */
async function buildOrderNotificationMessage(order) {
  const currency = order.currency || 'usd';
  const total = fmtMoney(order.amount_total, currency);
  const title = order.source === 'stripe_direct' ? 'New Studio 37 payment' : 'New Studio 37 order';
  const rows = [
    ['Order', order.id],
    ['Customer', order.customer_name || 'Not provided'],
    ['Email', order.customer_email || 'Not provided'],
    ['Phone', order.customer_phone || 'Not provided'],
    ['Total', total || 'Not available'],
    ['Payment status', order.payment_status || 'Unknown'],
  ];
  const rowsHtml = rows.map(([key, value]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6e6055;">${escapeHtml(key)}</td><td style="padding:6px 0;">${escapeHtml(value)}</td></tr>`,
  ).join('');
  const html = `<html><body style="font-family:Georgia,serif;color:#3a322a;">
    <h1>${title}</h1>
    <!--studio37-email-narrative-->
    <table role="presentation">${rowsHtml}</table>
    ${renderItemsHtml(order.items, currency)}
    <p><a href="https://studio37customdesigns.com/admin">Open the admin dashboard to view orders</a></p>
  </body></html>`;
  const text = [
    title,
    '[[studio37-email-narrative]]',
    ...rows.map(([key, value]) => `${key}: ${value}`),
    renderItemsText(order.items, currency),
    'View orders in the admin dashboard: https://studio37customdesigns.com/admin',
  ].join('\n');

  const current = await readEmailCopy('email.order-notification');
  return applyEmailCopy({
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to: process.env.ORDER_NOTIFY_TO || DREW_NOTIFY_TO,
    reply_to: order.customer_email || (process.env.RESEND_REPLY_TO || DEFAULT_REPLY_TO),
    subject: `${title} — #${shortId(order.id)}`,
    html,
    text,
    headers: { 'X-Entity-Ref-ID': order.id },
    tags: [{ name: 'type', value: 'order_notification' }],
  }, 'email.order-notification', current, {
    title, orderNumber: shortId(order.id), firstName: (order.customer_name || '').split(' ')[0] || 'there',
    customerName: order.customer_name || '', total,
  });
}

async function sendPersistedOrderEmail(order, type, render) {
  const resend = client();
  if (!resend) return { ok: false, skipped: true, error: 'no_api_key' };
  let snapshot;
  try {
    snapshot = await orderEmailSnapshots.getOrCreate(order?.id, type, render);
  } catch (error) {
    if (error.code === 'no_recipient') return { ok: false, skipped: true, error: 'no_recipient' };
    const code = error.code === 'snapshot_invalid' ? 'snapshot_invalid' : 'snapshot_unavailable';
    console.error(`[order-email] ${type} ${code}`);
    return { ok: false, error: code };
  }
  try {
    const { data, error } = await resend.emails.send(snapshot.message, { idempotencyKey: snapshot.idempotencyKey });
    if (error) return { ok: false, error: 'send_failed', ...quoteProviderDetails(error) };
    if (typeof data?.id !== 'string' || !data.id.trim()) return { ok: false, error: 'missing_message_id' };
    return { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, error: 'exception', ...quoteProviderDetails(error) };
  }
}

export async function sendOrderNotification(order) {
  return sendPersistedOrderEmail(order, 'notification', () => buildOrderNotificationMessage(order));
}

export async function sendOrderConfirmation(order) {
  return sendPersistedOrderEmail(order, 'confirmation', () => {
    if (!order?.customer_email) throw new OrderEmailSnapshotError('no_recipient');
    return buildOrderConfirmationMessage(order);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Lead / quote-request emails
// ──────────────────────────────────────────────────────────────────────────────

function leadFullName(lead) {
  return `${lead?.firstName || ''} ${lead?.lastName || ''}`.trim() || 'Unknown';
}

/**
 * Notify Drew that a new quote request came in.
 * @param {object} lead Persisted lead from quote-request.mjs.
 * @param {object} [labels] Pre-resolved human labels: { service, budget }.
 */
export function buildLeadNotification(lead, labels = {}, current = defaultEmailCopy('email.quote-notification')) {
  const from = process.env.RESEND_FROM || DEFAULT_FROM;
  const to = process.env.LEAD_NOTIFY_TO || DREW_NOTIFY_TO;
  const replyTo = lead?.email || (process.env.RESEND_REPLY_TO || DEFAULT_REPLY_TO);

  const name = leadFullName(lead);
  const service = labels.service || lead?.service || 'Other';
  const budget = labels.budget || lead?.budget || '';
  const phone = lead?.phone || '';
  const location = lead?.location || '';
  const referral = lead?.referral || '';
  const contactPref = lead?.contactMethod || '';
  const desc = lead?.description || '';

  const subject = `New Studio 37 quote request — ${service} — ${name}`;

  const rows = [
    ['Name', name],
    ['Email', lead?.email || ''],
    ['Phone', phone],
    ['Service', service],
    ['Customer type', labels.customerType || ''],
    ['Budget', budget],
    ['Location', location],
    ['Deadline', labels.deadline || ''],
    ['Engraving add-on', lead?.engravingAddon ? 'Yes' : ''],
    ['Contact preference', contactPref],
    ['Heard about us', referral],
  ].filter(([, v]) => v);

  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6e6055;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 0;color:#3a322a;">${escapeHtml(v)}</td></tr>`,
  ).join('');
  const photos = Array.isArray(lead?.photos) ? lead.photos : [];
  const photosHtml = photos.map((url, i) => `<li><a href="${escapeHtml(url)}">Reference photo ${i + 1}</a></li>`).join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5efe4;font-family:Georgia,'Times New Roman',serif;color:#3a322a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf1;border:1px solid #e2d8c4;border-radius:6px;">
        <tr><td style="padding:24px 32px 0;">
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a8b73;">New quote request</p>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:normal;color:#3a322a;">${escapeHtml(name)}</h1>
          <p style="margin:4px 0 0;font-size:14px;color:#6e6055;">${escapeHtml(service)}${budget ? ` &middot; ${escapeHtml(budget)}` : ''}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rowsHtml}</table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <h3 style="margin:16px 0 8px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#9a8b73;font-weight:normal;">Project description</h3>
          <div style="padding:14px 16px;background:#f5efe4;border-left:3px solid #9a6a3a;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(desc)}</div>
          ${photosHtml ? `<h3>Reference photos</h3><ul>${photosHtml}</ul>` : ''}
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <!--studio37-email-narrative-->
          <p style="margin:8px 0 0;font-size:13px;"><a href="https://studio37customdesigns.com/admin#leads" style="color:#9a6a3a;text-decoration:none;">Open admin dashboard &rarr;</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `New Studio 37 quote request`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Project description:',
    desc,
    '',
    ...photos.map((url, i) => `Reference photo ${i + 1}: ${url}`),
    '[[studio37-email-narrative]]',
    `Admin: https://studio37customdesigns.com/admin#leads`,
  ].join('\n');

  return applyEmailCopy({
    from,
    to,
    reply_to: replyTo,
    subject,
    html,
    text,
    headers: { 'X-Entity-Ref-ID': lead?.id || '' },
    tags: [{ name: 'type', value: 'lead_notification' }],
  }, 'email.quote-notification', current, { firstName: lead?.firstName || 'there', customerName: name, customerEmail: lead?.email || 'the customer', service });
}

/**
 * Send the customer a receipt confirming Studio 37 received their request.
 * @param {object} lead Persisted lead from quote-request.mjs.
 * @param {object} [labels] Pre-resolved human labels: { service }.
 */
export function buildLeadAcknowledgement(lead, labels = {}, current = defaultEmailCopy('email.quote-acknowledgement')) {
  const from = process.env.RESEND_FROM || DEFAULT_FROM;
  const replyTo = process.env.RESEND_REPLY_TO || DEFAULT_REPLY_TO;

  const firstName = lead?.firstName || 'there';
  const service = labels.service || lead?.service || 'your project';
  const subject = `We got your request — Studio 37 Custom Designs`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5efe4;font-family:Georgia,'Times New Roman',serif;color:#3a322a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5efe4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fffaf1;border:1px solid #e2d8c4;border-radius:6px;">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <h1 style="margin:0 0 4px;font-size:22px;font-weight:normal;letter-spacing:0.04em;color:#3a322a;">Studio 37 Custom Designs</h1>
          <p style="margin:0;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9a8b73;">Request received</p>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <!--studio37-email-narrative-->
          <p>Service: <strong>${escapeHtml(service)}</strong></p>
          <p><a href="tel:+15415147720" style="color:#9a6a3a;">(541) 514-7720</a></p>
        </td></tr>
        <tr><td style="padding:16px 32px 32px;text-align:center;border-top:1px solid #e9e3d8;">
          <p style="margin:0;font-size:12px;letter-spacing:0.08em;color:#9a8b73;">&mdash; Studio 37 Custom Designs</p>
          <p style="margin:6px 0 0;font-size:12px;color:#9a8b73;"><a href="https://studio37customdesigns.com" style="color:#9a6a3a;text-decoration:none;">studio37customdesigns.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Studio 37 Custom Designs — Request received`,
    '',
    '[[studio37-email-narrative]]',
    '',
    `Service: ${service}`,
    '(541) 514-7720',
    '',
    '— Studio 37 Custom Designs',
    'https://studio37customdesigns.com',
  ].join('\n');

  return applyEmailCopy({
    from,
    to: lead.email,
    reply_to: replyTo,
    subject,
    html,
    text,
    headers: { 'X-Entity-Ref-ID': lead.id || '' },
    tags: [{ name: 'type', value: 'lead_acknowledgement' }],
  }, 'email.quote-acknowledgement', current, { firstName, customerName: leadFullName(lead), service });
}

const QUOTE_PROVIDER_CODES = new Set([
  'invalid_idempotency_key', 'validation_error', 'missing_api_key', 'restricted_api_key',
  'invalid_api_key', 'not_found', 'method_not_allowed', 'invalid_idempotent_request',
  'concurrent_idempotent_requests', 'invalid_attachment', 'invalid_from_address',
  'invalid_access', 'invalid_parameter', 'invalid_region', 'missing_required_field',
  'monthly_quota_exceeded', 'daily_quota_exceeded', 'rate_limit_exceeded',
  'security_error', 'application_error', 'internal_server_error',
]);

function quoteProviderDetails(error) {
  const details = {};
  if (QUOTE_PROVIDER_CODES.has(error?.name)) details.providerCode = error.name;
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 100 && error.statusCode <= 599) {
    details.providerStatus = error.statusCode;
  }
  return details;
}

export async function sendQuoteEmail(message, idempotencyKey) {
  const resend = client();
  if (!resend) return { ok: false, skipped: true, error: 'no_api_key' };
  try {
    validateEmailHeaders(message);
    const { data, error } = await resend.emails.send(message, { idempotencyKey });
    if (error) {
      return { ok: false, error: 'send_failed', ...quoteProviderDetails(error) };
    }
    if (typeof data?.id !== 'string' || !data.id.trim()) return { ok: false, error: 'missing_message_id' };
    return { ok: true, id: data?.id };
  } catch (error) {
    return { ok: false, error: 'exception', ...quoteProviderDetails(error) };
  }
}

export async function sendLeadNotification(lead, labels = {}) {
  const snapshot = await prepareQuoteEmailSnapshots(lead, labels);
  return sendQuoteEmail(snapshot.notification, `quote-notification/${lead?.id || ''}`);
}

export async function sendLeadAcknowledgement(lead, labels = {}) {
  if (!process.env.RESEND_API_KEY) return { ok: false, skipped: true, error: 'no_api_key' };
  if (!lead?.email) return { ok: false, skipped: true, error: 'no_recipient' };
  const snapshot = await prepareQuoteEmailSnapshots(lead, labels);
  return sendQuoteEmail(snapshot.acknowledgement, `quote-acknowledgement/${lead.id}`);
}

export async function prepareQuoteEmailSnapshots(lead, labels = {}, read = readEmailCopy) {
  const scopes = ['email.quote-notification', 'email.quote-acknowledgement'];
  const records = await Promise.all(scopes.map((scope) => read(scope)));
  return {
    notification: buildLeadNotification(lead, labels, records[0]),
    acknowledgement: buildLeadAcknowledgement(lead, labels, records[1]),
    templates: Object.fromEntries(scopes.map((scope, i) => [scope, {
      schema: records[i].schema, revision: records[i].revision, fallback: !!records[i].fallback,
    }])),
  };
}
