// GET /api/public-config
// Returns publicly-safe config the frontend needs (Snipcart public API key, site URL).
// No secrets here — this endpoint is intentionally public.

import { json } from './_lib/store.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;

  return json(
    {
      snipcartPublicKey: process.env.SNIPCART_PUBLIC_KEY || '',
      siteUrl: baseUrl,
      currency: 'usd',
    },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
};

export const config = { path: '/.netlify/functions/public-config' };
