// POST /api/order-notify
// Snipcart webhook receiver. Sends an SMS to Drew when an order is completed.
// Configure this endpoint in Snipcart's dashboard under Account → Webhooks.

import { json } from './_lib/store.mjs';
import twilio from 'twilio';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Optional: verify Snipcart signature header. Snipcart provides
  // `X-Snipcart-RequestToken` which can be validated against the public API.
  // For now we accept and log; tighten before launch.

  const evt = await req.json().catch(() => null);
  if (!evt || evt.eventName !== 'order.completed') {
    return json({ ok: true, skipped: true });
  }

  const order = evt.content || {};
  const items = order.items || [];
  const summary = items.map((i) => `${i.quantity}× ${i.name}`).join(', ').slice(0, 200);
  const buyer = `${order.billingAddress?.firstName || ''} ${order.billingAddress?.lastName || ''}`.trim();
  const where = [order.billingAddress?.city, order.billingAddress?.province].filter(Boolean).join(', ');

  try {
    const { TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, DREW_PHONE } = process.env;
    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && DREW_PHONE) {
      const client = twilio(TWILIO_SID, TWILIO_TOKEN);
      const msg = [
        `🛒 New Studio 37 Order!`,
        summary ? `Items: ${summary}` : null,
        order.finalGrandTotal != null ? `Total: $${order.finalGrandTotal.toFixed(2)}` : null,
        buyer ? `Buyer: ${buyer}${where ? ` (${where})` : ''}` : null,
        `Open Snipcart for full details.`,
      ].filter(Boolean).join('\n');
      await client.messages.create({ from: TWILIO_FROM, to: DREW_PHONE, body: msg });
    }
  } catch (e) {
    console.error('order SMS failed', e);
  }

  return json({ ok: true });
};

export const config = { path: '/.netlify/functions/order-notify' };
