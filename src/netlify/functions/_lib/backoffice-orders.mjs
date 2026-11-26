// Paid storefront checkouts → Back Office orders (production queue +
// inventory), and Back Office order status → storefront order lifecycle.
//
// Reachable from stripe-webhook.mjs: import only `orderStore` from stripe.mjs
// and nothing from store.mjs. Everything is a no-op until the Back Office
// website webhook secret is configured.

import { getStore } from '@netlify/blobs';
import { orderStore } from './stripe.mjs';
import { backOfficeApi, backOfficeApiConfigured, BackOfficeError, isUuid, postWebsiteEvent, websiteWebhookConfigured } from './backoffice.mjs';
import { outboxStore, runSyncAttempt } from './backoffice-sync.mjs';
import { getCatalogLink } from './backoffice-catalog.mjs';

// Back Office order id → { local_order_id, order_number, pending_status, ignored }
export const orderIndexStore = () => getStore({ name: 'backoffice_order_index', consistency: 'strong' });

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SYNCABLE_PAYMENT = new Set(['paid', 'no_payment_required']);
const RECONCILE_PAGES = 5;
const RECONCILE_MARGIN_MS = 60 * 60 * 1000;

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const toCents = (value) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : null);

export function isSyncableOrder(order) {
  return order?.source === 'website_checkout'
    && SYNCABLE_PAYMENT.has(order.payment_status)
    && order.backoffice_sync?.state !== 'skipped';
}

function unitPriceCents(item, quantity) {
  if (Number.isInteger(item.unit_amount)) return Math.max(0, item.unit_amount);
  const subtotal = toCents(item.amount_subtotal);
  if (subtotal !== null) return Math.round(subtotal / quantity);
  const total = toCents(item.amount_total);
  return total !== null ? Math.round(total / quantity) : 0;
}

export async function buildOrderPayload(order) {
  const lines = [];
  for (const item of Array.isArray(order.items) ? order.items : []) {
    const quantity = Number.isInteger(item?.quantity) && item.quantity > 0 ? item.quantity : 1;
    const line = {
      description: clean(item?.description, 500) || 'Storefront item',
      quantity,
      unitPriceCents: unitPriceCents(item || {}, quantity),
    };
    const link = item?.product_id ? await getCatalogLink(item.product_id) : null;
    if (isUuid(link?.catalog_item_id)) line.catalogItemId = link.catalog_item_id;
    lines.push(line);
  }
  if (!lines.length) {
    lines.push({
      description: `Website order ${order.id}`,
      quantity: 1,
      unitPriceCents: toCents(order.amount_subtotal) ?? toCents(order.amount_total) ?? 0,
    });
  }

  const customer = {
    name: clean(order.customer_name, 200) || clean(order.shipping_name, 200) || clean(order.customer_email, 200) || 'Website customer',
  };
  const email = clean(order.customer_email, 254);
  if (EMAIL_RE.test(email)) customer.email = email;
  const phone = clean(order.customer_phone, 32);
  if (phone) customer.phone = phone;

  return { eventId: `order_${order.id}`, type: 'order', externalOrderId: order.id, customer, lines };
}

// ── status mapping ─────────────────────────────────────────────────────────

const STATUS_TO_LIFECYCLE = {
  in_production: 'in_production',
  ready: 'ready_to_ship',
  fulfilled: 'complete',
  cancelled: 'cancelled',
};
const FORWARD = ['new', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'complete'];

/**
 * Storefront lifecycle stage for a Back Office status, or null when the
 * order should not move. Only moves forward, never reopens cancelled or
 * refunded orders, and never cancels a completed one.
 */
export function nextLifecycle(current, boStatus) {
  const target = STATUS_TO_LIFECYCLE[boStatus];
  const from = current || 'new';
  if (!target || from === target || from === 'cancelled' || from === 'refunded') return null;
  if (target === 'cancelled') return from === 'complete' ? null : 'cancelled';
  const fromIndex = FORWARD.indexOf(from);
  return fromIndex !== -1 && FORWARD.indexOf(target) > fromIndex ? target : null;
}

/** Apply a Back Office status to a storefront order; ignores out-of-order events. */
export async function applyBackOfficeStatus(localOrderId, status, { at = new Date().toISOString(), orderNumber = null } = {}) {
  const store = orderStore();
  const order = await store.get(localOrderId, { type: 'json' });
  if (!order) return { applied: false, reason: 'order_missing' };
  const previousAt = Date.parse(order.backoffice_status_at || '') || 0;
  if (previousAt && Date.parse(at) < previousAt) return { applied: false, reason: 'stale' };

  const next = { ...order, backoffice_status: status, backoffice_status_at: at };
  if (orderNumber) next.backoffice_order_number = orderNumber;
  const lifecycle = nextLifecycle(order.lifecycle, status);
  if (lifecycle) {
    const nowIso = new Date().toISOString();
    next.lifecycle = lifecycle;
    next.lifecycle_at = nowIso;
    next.status_history = [
      ...(Array.isArray(order.status_history) ? order.status_history : []),
      { stage: lifecycle, at: nowIso, by: 'Back Office' },
    ];
  }
  await store.setJSON(localOrderId, next);
  return { applied: true, lifecycle: lifecycle || order.lifecycle, changed: !!lifecycle, before: order.lifecycle };
}

// ── Back Office order ↔ storefront order links ─────────────────────────────

async function markOrderSynced(localOrderId, link) {
  const store = orderStore();
  const order = await store.get(localOrderId, { type: 'json' });
  if (!order) return;
  const current = order.backoffice_sync || {};
  const next = {
    ...order,
    backoffice_sync: {
      ...current,
      state: 'synced',
      order_id: link.order_id,
      order_number: link.order_number || current.order_number || null,
      customer_id: link.customer_id || current.customer_id || null,
      synced_at: current.synced_at || new Date().toISOString(),
      reconciled: current.state !== 'synced' ? true : current.reconciled,
      error: null,
    },
  };
  if (link.order_number) next.backoffice_order_number = link.order_number;
  await store.setJSON(localOrderId, next);
  await outboxStore().delete(`order/${localOrderId}`).catch(() => {});
}

/** Record the Back Office ↔ storefront link and apply any status that arrived first. */
export async function linkBackOfficeOrder(boOrderId, localOrderId, { orderNumber = null } = {}) {
  const store = orderIndexStore();
  const previous = (await store.get(boOrderId, { type: 'json' }).catch(() => null)) || {};
  const pending = previous.pending_status || null;
  await store.setJSON(boOrderId, {
    local_order_id: localOrderId,
    order_number: orderNumber || previous.order_number || null,
    linked_at: new Date().toISOString(),
  });
  if (pending?.status) {
    await applyBackOfficeStatus(localOrderId, pending.status, { at: pending.at, orderNumber: orderNumber || previous.order_number });
  }
}

/**
 * Remember an order.created event (it arrives before Back Office answers our
 * POST). Orders from other channels are cached as ignored so their status
 * events never trigger a lookup.
 */
export async function noteBackOfficeOrderCreated(boOrderId, { orderNumber = null, ignored = false } = {}) {
  const store = orderIndexStore();
  const previous = (await store.get(boOrderId, { type: 'json' }).catch(() => null)) || {};
  if (ignored && !previous.local_order_id) {
    await store.setJSON(boOrderId, { ignored: true, order_number: orderNumber || null });
    return;
  }
  await store.setJSON(boOrderId, { ...previous, order_number: orderNumber || previous.order_number || null });
  if (previous.local_order_id && orderNumber) {
    const order = await orderStore().get(previous.local_order_id, { type: 'json' });
    if (order && order.backoffice_order_number !== orderNumber) {
      await orderStore().setJSON(previous.local_order_id, { ...order, backoffice_order_number: orderNumber });
    }
  }
}

export async function rememberPendingStatus(boOrderId, status, at) {
  const store = orderIndexStore();
  const previous = (await store.get(boOrderId, { type: 'json' }).catch(() => null)) || {};
  const prevAt = Date.parse(previous.pending_status?.at || '') || 0;
  if (prevAt && Date.parse(at) < prevAt) return;
  await store.setJSON(boOrderId, { ...previous, pending_status: { status, at } });
}

/**
 * Find the storefront order for a Back Office order id: the local index
 * first, then (with an API key) Back Office's own `externalOrderId`.
 * → { localOrderId } | { ignored: true } | { unresolved: true }
 */
export async function resolveLocalOrderId(boOrderId) {
  const store = orderIndexStore();
  const entry = await store.get(boOrderId, { type: 'json' }).catch(() => null);
  if (entry?.local_order_id) return { localOrderId: entry.local_order_id, orderNumber: entry.order_number || null };
  if (entry?.ignored) return { ignored: true };
  if (!backOfficeApiConfigured()) return { unresolved: true };

  let data = null;
  try {
    ({ data } = await backOfficeApi('GET', `/orders/${encodeURIComponent(boOrderId)}`, { timeoutMs: 4000 }));
  } catch (err) {
    if (err instanceof BackOfficeError && err.status === 404) return { unresolved: true };
    throw err;
  }
  if (!data || data.channel !== 'website' || !data.externalOrderId) {
    await store.setJSON(boOrderId, { ...(entry || {}), ignored: true });
    return { ignored: true };
  }
  const local = await orderStore().get(String(data.externalOrderId), { type: 'json' });
  if (!local) return { unresolved: true };
  await markOrderSynced(local.id, { order_id: boOrderId, order_number: data.orderNumber, customer_id: data.customerId });
  await linkBackOfficeOrder(boOrderId, local.id, { orderNumber: data.orderNumber });
  return { localOrderId: local.id, orderNumber: data.orderNumber || null };
}

/** Look for an order Back Office may already have created from an earlier, unanswered POST. */
async function findBackOfficeOrder(order) {
  if (!backOfficeApiConfigured()) return undefined;
  const cutoff = (Date.parse(order.created_at || '') || Date.now()) - RECONCILE_MARGIN_MS;
  for (let page = 1; page <= RECONCILE_PAGES; page++) {
    const { data = [], meta = {} } = await backOfficeApi('GET', `/orders?channel=website&limit=100&page=${page}`, { timeoutMs: 5000 });
    const hit = data.find((row) => row?.externalOrderId === order.id);
    if (hit) return hit;
    const oldest = data[data.length - 1];
    if (!meta.hasMore || !data.length) return null;
    if (oldest?.createdAt && Date.parse(oldest.createdAt) < cutoff) return null;
  }
  return undefined;
}

export const orderSyncHandler = {
  kind: 'order',
  enabled: websiteWebhookConfigured,
  load: (id) => orderStore().get(id, { type: 'json' }),
  async update(id, fn) {
    const store = orderStore();
    const next = fn(await store.get(id, { type: 'json' }));
    if (next) await store.setJSON(id, next);
  },
  eligible: isSyncableOrder,
  async send(order, { timeoutMs } = {}) {
    const data = await postWebsiteEvent(await buildOrderPayload(order), { timeoutMs });
    if (data.orderId) {
      // Only network errors may escape send(); the order exists in Back Office now.
      // Status webhooks re-resolve an unlinked order via the API when a key is set.
      await linkBackOfficeOrder(data.orderId, order.id, { orderNumber: data.orderNumber })
        .catch(() => console.warn('[backoffice-orders] could not record link for', order.id));
    }
    return { order_id: data.orderId || null, order_number: data.orderNumber || null, customer_id: data.customerId || null };
  },
  async reconcile(order) {
    const hit = await findBackOfficeOrder(order);
    if (!hit) return hit;
    await linkBackOfficeOrder(hit.id, order.id, { orderNumber: hit.orderNumber });
    return { order_id: hit.id, order_number: hit.orderNumber || null, customer_id: hit.customerId || null };
  },
};

export function syncOrderToBackOffice(id, opts = {}) {
  return runSyncAttempt(orderSyncHandler, id, opts);
}
