import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'studio37';
const AUDIENCE = 'stripe-onboarding-refresh';

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 16) throw new Error('JWT_SECRET missing or too short');
  return new TextEncoder().encode(value);
}

export function siteOrigin() {
  const value = process.env.SITE_URL || process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://studio37customdesigns.com';
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid configured site URL');
  }
  return url.origin;
}

export async function createRefreshUrl(tenantId, accountId) {
  const token = await new SignJWT({ tenantId, accountId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret());
  const url = new URL('/.netlify/functions/stripe-connect-refresh', siteOrigin());
  url.searchParams.set('token', token);
  return url.toString();
}

export async function verifyRefreshToken(token) {
  const key = secret();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
    });
    if (typeof payload.tenantId !== 'string' || typeof payload.accountId !== 'string' ||
        !payload.tenantId || !payload.accountId || typeof payload.exp !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}
