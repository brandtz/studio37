// Resend transactional email helper.
// All functions are best-effort: they log + return on missing env or send errors
// so the caller (e.g. stripe-webhook) never fails because email failed.
//
// Env vars (set in Netlify):
//   RESEND_API_KEY     required — Production API key from resend.com
//   RESEND_FROM        optional — defaults to "Studio 37 Custom Designs <orders@studio37customdesigns.com>"
//   RESEND_REPLY_TO    optional — defaults to "Drew@studio37customdesigns.com"

import { Resend } from 'resend';

const DEFAULT_FROM = 'Studio 37 Custom Designs <orders@studio37customdesigns.com>';
const DEFAULT_REPLY_TO = 'Drew@studio37customdesigns.com';

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
export async function sendOrderConfirmation(order) {
  const resend = client();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping order confirmation');
    return { ok: false, skipped: true, error: 'no_api_key' };
  }
  if (!order?.customer_email) {
    console.warn('[email] order missing customer_email — skipping', order?.id);
    return { ok: false, skipped: true, error: 'no_recipient' };
  }

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
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Thanks for your order from Studio 37 Custom Designs. Drew has been notified and your order is in the queue.</p>
        </td></tr>
        <tr><td style="padding:0 32px;">
          ${itemsHtml}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;">
            ${subtotal ? `<tr><td style="padding:4px 0;color:#6e6055;">Subtotal</td><td style="padding:4px 0;text-align:right;color:#6e6055;">${subtotal}</td></tr>` : ''}
            ${total ? `<tr><td style="padding:8px 0 0;font-weight:bold;color:#3a322a;border-top:1px solid #e9e3d8;">Total</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#3a322a;border-top:1px solid #e9e3d8;">${total}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;">
          <h3 style="margin:16px 0 8px;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:#9a8b73;font-weight:normal;">What's next</h3>
          <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">In-stock goods ship in 3–7 business days. Custom pieces follow the timeline we discussed — Drew will reach out with an update as your piece progresses.</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Questions? Reply to this email or call Drew at <a href="tel:+15415147720" style="color:#9a6a3a;text-decoration:none;">(541) 514-7720</a>.</p>
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
    `Hi ${firstName},`,
    '',
    'Thanks for your order from Studio 37 Custom Designs. Drew has been notified and your order is in the queue.',
    '',
    itemsText,
    subtotal ? `  Subtotal: ${subtotal}` : null,
    total ? `  Total:    ${total}` : null,
    '',
    'What\'s next:',
    'In-stock goods ship in 3–7 business days. Custom pieces follow the timeline we discussed — Drew will reach out with an update as your piece progresses.',
    '',
    'Questions? Reply to this email or call Drew at (541) 514-7720.',
    '',
    '— Studio 37 Custom Designs',
    'https://studio37customdesigns.com',
  ].filter((l) => l !== null).join('\n');

  try {
    const { data, error } = await resend.emails.send({
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
    });
    if (error) {
      console.error('[email] resend send error', error);
      return { ok: false, error: error.message || 'send_failed' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[email] resend exception', err);
    return { ok: false, error: err?.message || 'exception' };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Lead / quote-request emails
// ──────────────────────────────────────────────────────────────────────────────

const DREW_NOTIFY_TO = 'Drew@studio37customdesigns.com';

function leadFullName(lead) {
  return `${lead?.firstName || ''} ${lead?.lastName || ''}`.trim() || 'Unknown';
}

/**
 * Notify Drew that a new quote request came in.
 * @param {object} lead Persisted lead from quote-request.mjs.
 * @param {object} [labels] Pre-resolved human labels: { service, budget }.
 */
export async function sendLeadNotification(lead, labels = {}) {
  const resend = client();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping lead notify');
    return { ok: false, skipped: true, error: 'no_api_key' };
  }

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
    ['Budget', budget],
    ['Location', location],
    ['Contact preference', contactPref],
    ['Heard about us', referral],
  ].filter(([, v]) => v);

  const rowsHtml = rows.map(([k, v]) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6e6055;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:6px 0;color:#3a322a;">${escapeHtml(v)}</td></tr>`,
  ).join('');

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
        </td></tr>
        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:13px;color:#6e6055;">Reply to this email to respond to ${escapeHtml(lead?.email || 'the customer')} directly, or view the full lead in the admin dashboard.</p>
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
    `Reply to this email to respond to ${lead?.email || 'the customer'} directly.`,
    `Admin: https://studio37customdesigns.com/admin#leads`,
  ].join('\n');

  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      reply_to: replyTo,
      subject,
      html,
      text,
      headers: { 'X-Entity-Ref-ID': lead?.id || '' },
      tags: [{ name: 'type', value: 'lead_notification' }],
    });
    if (error) {
      console.error('[email] lead notify send error', error);
      return { ok: false, error: error.message || 'send_failed' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[email] lead notify exception', err);
    return { ok: false, error: err?.message || 'exception' };
  }
}

/**
 * Send the customer a receipt confirming Studio 37 received their request.
 * @param {object} lead Persisted lead from quote-request.mjs.
 * @param {object} [labels] Pre-resolved human labels: { service }.
 */
export async function sendLeadAcknowledgement(lead, labels = {}) {
  const resend = client();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping lead acknowledgement');
    return { ok: false, skipped: true, error: 'no_api_key' };
  }
  if (!lead?.email) {
    return { ok: false, skipped: true, error: 'no_recipient' };
  }

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
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Hi ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">Thanks for reaching out about <strong>${escapeHtml(service)}</strong>. Your request is in front of Drew now &mdash; he'll usually get back to you within 1&ndash;2 business days with next steps, follow-up questions, or a quote.</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.55;">If your project is time-sensitive, feel free to call or text Drew directly at <a href="tel:+15415147720" style="color:#9a6a3a;text-decoration:none;">(541) 514-7720</a>.</p>
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
    `Hi ${firstName},`,
    '',
    `Thanks for reaching out about ${service}. Your request is in front of Drew now — he'll usually get back to you within 1–2 business days with next steps, follow-up questions, or a quote.`,
    '',
    'If your project is time-sensitive, feel free to call or text Drew directly at (541) 514-7720.',
    '',
    '— Studio 37 Custom Designs',
    'https://studio37customdesigns.com',
  ].join('\n');

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: lead.email,
      reply_to: replyTo,
      subject,
      html,
      text,
      headers: { 'X-Entity-Ref-ID': lead.id || '' },
      tags: [{ name: 'type', value: 'lead_acknowledgement' }],
    });
    if (error) {
      console.error('[email] lead ack send error', error);
      return { ok: false, error: error.message || 'send_failed' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[email] lead ack exception', err);
    return { ok: false, error: err?.message || 'exception' };
  }
}
