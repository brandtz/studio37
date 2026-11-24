// POST /.netlify/functions/auth-request-password-setup — { email }
// Same response for unknown, ineligible, throttled-address, and delivery failures.
import { userStore, ensureUserSeeded } from './_lib/store.mjs';
import { authJson, needsPasswordSetup, signSetupToken, checkSetupRateLimit } from './_lib/auth.mjs';
import { clientIp } from './_lib/rate-limit.mjs';
import { sendPasswordSetupEmail } from './_lib/setup-email.mjs';

const accepted = () => authJson({
  message: 'If this address belongs to an approved account without a password, a setup link will be emailed. Check your inbox and spam folder. Links expire in 15 minutes.',
}, 202);

export default async (req) => {
  if (req.method !== 'POST') return authJson({ error: 'method_not_allowed' }, 405);
  const started = Date.now();
  try {
    const ipLimit = await checkSetupRateLimit({ key: `request:ip:${clientIp(req)}`, limit: 5, windowMs: 60_000 });
    if (!ipLimit.allowed) {
      return authJson({ error: 'too_many_attempts', message: 'Too many requests. Please try again later.' }, 429,
        { 'retry-after': String(ipLimit.retryAfterSec) });
    }
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) return accepted();
    const emailLimit = await checkSetupRateLimit({ key: `request:email:${email}`, limit: 3, windowMs: 15 * 60_000 });
    if (!emailLimit.allowed) return accepted();
    await ensureUserSeeded();
    const user = await userStore().get(email, { type: 'json' });
    if (needsPasswordSetup(user) && user.email === email) {
      if (!process.env.RESEND_API_KEY) {
        console.error('[auth] password setup email unavailable: Resend is not configured');
      } else {
        const token = await signSetupToken(user);
        if (!await sendPasswordSetupEmail(user.email, token)) {
          console.error('[auth] password setup email delivery failed');
        }
      }
    }
    return accepted();
  } catch {
    console.error('[auth] password setup request failed');
    return accepted();
  } finally {
    // Reduce simple timing probes; network latency is not guaranteed constant-time.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 600 - (Date.now() - started))));
  }
};

export const config = { path: '/.netlify/functions/auth-request-password-setup' };
