// GET /api/admin/audit-log — super only. Returns most-recent entries (default 200).

import { json, listAuditLog } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';

export default async (req) => {
  const auth = await requireSession(req, { minRole: 'super' });
  if (auth.error) return auth.error;

  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') || '200', 10) || 200));

  const entries = await listAuditLog({ limit });
  return json({ entries, count: entries.length });
};

export const config = { path: '/.netlify/functions/admin-audit-log' };
