// GET /stripe/onboarding-refresh (public, unauthenticated — merchant-facing)
//
// Drew (the connected-account merchant) is NOT an admin user of this site and
// should never be required to log into /admin just to finish his own Stripe
// KYC/bank onboarding. Stripe onboarding Account Links expire and are
// single-use; when that happens Stripe redirects the merchant to whatever
// `refresh_url` we gave it. That URL must be public.
//
// This endpoint mints a brand-new Account Link for the studio37 tenant's
// connected account and immediately 302-redirects the browser into it, so a
// stale/expired link self-heals with zero staff involvement. It only ever
// operates on the platform's own pre-linked tenant account — it cannot be
// used to create or link arbitrary Stripe accounts — so it's safe to expose
// without authentication.

import { stripe, resolveTenant, tenantHasAccount } from './_lib/stripe.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;

  let tenant;
  try {
    tenant = await resolveTenant('studio37');
  } catch (err) {
    console.error('[stripe-connect-refresh] tenant lookup failed', err);
    return Response.redirect(`${baseUrl}/contact?stripe=error`, 302);
  }

  if (!tenantHasAccount(tenant)) {
    // Nothing to refresh yet — send them somewhere sane rather than a dead end.
    return Response.redirect(`${baseUrl}/contact?stripe=not_connected`, 302);
  }

  try {
    const link = await stripe().accountLinks.create({
      account: tenant.stripe_account_id,
      refresh_url: `${baseUrl}/stripe/onboarding-refresh`,
      return_url: `${baseUrl}/stripe/onboarding-complete`,
      type: 'account_onboarding',
    });
    return Response.redirect(link.url, 302);
  } catch (err) {
    console.error('[stripe-connect-refresh] could not mint account link', err);
    return Response.redirect(`${baseUrl}/contact?stripe=error`, 302);
  }
};

export const config = { path: '/.netlify/functions/stripe-connect-refresh' };
