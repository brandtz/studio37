// Shared Cloudflare R2 (S3-compatible) upload helper.

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function env() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_BASE } = process.env;
  return { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_BASE };
}

export function r2Configured() {
  const e = env();
  return !!(e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY && e.R2_SECRET_KEY && e.R2_BUCKET && e.R2_PUBLIC_BASE);
}

export function r2MissingVars() {
  const e = env();
  return Object.entries(e).filter(([, v]) => !v).map(([k]) => k);
}

function client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY } = env();
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
}

/**
 * Uploads a buffer to R2 under `key` and returns its public URL.
 * @param {Buffer} buffer
 * @param {string} key
 * @param {string} contentType
 */
export async function uploadBufferToR2(buffer, key, contentType) {
  const { R2_BUCKET, R2_PUBLIC_BASE } = env();
  await client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  const base = R2_PUBLIC_BASE.replace(/\/+$/, '');
  return `${base}/${key}`;
}
