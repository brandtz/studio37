const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_HOSTNAMES = 'studio37customdesigns.com,studio37customdesign.netlify.app';

export function quoteTurnstileConfig() {
  const siteKey = (process.env.QUOTE_TURNSTILE_SITE_KEY || '').trim();
  const secretKey = (process.env.QUOTE_TURNSTILE_SECRET_KEY || '').trim();
  if (Boolean(siteKey) !== Boolean(secretKey)) {
    console.error('[quote-antispam] Turnstile requires both site and secret keys');
    throw new Error('incomplete_turnstile_config');
  }
  const hostnames = (process.env.QUOTE_TURNSTILE_HOSTNAMES || DEFAULT_HOSTNAMES)
    .split(',').map((hostname) => hostname.trim().toLowerCase()).filter(Boolean);
  if (siteKey && (!hostnames.length || hostnames.some((hostname) =>
    !/^[a-z0-9.-]+$/.test(hostname) ||
    (process.env.CONTEXT === 'production' && (hostname === 'localhost' || hostname.startsWith('127.')))))) {
    console.error('[quote-antispam] invalid Turnstile hostname configuration');
    throw new Error('invalid_turnstile_hostnames');
  }
  return { siteKey, secretKey, hostnames };
}

export async function verifyQuoteTurnstile(token, secretKey, hostnames) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('siteverify_http_error');
    const result = await response.json();
    if (!result || typeof result.success !== 'boolean') throw new Error('siteverify_invalid_response');
    if (result.success && result.action === 'quote_request' &&
        typeof result.hostname === 'string' && hostnames.includes(result.hostname.toLowerCase())) return true;
    if (Array.isArray(result['error-codes']) &&
        result['error-codes'].some((code) => ['missing-input-secret', 'invalid-input-secret', 'internal-error', 'bad-request'].includes(code))) {
      throw new Error('siteverify_configuration_or_service_error');
    }
    return false;
  } catch {
    console.error('[quote-antispam] Turnstile verification unavailable');
    throw new Error('turnstile_unavailable');
  }
}
