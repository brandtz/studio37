// GET  /api/admin/site-settings  -> current settings (merged with defaults)
// PUT  /api/admin/site-settings  -> partial update
// Session-gated.

import { json, getSiteSettings, saveSiteSettings, SITE_SETTINGS_DEFAULTS, logAudit } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

const ALLOWED_KEYS = new Set(Object.keys(SITE_SETTINGS_DEFAULTS));

function sanitize(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!ALLOWED_KEYS.has(k)) continue;
    const def = SITE_SETTINGS_DEFAULTS[k];
    if (typeof def === 'boolean') {
      out[k] = !!v;
    } else if (typeof def === 'string') {
      out[k] = typeof v === 'string' ? v.trim().slice(0, 500) : '';
    }
  }
  return out;
}

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  if (req.method === 'GET') {
    const settings = await getSiteSettings();
    return json(settings);
  }

  if (req.method === 'PUT') {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400);
    const patch = sanitize(body);
    const before = await getSiteSettings();
    const next = await saveSiteSettings(patch);
    await logAudit({
      actor: auth.user?.email || 'admin',
      action: 'site_settings.update',
      entity: 'site_settings',
      entity_id: 'current',
      before,
      after: next,
      req,
    });
    return json(next);
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = { path: '/.netlify/functions/admin-site-settings' };
