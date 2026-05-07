// Stripe SDK helper.
// Exposes a singleton Stripe client and small utilities for working with
// Connect accounts and tenant lookup.

import Stripe from 'stripe';
import { getStore } from '@netlify/blobs';
import seedTenants from './tenants.seed.json' with { type: 'json' };
import { json, nowIso } from './store.mjs';

export const TENANT_STORE = 'tenants';
export const ORDER_STORE = 'orders';
const TENANT_SEED_VERSION = 1;
const TENANT_SEED_VERSION_KEY = '_tenant_seed_version';

let _client = null;
export function stripe() {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY env var missing.');
  _client = new Stripe(key, { apiVersion: '2024-11-20.acacia' });
  return _client;
}

export function tenantStore() {
  return getStore({ name: TENANT_STORE, consistency: 'strong' });
}

export function orderStore() {
  return getStore({ name: ORDER_STORE, consistency: 'strong' });
}

export async function ensureTenantSeeded(force = false) {
  const store = tenantStore();
  if (!force) {
    const v = await store.get(TENANT_SEED_VERSION_KEY, { type: 'json' }).catch(() => null);
    if (v?.v === TENANT_SEED_VERSION) return { seeded: false };
  }
  const now = nowIso();
  for (const t of seedTenants) {
    const existing = await store.get(t.id, { type: 'json' }).catch(() => null);
    if (!existing) {
      await store.setJSON(t.id, { ...t, created_at: now, updated_at: now });
    }
  }
  await store.setJSON(TENANT_SEED_VERSION_KEY, { v: TENANT_SEED_VERSION });
  return { seeded: true };
}

/**
 * Resolve the active tenant. Pass a tenant id explicitly, or omit to default
 * to the only tenant we ship with (`studio37`). In a multi-store deployment
 * we'd map by hostname or path here.
 */
export async function resolveTenant(tenantIdOrReq) {
  await ensureTenantSeeded();
  const store = tenantStore();
  let id = 'studio37';
  if (typeof tenantIdOrReq === 'string' && tenantIdOrReq) {
    id = tenantIdOrReq;
  } else if (tenantIdOrReq && typeof tenantIdOrReq === 'object' && tenantIdOrReq.tenantId) {
    id = tenantIdOrReq.tenantId;
  }
  const t = await store.get(id, { type: 'json' });
  if (!t) {
    throw new Error(`Tenant ${id} not found.`);
  }
  return t;
}

export async function listTenants() {
  await ensureTenantSeeded();
  const store = tenantStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    if (b.key.startsWith('_')) continue;
    const t = await store.get(b.key, { type: 'json' });
    if (t) out.push(t);
  }
  out.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
  return out;
}

export async function saveTenant(tenant) {
  const store = tenantStore();
  await store.setJSON(tenant.id, { ...tenant, updated_at: nowIso() });
}

export function tenantHasAccount(t) {
  return !!t?.stripe_account_id;
}

/**
 * Validate the active tenant has a connected Stripe account that can accept
 * charges. Returns either { tenant } or { error } (a 503 Response).
 */
export async function requireConnectedTenant(req) {
  const tenant = await resolveTenant(req);
  if (!tenantHasAccount(tenant)) {
    return { error: json({ error: 'checkout_unavailable', message: 'Store is not yet open for online checkout.' }, 503) };
  }
  return { tenant };
}
