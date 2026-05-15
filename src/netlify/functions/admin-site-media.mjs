// /api/admin/site-media[/:slot]
// Admin manage site-wide media slot overrides. Session-gated.
//
// Each slot stores { slot, url, alt?, updated_at }. The GET response merges
// the static registry (slots.json) with any persisted overrides so the admin UI
// can show every known slot, even those that haven't been customised yet.

import { siteMediaStore, json, nowIso } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import slotRegistry from './_lib/site-media.slots.json' with { type: 'json' };

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const pathSegs = url.pathname.split('/').filter(Boolean);
  const tailSeg = pathSegs[pathSegs.length - 1] || '';
  const slotFromPath = (tailSeg && tailSeg !== 'site-media' && tailSeg !== 'admin-site-media')
    ? decodeURIComponent(tailSeg)
    : null;
  const slot = req.params?.slot || url.searchParams.get('slot') || slotFromPath || null;
  const store = siteMediaStore();

  if (req.method === 'GET') {
    const out = [];
    for (const [key, def] of Object.entries(slotRegistry)) {
      const override = await store.get(key, { type: 'json' }).catch(() => null);
      out.push({
        slot: key,
        label: def.label,
        page: def.page,
        default: def.default,
        url: override?.url || def.default,
        alt: override?.alt || def.alt || '',
        overridden: !!override?.url,
        updated_at: override?.updated_at || null,
      });
    }
    // Append any non-registry slots that exist in the store (custom slots).
    const { blobs } = await store.list();
    const known = new Set(Object.keys(slotRegistry));
    for (const b of blobs) {
      if (b.key.startsWith('_') || known.has(b.key)) continue;
      const o = await store.get(b.key, { type: 'json' });
      if (o) out.push({
        slot: b.key,
        label: o.label || b.key,
        page: o.page || '',
        default: '',
        url: o.url || '',
        alt: o.alt || '',
        overridden: true,
        updated_at: o.updated_at || null,
      });
    }
    return json(out);
  }

  if (req.method === 'PUT') {
    if (!slot) return json({ error: 'slot required' }, 400);
    const body = await req.json().catch(() => null);
    if (!body || typeof body.url !== 'string' || !body.url.trim()) {
      return json({ error: 'url required' }, 400);
    }
    const record = {
      slot,
      url: body.url.trim(),
      alt: typeof body.alt === 'string' ? body.alt.trim().slice(0, 200) : '',
      label: typeof body.label === 'string' ? body.label.trim().slice(0, 120) : (slotRegistry[slot]?.label || slot),
      page: typeof body.page === 'string' ? body.page.trim().slice(0, 80) : (slotRegistry[slot]?.page || ''),
      updated_at: nowIso(),
    };
    await store.setJSON(slot, record);
    return json(record);
  }

  if (req.method === 'DELETE') {
    if (!slot) return json({ error: 'slot required' }, 400);
    await store.delete(slot).catch(() => {});
    return json({ ok: true });
  }

  return json({ error: 'method_not_allowed' }, 405);
};

export const config = {
  path: ['/api/admin/site-media', '/api/admin/site-media/:slot'],
};
