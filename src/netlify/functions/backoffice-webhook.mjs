// POST /api/webhooks/backoffice
// Receives signed outbound webhooks from Back Office (gilgameh):
//   X-BackOffice-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
// Register this URL in Back Office → Webhooks & Integrations for
// order.created, order.status_changed, quote.accepted and invoice.paid, then
// put the generated secret in BACKOFFICE_OUTBOUND_WEBHOOK_SECRET.

import { json, logAudit } from './_lib/store.mjs';
import { backOfficeConfig, verifyBackOfficeSignature } from './_lib/backoffice.mjs';
import {
  applyBackOfficeStatus, noteBackOfficeOrderCreated, rememberPendingStatus, resolveLocalOrderId,
} from './_lib/backoffice-orders.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const ORDER_STATUSES = new Set(['pending', 'confirmed', 'in_production', 'ready', 'fulfilled', 'cancelled']);
const ACTOR = 'Back Office';

function toIso(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value > 1e11 ? value : value * 1000).toISOString();
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Shallow, primitive-only copy for the audit log.
function auditData(data) {
  const out = {};
  for (const [key, value] of Object.entries(data).slice(0, 20)) {
    if (['string', 'number', 'boolean'].includes(typeof value)) out[key] = typeof value === 'string' ? value.slice(0, 200) : value;
  }
  return out;
}

async function onStatusChanged(data, at, req) {
  const boOrderId = typeof data.orderId === 'string' ? data.orderId : '';
  const status = typeof data.status === 'string' ? data.status : '';
  if (!boOrderId || !ORDER_STATUSES.has(status)) return { received: true, ignored: true };

  const resolved = await resolveLocalOrderId(boOrderId);
  if (resolved.ignored) return { received: true, ignored: true };
  if (resolved.unresolved) {
    // Our POST hasn't been answered/linked yet — applied once it is.
    await rememberPendingStatus(boOrderId, status, at);
    return { received: true, pending: true };
  }

  const res = await applyBackOfficeStatus(resolved.localOrderId, status, {
    at,
    orderNumber: typeof data.orderNumber === 'string' ? data.orderNumber : resolved.orderNumber,
  });
  if (res.applied) {
    await logAudit({
      actor: ACTOR,
      action: res.changed ? 'order.lifecycle_change' : 'order.backoffice_status',
      entity: 'order',
      entity_id: resolved.localOrderId,
      before: { lifecycle: res.before },
      after: { lifecycle: res.lifecycle, backoffice_status: status },
      req,
      meta: { backoffice_order_id: boOrderId, order_number: data.orderNumber || null },
    });
  }
  return { received: true, applied: res.applied, lifecycle: res.lifecycle || null };
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const { outboundSecret } = backOfficeConfig();
  if (!outboundSecret) return json({ error: 'webhook_not_configured' }, 503);

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const verified = verifyBackOfficeSignature(raw, req.headers.get('x-backoffice-signature') || '', outboundSecret);
  if (!verified.ok) return json({ error: 'invalid_signature' }, 401);

  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!evt || typeof evt.event !== 'string' || !evt.data || typeof evt.data !== 'object') {
    return json({ error: 'invalid_payload' }, 400);
  }
  const at = toIso(evt.timestamp) || new Date(verified.timestamp * 1000).toISOString();

  try {
    switch (evt.event) {
      case 'order.status_changed':
        return json(await onStatusChanged(evt.data, at, req));
      case 'order.created': {
        const boOrderId = typeof evt.data.orderId === 'string' ? evt.data.orderId : '';
        if (!boOrderId) return json({ received: true, ignored: true });
        await noteBackOfficeOrderCreated(boOrderId, {
          orderNumber: typeof evt.data.orderNumber === 'string' ? evt.data.orderNumber : null,
          ignored: evt.data.channel !== 'website',
        });
        return json({ received: true });
      }
      case 'quote.accepted':
      case 'invoice.paid': {
        const entity = evt.event.split('.')[0];
        await logAudit({
          actor: ACTOR,
          action: `backoffice.${evt.event}`,
          entity,
          entity_id: evt.data.quoteId || evt.data.invoiceId || evt.data.id || '',
          after: auditData(evt.data),
          req,
        });
        return json({ received: true });
      }
      default:
        return json({ received: true, ignored: true });
    }
  } catch (err) {
    // 5xx → Back Office retries with backoff.
    console.error('[backoffice-webhook] processing failed', evt.event, err?.message || err);
    return json({ error: 'processing_failed' }, 500);
  }
};

export const config = { path: '/api/webhooks/backoffice' };
