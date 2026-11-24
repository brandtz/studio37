// The merchant does not need an admin login, but must have the short-lived,
// account-bound refresh capability issued with the original Stripe link.

import { stripe, resolveTenant, tenantHasAccount } from './_lib/stripe.mjs';
import { siteOrigin, verifyRefreshToken } from './_lib/stripe-onboarding.mjs';

export default async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const baseUrl = siteOrigin();
  const token = url.searchParams.get('token') || '';
  const capability = await verifyRefreshToken(token);
  if (!capability) return new Response('Onboarding link expired or invalid. Contact Studio 37 for a new link.', {
    status: 403, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
  const redirect = (location) => new Response(null, {
    status: 302, headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

  let tenant;
  try {
    tenant = await resolveTenant(capability.tenantId);
  } catch (err) {
    console.error('[stripe-connect-refresh] tenant lookup failed', err);
    return redirect(`${baseUrl}/contact?stripe=error`);
  }

  if (!tenantHasAccount(tenant) || tenant.stripe_account_id !== capability.accountId) {
    return redirect(`${baseUrl}/contact?stripe=not_connected`);
  }

  try {
    const link = await stripe().accountLinks.create({
      account: tenant.stripe_account_id,
      refresh_url: `${baseUrl}/.netlify/functions/stripe-connect-refresh?token=${encodeURIComponent(token)}`,
      return_url: `${baseUrl}/stripe/onboarding-complete`,
      type: 'account_onboarding',
    });
    return redirect(link.url);
  } catch (err) {
    console.error('[stripe-connect-refresh] could not mint account link', err);
    return redirect(`${baseUrl}/contact?stripe=error`);
  }
};

export const config = { path: '/.netlify/functions/stripe-connect-refresh' };
