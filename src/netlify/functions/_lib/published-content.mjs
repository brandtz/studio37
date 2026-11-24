// Server-only read API. Private scopes (for example email.*) never enter the browser allowlist.
import { getStore } from '@netlify/blobs';

export const PUBLISHED_CONTENT_STORE = 'website_content_published_v1';

export function createPublishedContentReader({
  definitions,
  store = () => getStore({ name: PUBLISHED_CONTENT_STORE, consistency: 'strong' }),
}) {
  return async function readPublishedContent(scope) {
    if (!definitions || !Object.hasOwn(definitions, scope)) {
      throw new Error('Unknown published-content scope.');
    }
    const definition = definitions[scope];
    const fallback = { ...definition.defaults };
    const entry = await store().getWithMetadata(scope, { type: 'json', consistency: 'strong' });
    if (!entry) return { revision: null, etag: null, schema: definition.schema, values: fallback };
    const record = entry.data;
    if (typeof record.id !== 'string' || !record.id || record.schema !== definition.schema) {
      throw new Error('Published-content record is incompatible with its current schema.');
    }
    const values = record.values;
    if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.keys(values).length !== Object.keys(fallback).length ||
        Object.keys(values).some((key) => !Object.hasOwn(fallback, key))) {
      throw new Error('Invalid published-content field map.');
    }
    const clean = {};
    const maxLength = definition.maxFieldLength || 4000;
    for (const key of Object.keys(fallback)) {
      const value = values[key];
      if (typeof value !== 'string' || value.length > maxLength ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
        throw new Error('Invalid published-content text field.');
      }
      clean[key] = value;
    }
    // Consumers can enforce domain-specific constraints (e.g. no CR/LF in an email subject).
    if (definition.validate) definition.validate(clean);
    return { revision: record.id, etag: entry.etag, schema: record.schema, values: clean };
  };
}
