// POST /api/mcp — Storefront MCP server (Streamable HTTP, JSON responses).
//
// Lets AI agents list storefront products/leads, push the catalog to Back
// Office and publish verified Back Office products here. Disabled (404)
// unless STOREFRONT_MCP_TOKEN (≥ 32 chars) is set; every request must send
// `Authorization: Bearer <STOREFRONT_MCP_TOKEN>`.
//
// A small, dependency-free JSON-RPC 2.0 handler: stateless, no SSE stream.

import { createHash, timingSafeEqual } from 'node:crypto';
import { json } from './_lib/store.mjs';
import { backOfficeApiConfigured, errorSummary } from './_lib/backoffice.mjs';
import {
  importCatalogItemToStorefront, productsWithLinks, recentLeads, syncStorefrontCatalog,
} from './_lib/backoffice-storefront.mjs';

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'studio37-storefront', version: '1.0.0' };
const MIN_TOKEN_LENGTH = 32;
const MAX_BODY_BYTES = 64 * 1024;

const TOOLS = [
  {
    name: 'list_storefront_products',
    description: 'List storefront products with SKU, price (cents), status, published flag and linked Back Office catalog item id.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'sync_catalog_to_backoffice',
    description: 'Upsert storefront products into the Back Office catalog, matched by SKU (all products, or one by productId). Safe to repeat.',
    inputSchema: {
      type: 'object',
      properties: { productId: { type: 'string', description: 'Optional storefront product id to sync alone.' } },
      additionalProperties: false,
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'publish_product_from_backoffice',
    description: 'Create or update a storefront listing from a verified, active Back Office catalog product.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogItemId: { type: 'string', format: 'uuid', description: 'Back Office catalog item id.' },
        status: { type: 'string', enum: ['available', 'out_of_stock', 'by_request'], description: 'Optional storefront status; new listings default to available (by_request if flagged).' },
      },
      required: ['catalogItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_recent_storefront_leads',
    description: 'Newest storefront quote leads with their Back Office sync status (name and service only — no contact details).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

const digest = (value) => createHash('sha256').update(String(value)).digest();

function configuredToken() {
  const token = String(process.env.STOREFRONT_MCP_TOKEN || '').trim();
  return token.length >= MIN_TOKEN_LENGTH ? token : '';
}

function authorized(req, token) {
  const header = req.headers.get('authorization') || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return !!presented && timingSafeEqual(digest(presented), digest(token));
}

function allowedOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const allowed = [process.env.SITE_URL, process.env.URL, process.env.DEPLOY_PRIME_URL, 'https://studio37customdesigns.com']
    .filter(Boolean).map((u) => String(u).replace(/\/+$/, ''));
  return allowed.includes(origin.replace(/\/+$/, ''));
}

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: Array.isArray(payload) ? { items: payload } : payload,
    isError,
  };
}

async function callTool(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return toolResult({ error: 'invalid_arguments' }, true);
  switch (name) {
    case 'list_storefront_products':
      return toolResult({ products: await productsWithLinks() });
    case 'sync_catalog_to_backoffice': {
      if (!backOfficeApiConfigured()) return toolResult({ error: 'backoffice_api_not_configured' }, true);
      if (args.productId !== undefined && typeof args.productId !== 'string') return toolResult({ error: 'invalid_productId' }, true);
      const res = await syncStorefrontCatalog({ productId: args.productId || null });
      return toolResult(res, !res.ok);
    }
    case 'publish_product_from_backoffice': {
      if (typeof args.catalogItemId !== 'string') return toolResult({ error: 'catalogItemId_required' }, true);
      const status = typeof args.status === 'string' ? args.status : null;
      const res = await importCatalogItemToStorefront(args.catalogItemId.trim(), { status, actor: 'MCP' });
      return toolResult(res, !res.ok);
    }
    case 'list_recent_storefront_leads': {
      const limit = Number.isInteger(args.limit) ? Math.min(100, Math.max(1, args.limit)) : 20;
      return toolResult({ leads: await recentLeads(limit) });
    }
    default:
      return null;
  }
}

async function handleMessage(msg) {
  // Client responses to server requests: this server never sends any, so just acknowledge.
  if (msg && typeof msg === 'object' && msg.method === undefined && ('result' in msg || 'error' in msg)) return null;
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Studio 37 storefront tools. Catalog sync matches products by SKU and never duplicates; publishing requires a verified Back Office product.',
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      try {
        const result = await callTool(name, msg.params?.arguments || {});
        if (!result) return rpcError(msg.id, -32602, `Unknown tool: ${String(name).slice(0, 80)}`);
        return rpcResult(msg.id, result);
      } catch (err) {
        console.error('[storefront-mcp] tool failed', name, errorSummary(err));
        return rpcResult(msg.id, toolResult({ error: 'tool_failed', message: errorSummary(err) }, true));
      }
    }
    default:
      return rpcError(msg.id, -32601, 'Method not found');
  }
}

export default async (req) => {
  const token = configuredToken();
  if (!token) return json({ error: 'not_found' }, 404);
  if (!allowedOrigin(req)) return json({ error: 'forbidden_origin' }, 403);
  if (!authorized(req, token)) {
    return json({ error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer realm="studio37-mcp"' });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return json(rpcError(null, -32600, 'Request too large'), 413);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  const batch = Array.isArray(payload);
  const messages = batch ? payload.slice(0, 20) : [payload];
  const responses = [];
  for (const msg of messages) {
    const res = await handleMessage(msg);
    if (res) responses.push(res);
  }
  if (!responses.length) return new Response(null, { status: 202 });
  return json(batch ? responses : responses[0]);
};

export const config = { path: '/api/mcp' };
