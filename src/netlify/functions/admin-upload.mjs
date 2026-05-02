// POST /api/admin/upload
// Upload a single image file to Cloudflare R2 (S3-compatible).
// Returns { url } pointing at the public R2 / CDN URL.

import { json, requireAdmin } from './_lib/store.mjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export default async (req) => {
  const auth = requireAdmin(req);
  if (auth) return auth;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY,
    R2_SECRET_KEY,
    R2_BUCKET,
    R2_PUBLIC_BASE,
  } = process.env;

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET || !R2_PUBLIC_BASE) {
    return json({ error: 'r2_not_configured', missing: ['R2_ACCOUNT_ID','R2_ACCESS_KEY','R2_SECRET_KEY','R2_BUCKET','R2_PUBLIC_BASE'].filter((k) => !process.env[k]) }, 500);
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'file required' }, 400);

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });

  const buf = Buffer.from(await file.arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buf,
      ContentType: file.type || 'application/octet-stream',
    }),
  );

  const base = R2_PUBLIC_BASE.replace(/\/+$/, '');
  return json({ url: `${base}/${key}` });
};

export const config = { path: '/.netlify/functions/admin-upload' };
