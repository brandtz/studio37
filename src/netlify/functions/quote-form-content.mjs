import { readQuoteForm } from './_lib/quote-form.mjs';
import { quoteTurnstileConfig } from './_lib/quote-antispam.mjs';

export default async (req) => {
  if (req.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  try {
    const record = await readQuoteForm();
    const { siteKey } = quoteTurnstileConfig();
    return Response.json({ schema: record.schema, revision: record.revision, values: record.values, turnstileSiteKey: siteKey }, {
      headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return Response.json({ error: 'quote_form_unavailable' }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
};
