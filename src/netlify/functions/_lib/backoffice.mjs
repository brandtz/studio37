// Back Office (gilgameh) integration client — server-side only.
//
// Holds config, HMAC signing for inbound website events, Bearer-authenticated
// REST helpers for /api/v1, and verification of signed outbound webhooks.
// Secrets come exclusively from Netlify env vars and must never be sent to
// the browser.

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://gilgameh.netlify.app';
const DEFAULT_TENANT_SLUG = 'studio-37';
export const DEFAULT_TIMEOUT_MS = 6000;
export const SIGNATURE_TOLERANCE_SEC = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function backOfficeConfig(env = process.env) {
  return {
    baseUrl: String(env.BACKOFFICE_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    tenantSlug: String(env.BACKOFFICE_TENANT_SLUG || DEFAULT_TENANT_SLUG).trim(),
    apiKey: String(env.BACKOFFICE_API_KEY || '').trim(),
    websiteSecret: String(env.BACKOFFICE_WEBSITE_WEBHOOK_SECRET || '').trim(),
    outboundSecret: String(env.BACKOFFICE_OUTBOUND_WEBHOOK_SECRET || '').trim(),
  };
}

export const websiteWebhookConfigured = () => !!backOfficeConfig().websiteSecret;
export const backOfficeApiConfigured = () => !!backOfficeConfig().apiKey;
export const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

export class BackOfficeError extends Error {
  constructor(message, { status = 0, code = '', ambiguous = false } = {}) {
    super(message);
    this.name = 'BackOfficeError';
    this.status = status;
    this.code = code;
    // true when Back Office may have processed the request anyway
    // (timeout, dropped connection, 5xx) — callers must not blindly resend.
    this.ambiguous = ambiguous;
  }
}

export function signWebsitePayload(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function send(url, init, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new BackOfficeError(timedOut ? 'Back Office request timed out' : 'Back Office unreachable', {
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      ambiguous: true,
    });
  }
  let body = null;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) {
      throw new BackOfficeError('Back Office returned an unreadable response', {
        code: 'BAD_RESPONSE',
        ambiguous: true,
      });
    }
  }
  if (!res.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : '';
    const detail = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 200) : `HTTP ${res.status}`;
    throw new BackOfficeError(`Back Office ${res.status}${code ? ` ${code}` : ''}: ${detail}`, {
      status: res.status,
      code,
      ambiguous: res.status >= 500 || res.status === 408,
    });
  }
  return { body, headers: res.headers };
}

/**
 * POST a signed lead/order event to /api/webhooks/website and return the
 * response `data` ({ customerId, interactionId } or { customerId, orderId, orderNumber }).
 */
export async function postWebsiteEvent(payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cfg = backOfficeConfig();
  if (!cfg.websiteSecret) throw new BackOfficeError('Back Office website webhook secret is not configured', { code: 'NOT_CONFIGURED' });
  const rawBody = JSON.stringify(payload);
  const { body } = await send(`${cfg.baseUrl}/api/webhooks/website`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-slug': cfg.tenantSlug,
      'x-webhook-signature': `v1=${signWebsitePayload(rawBody, cfg.websiteSecret)}`,
      'idempotency-key': payload.eventId,
    },
    body: rawBody,
  }, timeoutMs);
  const data = body?.data;
  const required = payload.type === 'order' ? ['customerId', 'orderId', 'orderNumber'] : ['customerId', 'interactionId'];
  if (!data || required.some((field) => typeof data[field] !== 'string' || !data[field].trim())) {
    throw new BackOfficeError('Back Office did not return the created record identifiers', {
      code: 'BAD_RESPONSE',
      ambiguous: true,
    });
  }
  return data;
}

/**
 * Call the Back Office REST API (`/api/v1${path}`) with the tenant-bound API key.
 * Returns the parsed envelope ({ data, meta }) plus `replayed` for idempotent replays.
 */
export async function backOfficeApi(method, path, { body, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cfg = backOfficeConfig();
  if (!cfg.apiKey) throw new BackOfficeError('Back Office API key is not configured', { code: 'NOT_CONFIGURED' });
  const headers = { accept: 'application/json', authorization: `Bearer ${cfg.apiKey}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const res = await send(`${cfg.baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }, timeoutMs);
  return { ...(res.body || {}), replayed: res.headers.get('x-idempotent-replayed') === 'true' };
}

/**
 * Verify an `X-BackOffice-Signature: t=<unix>,v1=<hex>` header, where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Rejects timestamps outside
 * the replay window.
 */
export function verifyBackOfficeSignature(rawBody, header, secret, {
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = SIGNATURE_TOLERANCE_SEC,
} = {}) {
  if (!secret || typeof header !== 'string' || typeof rawBody !== 'string') return { ok: false };
  let t = '';
  const candidates = [];
  for (const piece of header.split(',')) {
    const i = piece.indexOf('=');
    if (i <= 0) continue;
    const key = piece.slice(0, i).trim();
    const value = piece.slice(i + 1).trim();
    if (key === 't') t = value;
    else if (key === 'v1' && value) candidates.push(value);
  }
  if (!/^\d{1,13}$/.test(t) || !candidates.length) return { ok: false };
  let ts = Number(t);
  if (ts > 1e11) ts = Math.floor(ts / 1000); // tolerate millisecond timestamps
  if (Math.abs(nowSec - ts) > toleranceSec) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'utf8');
  const ok = candidates.some((candidate) => {
    const got = Buffer.from(candidate, 'utf8');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return ok ? { ok: true, timestamp: ts } : { ok: false };
}

export function errorSummary(err) {
  if (err instanceof BackOfficeError) return err.message.slice(0, 240);
  return 'unexpected_error';
}
