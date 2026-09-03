// POST /api/admin/upload
// Upload a single image file to Cloudflare R2 (S3-compatible).
// Returns { url } pointing at the public R2 / CDN URL.

import { json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import { r2Configured, r2MissingVars, uploadBufferToR2 } from './_lib/r2.mjs';

export default async (req) => {
  const auth = await requireSession(req);
  if (auth.error) return auth.error;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!r2Configured()) {
    console.warn('[admin-upload] storage not configured; missing env:', r2MissingVars());
    return json({ error: 'storage_unavailable' }, 500);
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'file required' }, 400);

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const url = await uploadBufferToR2(buf, key, file.type || 'application/octet-stream');
  return json({ url });
};

export const config = { path: '/.netlify/functions/admin-upload' };
