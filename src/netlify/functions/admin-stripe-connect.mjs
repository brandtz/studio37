// /api/admin/stripe-connect/onboard
// POST: create (or reuse) a Connect Standard account for a tenant and return an
//       Account Link the tenant can open to finish KYC + bank setup.
//
// /api/admin/stripe-connect/login-link
// POST: return a Stripe Express dashboard login link for the connected account.
//       (Standard accounts redirect to dashboard.stripe.com auto-logged-in.)
//
// /api/admin/stripe-connect/status
// GET: return charges_enabled, payouts_enabled, requirements_due for a tenant.
//
// All endpoints are session-gated (super only) and routed via netlify.toml.

import { json } from './_lib/store.mjs';
import { requireSession } from './_lib/auth.mjs';
import {
  stripe,
  resolveTenant,
  saveTenant,
  listTenants,
} from './_lib/stripe.mjs';

export default async (req) => {
  const auth = await requireSession(req, { minRole: 'super' });
  if (auth.error) return auth.error;

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || ''; // 'onboard' | 'login-link' | 'status' | 'list'
  // tenant id can come from query string or JSON body (POST)
  let tenantId = url.searchParams.get('tenant') || '';
  // Also grab an optional `accountId` from the POST body — used by the "link
  // existing Stripe account" flow when an account was created directly in the
  // Stripe dashboard rather than through our onboarding button.
  let bodyAccountId = '';
  if ((req.method === 'POST' || req.method === 'PUT')) {
    try {
      const cloned = req.clone ? req.clone() : null;
      const body = cloned ? await cloned.json().catch(() => null) : null;
      if (body && typeof body.tenantId === 'string' && !tenantId) tenantId = body.tenantId;
      if (body && typeof body.accountId === 'string') bodyAccountId = body.accountId.trim();
    } catch { /* ignore */ }
  }
  if (!tenantId) tenantId = 'studio37';

  if (action === 'list' && req.method === 'GET') {
    const tenants = await listTenants();
    // Annotate with live Stripe status when account exists.
    const out = [];
    for (const t of tenants) {
      let stripeStatus = null;
      if (t.stripe_account_id) {
        try {
          const acct = await stripe().accounts.retrieve(t.stripe_account_id);
          stripeStatus = {
            charges_enabled: acct.charges_enabled,
            payouts_enabled: acct.payouts_enabled,
            details_submitted: acct.details_submitted,
            requirements_currently_due: acct.requirements?.currently_due || [],
            email: acct.email || null,
          };
        } catch (err) {
          stripeStatus = { error: err?.message || 'lookup_failed' };
        }
      }
      out.push({ ...t, stripe_status: stripeStatus });
    }
    return json(out);
  }

  if (action === 'onboard' && req.method === 'POST') {
    const tenant = await resolveTenantOrFail(tenantId);
    if (tenant.error) return tenant.error;
    let acctId = tenant.value.stripe_account_id;

    try {
      if (!acctId && bodyAccountId) {
        // Link an account that was created directly in the Stripe dashboard
        // (rather than via our onboarding flow). Verify it exists and belongs
        // to this platform before saving it against the tenant.
        try {
          const existing = await stripe().accounts.retrieve(bodyAccountId);
          acctId = existing.id;
        } catch (err) {
          console.error('[stripe-connect] provided accountId not found', err);
          return json({ error: 'account_not_found', message: 'Could not find that Stripe account ID on this platform.' }, 400);
        }
        await saveTenant({ ...tenant.value, stripe_account_id: acctId });
      } else if (!acctId) {
        const acct = await stripe().accounts.create({
          type: 'standard',
          country: tenant.value.country || 'US',
          email: undefined, // tenant supplies email during onboarding
          metadata: { tenant_id: tenant.value.id, platform: 'studio37-platform' },
        });
        acctId = acct.id;
        await saveTenant({ ...tenant.value, stripe_account_id: acctId });
      }

      const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
      // Refresh/return URLs must be public — Drew (the merchant completing this
      // form) is not an admin user of this site and must never be bounced to
      // our staff login. See stripe-connect-refresh.mjs.
      const link = await stripe().accountLinks.create({
        account: acctId,
        refresh_url: `${baseUrl}/stripe/onboarding-refresh`,
        return_url: `${baseUrl}/stripe/onboarding-complete`,
        type: 'account_onboarding',
      });
      return json({ url: link.url, account: acctId });
    } catch (err) {
      console.error('[stripe-connect] onboard failed', err);
      return json({ error: 'stripe_error' }, 502);
    }
  }

  if (action === 'login-link' && req.method === 'POST') {
    const tenant = await resolveTenantOrFail(tenantId);
    if (tenant.error) return tenant.error;
    if (!tenant.value.stripe_account_id) return json({ error: 'no_account' }, 400);
    try {
      // For Standard accounts, login_links are not available — Standard users log in
      // at dashboard.stripe.com directly. We instead generate a fresh account link.
      const baseUrl = process.env.SITE_URL || `${url.protocol}//${url.host}`;
      const link = await stripe().accountLinks.create({
        account: tenant.value.stripe_account_id,
        refresh_url: `${baseUrl}/stripe/onboarding-refresh`,
        return_url: `${baseUrl}/stripe/onboarding-complete`,
        type: 'account_onboarding',
      });
      return json({ url: link.url, note: 'For Standard accounts, daily logins happen at dashboard.stripe.com' });
    } catch (err) {
      console.error('[stripe-connect] login-link failed', err);
      return json({ error: 'stripe_error' }, 502);
    }
  }

  if (action === 'status' && req.method === 'GET') {
    const tenant = await resolveTenantOrFail(tenantId);
    if (tenant.error) return tenant.error;
    if (!tenant.value.stripe_account_id) return json({ error: 'no_account' }, 400);
    try {
      const acct = await stripe().accounts.retrieve(tenant.value.stripe_account_id);
      return json({
        id: acct.id,
        charges_enabled: acct.charges_enabled,
        payouts_enabled: acct.payouts_enabled,
        details_submitted: acct.details_submitted,
        requirements_currently_due: acct.requirements?.currently_due || [],
        email: acct.email,
      });
    } catch (err) {
      console.error('[stripe-connect] status failed', err);
      return json({ error: 'stripe_error' }, 502);
    }
  }

  return json({ error: 'unknown_action' }, 400);
};

async function resolveTenantOrFail(tenantId) {
  try {
    const t = await resolveTenant({ tenantId });
    if (!t || t.id !== tenantId) {
      return { error: json({ error: 'tenant_not_found' }, 404) };
    }
    return { value: t };
  } catch (err) {
    console.error('[stripe-connect] tenant lookup failed', err);
    return { error: json({ error: 'tenant_lookup_failed' }, 500) };
  }
}

export const config = { path: '/.netlify/functions/admin-stripe-connect' };
