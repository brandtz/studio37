import { getStore } from '@netlify/blobs';
import { validateEmailHeaders } from './email-content.mjs';

export const ORDER_EMAIL_SNAPSHOT_STORE = 'order_email_snapshots_v1';
export class OrderEmailSnapshotError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function validate(record, orderId, type) {
  const fail = () => { throw new OrderEmailSnapshotError('snapshot_invalid'); };
  if (!record || record.version !== 1 || record.orderId !== orderId || record.type !== type ||
      record.idempotencyKey !== `order-${type}/${orderId}` ||
      typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) fail();
  const message = record.message;
  if (!message || typeof message !== 'object' || Array.isArray(message) ||
      Object.keys(message).some((key) => !['from', 'to', 'reply_to', 'subject', 'html', 'text', 'headers', 'tags'].includes(key))) fail();
  for (const field of ['from', 'to', 'reply_to', 'subject', 'html', 'text']) {
    if (typeof message[field] !== 'string' || !message[field].trim()) fail();
  }
  if (['from', 'to', 'reply_to'].some((field) => /[\u0000-\u001f\u007f]/.test(message[field]))) fail();
  if (JSON.stringify(message).length > 500000 ||
      message.headers?.['X-Entity-Ref-ID'] !== orderId ||
      Object.keys(message.headers || {}).length !== 1 ||
      !Array.isArray(message.tags) ||
      message.tags.some((tag) => !tag || typeof tag.name !== 'string' || typeof tag.value !== 'string') ||
      !message.tags.some((tag) => tag.name === 'type' && tag.value === `order_${type}`)) fail();
  try { validateEmailHeaders(message); } catch { fail(); }
  return record;
}

export function createOrderEmailSnapshotRepository({
  store = () => getStore({ name: ORDER_EMAIL_SNAPSHOT_STORE, consistency: 'strong' }),
} = {}) {
  return {
    async getOrCreate(orderId, type, render) {
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(orderId || '') || !['notification', 'confirmation'].includes(type)) {
        throw new OrderEmailSnapshotError('snapshot_invalid');
      }
      const key = `${orderId}/${type}`;
      try {
        const blobs = store();
        const existing = await blobs.get(key, { type: 'json', consistency: 'strong' });
        if (existing !== null) return validate(existing, orderId, type);
        const candidate = validate({
          version: 1, orderId, type, createdAt: new Date().toISOString(),
          idempotencyKey: `order-${type}/${orderId}`, message: await render(),
        }, orderId, type);
        const result = await blobs.setJSON(key, candidate, { onlyIfNew: true });
        if (typeof result?.modified !== 'boolean') throw new OrderEmailSnapshotError('snapshot_unavailable');
        // Always read the committed winner, including when this invocation lost
        // creation to another webhook. Never send a losing or unconfirmed payload.
        const winner = await blobs.get(key, { type: 'json', consistency: 'strong' });
        if (winner === null) throw new OrderEmailSnapshotError('snapshot_unavailable');
        return validate(winner, orderId, type);
      } catch (error) {
        if (error instanceof OrderEmailSnapshotError) throw error;
        throw new OrderEmailSnapshotError('snapshot_unavailable');
      }
    },
  };
}

export const orderEmailSnapshots = createOrderEmailSnapshotRepository();
