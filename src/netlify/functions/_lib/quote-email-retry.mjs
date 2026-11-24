import { leadStore, quoteEmailStore } from './store.mjs';
import { sendQuoteEmail } from './email.mjs';

const MINUTE = 60 * 1000;
const SLOTS = [0, 5, 15, 45, 120, 360, 720].map((n) => n * MINUTE);
const MAX_AGE = 18 * 60 * MINUTE;
const TYPES = ['notification', 'acknowledgement'];

// Each slot is recorded before sending. Overlapping workers use the same
// provider idempotency key and payload; Blob v8 does not offer atomic claims.
export async function processQuoteEmails(lead, now = Date.now(), limit = TYPES.length) {
  const queue = lead?.quoteEmails;
  if (queue?.version !== 1 || !Number.isFinite(queue.queuedAt)) return 0;
  const age = now - queue.queuedAt;
  if (age < 0 || age >= MAX_AGE) return 0;
  const slot = SLOTS.findLastIndex((delay) => age >= delay);
  const store = quoteEmailStore();
  let attempted = 0;

  for (const type of TYPES) {
    if (attempted >= limit) break;
    try {
      if (!queue[type]) continue;
      const base = `${lead.id}/${type}`;
      if (await store.get(`${base}/sent`, { type: 'json' })) continue;
      const attemptKey = `${base}/attempt-${slot}`;
      if (await store.get(attemptKey, { type: 'json' })) continue;
      await store.setJSON(attemptKey, { startedAt: new Date(now).toISOString() });
      attempted++;
      const result = await sendQuoteEmail(queue[type], `quote-${type}/${lead.id}`);
      if (result.ok) {
        await store.setJSON(`${base}/sent`, { sentAt: new Date().toISOString(), id: result.id || null });
      } else {
        const failure = {
          error: result.error || 'send_failed',
          ...(result.providerCode ? { providerCode: result.providerCode } : {}),
          ...(result.providerStatus ? { providerStatus: result.providerStatus } : {}),
        };
        console.error(`[quote-email] ${type} failed for ${lead.id}`, failure);
        await store.setJSON(attemptKey, { startedAt: new Date(now).toISOString(), ...failure });
      }
    } catch {
      console.error(`[quote-email] ${type} processing failed for ${lead.id}`);
    }
  }
  return attempted;
}

export async function retryQuoteEmails(now = Date.now()) {
  const deadline = Date.now() + 20000;
  const store = leadStore();
  const { blobs } = await store.list();
  // Lead keys begin with their creation timestamp. Avoid loading historical
  // leads and process older pending work first.
  const recent = (blobs || [])
    .filter(({ key }) => {
      const match = /^(\d{13})-/.exec(key);
      return match && now - Number(match[1]) >= 0 && now - Number(match[1]) < MAX_AGE;
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  let attempts = 0;
  for (const { key } of recent) {
    if (Date.now() >= deadline || attempts >= 20) break;
    const lead = await store.get(key, { type: 'json' });
    attempts += await processQuoteEmails(lead, now, 20 - attempts);
  }
  return attempts;
}
