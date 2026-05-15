// GET /api/public-config
// Returns publicly-safe config the frontend needs.
// No secrets here — this endpoint is intentionally public.

import { json, getSiteSettings } from './_lib/store.mjs';
import { resolveTenant, tenantHasAccount } from './_lib/stripe.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;

  let checkoutEnabled = false;
  try {
    const tenant = await resolveTenant();
    checkoutEnabled = tenantHasAccount(tenant) && !!process.env.STRIPE_PUBLISHABLE_KEY;
  } catch { /* ignore — checkout simply stays disabled */ }

  let settings = {};
  try { settings = await getSiteSettings(); } catch { /* defaults handled in lib */ }

  return json(
    {
      siteUrl: baseUrl,
      currency: 'usd',
      checkoutEnabled,
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      site: {
        business_name: settings.business_name,
        business_tagline: settings.business_tagline,
        business_email: settings.business_email,
        business_phone: settings.business_phone,
        business_phone_e164: settings.business_phone_e164,
        business_city: settings.business_city,
        social_instagram_url: settings.social_instagram_url,
        social_pinterest_url: settings.social_pinterest_url,
        social_facebook_url: settings.social_facebook_url,
        show_gc_tile: settings.show_gc_tile,
      },
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
};

export const config = { path: '/.netlify/functions/public-config' };
