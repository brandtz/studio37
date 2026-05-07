// GET /api/public-config
// Returns publicly-safe config the frontend needs.
// No secrets here — this endpoint is intentionally public.

import { json } from './_lib/store.mjs';
import { resolveTenant, tenantHasAccount } from './_lib/stripe.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;

  let checkoutEnabled = false;
  try {
    const tenant = await resolveTenant();
    checkoutEnabled = tenantHasAccount(tenant) && !!process.env.STRIPE_PUBLISHABLE_KEY;
  } catch { /* ignore — checkout simply stays disabled */ }

  return json(
    {
      siteUrl: baseUrl,
      currency: 'usd',
      checkoutEnabled,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
};

export const config = { path: '/.netlify/functions/public-config' };
