// Durable, duplicate-safe delivery of storefront records to Back Office.
//
// Back Office does not dedupe inbound website events, so every send goes
// through here:
//   • a per-record lock stops concurrent sends (webhook retries, the
//     scheduled retry job and admin retries can overlap);
//   • an outbox entry is written before every send so a failure or crash is
//     retried by the scheduled job with backoff;
//   • an ambiguous outcome (timeout / 5xx — Back Office may have created it)
//     is reconciled against the Back Office API before re-sending when the
//     handler supports it.
//
// Handler contract:
//   kind               'lead' | 'order'
//   enabled()          false → every call is a no-op (no store access)
//   load(id)           → record | null
//   update(id, fn)     re-reads the record, applies fn(record) → record|null, saves
//   eligible(record)   → boolean
//   send(record, opts) → result object merged into record.backoffice_sync
//   reconcile(record)  optional → result (found) | null (not found) | undefined (unknown)

import { getStore } from '@netlify/blobs';
import { errorSummary } from './backoffice.mjs';

export const MAX_ATTEMPTS = 6;
export const BACKOFF_MINUTES = [0, 5, 30, 60, 180, 360];
const IN_FLIGHT_GRACE_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 2 * 60 * 1000;
const MAX_LOCK_SLOTS = 25;

export const outboxStore = () => getStore({ name: 'backoffice_outbox', consistency: 'strong' });
const lockStore = () => getStore({ name: 'backoffice_sync_locks', consistency: 'strong' });

const outboxKey = (kind, id) => `${kind}/${id}`;
const iso = (ms) => new Date(ms).toISOString();

async function acquireLock(key, now) {
  const store = lockStore();
  for (let slot = 0; slot < MAX_LOCK_SLOTS; slot++) {
    const lockKey = `${key}/${slot}`;
    const res = await store.setJSON(lockKey, { at: now }, { onlyIfNew: true });
    if (res?.modified) return lockKey;
    const existing = await store.get(lockKey, { type: 'json' }).catch(() => null);
    // A crashed holder never releases its slot; once stale, move to the next one.
    if (existing && now - Number(existing.at || 0) < LOCK_STALE_MS) return null;
  }
  return null;
}

async function releaseLock(lockKey) {
  await lockStore().delete(lockKey).catch(() => {});
}

async function persistSync(handler, id, patch) {
  let saved = null;
  await handler.update(id, (record) => {
    if (!record) return null;
    const current = record.backoffice_sync || {};
    // Never downgrade a record another attempt already marked synced.
    if (current.state === 'synced' && patch.state !== 'synced') return null;
    saved = { ...current, ...patch };
    return { ...record, backoffice_sync: saved };
  });
  return saved;
}

/**
 * Attempt one delivery of `kind/id`. Never throws for Back Office failures;
 * the returned `status` describes the outcome.
 */
export async function runSyncAttempt(handler, id, {
  record: given = null,
  timeoutMs,
  ignoreLimits = false,
  now = Date.now(),
} = {}) {
  if (!handler.enabled()) return { status: 'disabled' };
  const key = outboxKey(handler.kind, id);
  const outbox = outboxStore();

  let record = given || await handler.load(id);
  if (!record) {
    await outbox.delete(key).catch(() => {});
    return { status: 'missing' };
  }
  if (record.backoffice_sync?.state === 'synced') {
    await outbox.delete(key).catch(() => {});
    return { status: 'already_synced', sync: record.backoffice_sync };
  }
  if (!handler.eligible(record)) {
    await outbox.delete(key).catch(() => {});
    return { status: 'ineligible' };
  }

  const entry = await outbox.get(key, { type: 'json' }).catch(() => null);
  const attempts = Math.max(Number(entry?.attempts) || 0, Number(record.backoffice_sync?.attempts) || 0);
  if (!ignoreLimits && attempts >= MAX_ATTEMPTS) return { status: 'exhausted', attempts };
  const lastAt = Date.parse(entry?.last_attempt_at || record.backoffice_sync?.last_attempt_at || '') || 0;
  const lastState = entry?.last_state || record.backoffice_sync?.state || '';
  if (lastState === 'in_flight' && now - lastAt < IN_FLIGHT_GRACE_MS) return { status: 'in_progress' };

  const lockKey = await acquireLock(key, now);
  if (!lockKey) return { status: 'in_progress' };
  try {
    // Re-check under the lock: a concurrent attempt may have finished meanwhile.
    const fresh = await handler.load(id);
    if (fresh) record = fresh;
    if (record.backoffice_sync?.state === 'synced') {
      await outbox.delete(key).catch(() => {});
      return { status: 'already_synced', sync: record.backoffice_sync };
    }

    const ambiguous = attempts > 0 && lastState !== 'failed';
    if (ambiguous && handler.reconcile) {
      let found;
      try {
        found = await handler.reconcile(record);
      } catch {
        found = undefined;
      }
      if (found) {
        const sync = await persistSync(handler, id, {
          ...found,
          state: 'synced',
          reconciled: true,
          synced_at: iso(now),
          error: null,
        });
        await outbox.delete(key).catch(() => {});
        return { status: 'synced', reconciled: true, sync };
      }
      if (found === undefined) {
        await persistSync(handler, id, { state: 'needs_reconcile', error: 'Previous delivery outcome unknown; reconcile with Back Office before re-sending.' });
        return { status: 'needs_reconcile' };
      }
    }

    const attempt = attempts + 1;
    await outbox.setJSON(key, {
      kind: handler.kind,
      id,
      attempts: attempt,
      last_state: 'in_flight',
      last_attempt_at: iso(now),
      last_error: entry?.last_error || null,
    });

    let result;
    try {
      result = await handler.send(record, { timeoutMs });
    } catch (err) {
      const state = err?.ambiguous ? 'unknown' : 'failed';
      const error = errorSummary(err);
      await outbox.setJSON(key, {
        kind: handler.kind,
        id,
        attempts: attempt,
        last_state: state,
        last_attempt_at: iso(now),
        last_error: error,
      }).catch(() => {});
      await persistSync(handler, id, { state, attempts: attempt, last_attempt_at: iso(now), error }).catch(() => {});
      return { status: state, error };
    }

    // Back Office accepted the record: from here on a local failure must never
    // be recorded as 'failed', or the next attempt would send it again.
    try {
      const sync = await persistSync(handler, id, {
        ...result,
        state: 'synced',
        attempts: attempt,
        last_attempt_at: iso(now),
        synced_at: iso(Date.now()),
        error: null,
      });
      await outbox.delete(key).catch(() => {});
      return { status: 'synced', sync };
    } catch {
      const error = 'Delivered, but saving the result failed; will reconcile before re-sending.';
      // If this write fails too, the 'in_flight' entry still forces a reconcile.
      await outbox.setJSON(key, {
        kind: handler.kind,
        id,
        attempts: attempt,
        last_state: 'unknown',
        last_attempt_at: iso(now),
        last_error: error,
      }).catch(() => {});
      return { status: 'unknown', error };
    }
  } finally {
    await releaseLock(lockKey);
  }
}

export function nextAttemptDueAt(entry) {
  const attempts = Number(entry?.attempts) || 0;
  const delay = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
  return (Date.parse(entry?.last_attempt_at || '') || 0) + delay * 60 * 1000;
}

/** Retry queued deliveries. `handlers` maps kind → handler. */
export async function retryOutbox(handlers, {
  ignoreBackoff = false,
  ignoreLimits = false,
  budgetMs = 8000,
  timeoutMs = 5000,
} = {}) {
  const startedAt = Date.now();
  const summary = { attempted: 0, synced: 0, failed: 0, skipped: 0, remaining: 0 };
  if (!Object.values(handlers).some((h) => h.enabled())) return summary;
  const store = outboxStore();
  const { blobs = [] } = await store.list();
  for (const { key } of blobs) {
    const slash = key.indexOf('/');
    const handler = handlers[key.slice(0, slash)];
    const id = key.slice(slash + 1);
    if (slash <= 0 || !handler || !handler.enabled()) {
      summary.skipped++;
      continue;
    }
    if (Date.now() - startedAt > budgetMs) {
      summary.remaining++;
      continue;
    }
    const entry = await store.get(key, { type: 'json' }).catch(() => null);
    if (!ignoreBackoff && entry && Date.now() < nextAttemptDueAt(entry)) {
      summary.skipped++;
      continue;
    }
    summary.attempted++;
    const res = await runSyncAttempt(handler, id, { ignoreLimits, timeoutMs }).catch(() => ({ status: 'failed' }));
    if (res.status === 'synced' || res.status === 'already_synced') summary.synced++;
    else if (res.status === 'failed' || res.status === 'unknown') summary.failed++;
    else summary.skipped++;
  }
  return summary;
}

export async function outboxSummary() {
  const { blobs = [] } = await outboxStore().list();
  const entries = [];
  for (const { key } of blobs.slice(0, 50)) {
    const entry = await outboxStore().get(key, { type: 'json' }).catch(() => null);
    if (entry) entries.push({ key, attempts: entry.attempts, last_state: entry.last_state, last_attempt_at: entry.last_attempt_at, last_error: entry.last_error });
  }
  return { count: blobs.length, entries };
}
