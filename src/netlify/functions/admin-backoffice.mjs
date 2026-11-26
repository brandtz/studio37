// /api/admin/backoffice[/:action]   (super admins only)
//   GET  status        → config flags (never secrets), outbox, linked product count
//   POST sync-catalog  → { productId? }  upsert storefront products into Back Office
//   POST retry-sync    → re-deliver queued leads/orders now (ignores backoff/limits)
//   POST import-item   → { catalogItemId, status? }  publish a Back Office product here

import { json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import { backOfficeApiConfigured, errorSummary, websiteWebhookConfigured } from './_lib/backoffice.mjs';
import {
  backOfficeStatus, importCatalogItemToStorefront, retryBackOfficeSyncs, syncStorefrontCatalog,
} from './_lib/backoffice-storefront.mjs';

export default async (req) => {
  const auth = await requireSession(req, { minRole: 'super' });
  if (auth.error) return auth.error;
  const actor = auth.user?.email || 'unknown';

  const url = new URL(req.url);
  const action = req.params?.action || url.searchParams.get('action') || 'status';
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

  try {
    if (action === 'status' && req.method === 'GET') {
      return json(await backOfficeStatus());
    }

    if (action === 'sync-catalog' && req.method === 'POST') {
      if (!backOfficeApiConfigured()) return json({ error: 'backoffice_api_not_configured' }, 503);
      const productId = typeof body?.productId === 'string' && body.productId ? body.productId : null;
      const res = await syncStorefrontCatalog({ productId });
      return res.ok ? json(res) : json({ error: res.error }, res.status);
    }

    if (action === 'retry-sync' && req.method === 'POST') {
      if (!websiteWebhookConfigured()) return json({ error: 'backoffice_webhook_not_configured' }, 503);
      return json(await retryBackOfficeSyncs({ ignoreBackoff: true, ignoreLimits: true, budgetMs: 15000 }));
    }

    if (action === 'import-item' && req.method === 'POST') {
      const status = typeof body?.status === 'string' && body.status ? body.status : null;
      const res = await importCatalogItemToStorefront(String(body?.catalogItemId || '').trim(), { status, actor, req });
      return res.ok ? json(res) : json({ error: res.error }, res.status);
    }
  } catch (err) {
    console.error('[admin-backoffice]', action, errorSummary(err));
    return json({ error: 'backoffice_request_failed', message: errorSummary(err) }, 502);
  }

  return json({ error: 'not_found' }, 404);
};

export const config = { path: ['/api/admin/backoffice', '/api/admin/backoffice/:action'] };
