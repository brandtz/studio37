import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import schema from '../../../assets/js/content-schema.js';
import quoteForm from '../../../assets/js/quote-form-schema.js';
import seoSchema from '../../../assets/js/seo-schema.js';
import { createPublishedContentReader, PUBLISHED_CONTENT_STORE } from './published-content.mjs';

export const DRAFT_STORE = 'website_content_drafts_v1';
export const PUBLISHED_STORE = PUBLISHED_CONTENT_STORE;
export const PUBLICATION_STORE = 'website_content_publications_v1';
export const websiteRegistry = { ...schema, ...seoSchema, [quoteForm.scope]: { ...quoteForm.definition, validate: quoteForm.validate, inheritFrom: 'contact' } };

export class ContentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function pageDefinition(page, registry = websiteRegistry) {
  if (!/^[a-z][a-z0-9.-]{0,79}$/.test(page || '') || !Object.hasOwn(registry, page)) throw new ContentError('Unknown content page.', 404);
  return registry[page];
}

export function defaults(page, registry = websiteRegistry) {
  const definition = pageDefinition(page, registry);
  return definition.fields ? Object.fromEntries(definition.fields.map((field) => [field.id, field.default])) : { ...definition.defaults };
}

export function validateBase(base) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) throw new ContentError('A published base revision and ETag are required.');
  if (base.revision === null && base.etag === null) return { revision: null, etag: null };
  if (typeof base.revision !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(base.revision) ||
      typeof base.etag !== 'string' || !base.etag || base.etag.length > 2048 ||
      /^W\//i.test(base.etag) || /[\r\n]/.test(base.etag)) {
    throw new ContentError('Invalid published base revision or strong ETag.');
  }
  return { revision: base.revision, etag: base.etag };
}

function requireWriteResult(result) {
  if (!result || typeof result.modified !== 'boolean') {
    throw new ContentError('Conditional-write result unavailable. Publishing requires the pinned Blobs SDK and a compatible backend.', 503);
  }
  return result.modified;
}

function storedBase(revision, etag) {
  try {
    return validateBase({ revision, etag });
  } catch {
    throw new ContentError('Published storage did not supply a usable revision and strong ETag.', 503);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function validateValues(page, values, schemaVersion, registry = websiteRegistry) {
  const definition = pageDefinition(page, registry);
  if (schemaVersion !== definition.schema) {
    throw new ContentError('This page template changed. Reload the editor before saving or restoring.', 409);
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ContentError('Content must be a text-field map.');
  }
  const fields = definition.fields || Object.entries(definition.defaults).map(([id, value]) => ({
    id, default: value, maxLength: definition.maxFieldLength || 4000,
  }));
  const keys = fields.map((field) => field.id);
  if (Object.keys(values).length !== keys.length || Object.keys(values).some((key) => !keys.includes(key))) {
    throw new ContentError('Only the listed page text fields may be edited.');
  }
  let size = 0;
  for (const field of fields) {
    const key = field.id;
    const value = values[key];
    if (typeof value !== 'string' || value.length > (field.maxLength || 4000) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new ContentError('Each field must be plain text, within its length limit (normally 4,000 characters), without control characters.');
    }
    if (field.requiredText && !value.trim()) {
      throw new ContentError('Required text fields cannot be empty.');
    }
    size += Buffer.byteLength(value);
  }
  if (size > 100000) throw new ContentError('Page text exceeds 100 KB.');
  const clean = Object.fromEntries(keys.map((key) => [key, values[key]]));
  try { definition.validate?.(clean); }
  catch (error) { throw new ContentError(error.message || 'Invalid content values.'); }
  return clean;
}

export function createContentRepository({
  registry = websiteRegistry,
  drafts = () => getStore({ name: DRAFT_STORE, consistency: 'strong' }),
  published = () => getStore({ name: PUBLISHED_STORE, consistency: 'strong' }),
  publications = () => getStore({ name: PUBLICATION_STORE, consistency: 'strong' }),
  uuid = randomUUID,
  now = () => new Date().toISOString(),
} = {}) {
  const definitionFor = (page) => pageDefinition(page, registry);
  const validate = (page, values, version) => validateValues(page, values, version, registry);
  const readPublished = createPublishedContentReader({
    store: published,
    definitions: Object.fromEntries(Object.entries(registry).map(([page, definition]) => [page, {
      schema: definition.schema, defaults: defaults(page, registry),
      maxFieldLength: Math.max(definition.maxFieldLength || 4000, ...(definition.fields || []).map((field) => field.maxLength || 4000)),
      validate: (values) => validate(page, values, definition.schema),
    }])),
  });
  async function getPublished(page) {
    definitionFor(page);
    const current = await readPublished(page);
    current.values = validate(page, current.values, current.schema);
    storedBase(current.revision, current.etag);
    const definition = definitionFor(page);
    if (current.revision === null && definition.inheritFrom) {
      const parent = await getPublished(definition.inheritFrom);
      if (parent.revision) {
        const values = { ...current.values };
        for (const field of definition.fields) {
          const value = parent.values[field.id];
          if (typeof value === 'string' && (!field.requiredText || value.trim())) values[field.id] = value;
        }
        return { ...current, values: validate(page, values, current.schema), inheritedRevision: parent.revision };
      }
    }
    return current;
  }

  async function getDraft(page, id) {
    definitionFor(page);
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new ContentError('Invalid draft revision.');
    const record = await drafts().get(`${page}/${id}`, { type: 'json' });
    if (!record || record.page !== page || record.id !== id) throw new ContentError('Draft not found.', 404);
    return record;
  }

  async function history(page) {
    definitionFor(page);
    const store = drafts();
    const rows = [];
    for await (const batch of store.list({ prefix: `${page}/`, paginate: true })) {
      if (rows.length + batch.blobs.length > 5000) {
        throw new ContentError('History is too large for this editor; archive/export tooling is required.', 503);
      }
      const records = await Promise.all(batch.blobs.map(({ key }) => store.get(key, { type: 'json' })));
      for (const record of records) {
        if (!record || record.page !== page) throw new ContentError('Could not read complete content history.', 503);
        rows.push({
          id: record.id, at: record.at, actor: record.actor, schema: record.schema,
          restoredFrom: record.restoredFrom || null,
        });
      }
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }

  async function save(page, values, schemaVersion, actor, restoredFrom = null, base = { revision: null, etag: null }) {
    const clean = validate(page, values, schemaVersion);
    const record = {
      id: uuid(), page, schema: schemaVersion, values: clean, at: now(), actor, restoredFrom, base: validateBase(base),
    };
    const created = await drafts().setJSON(`${page}/${record.id}`, record, { onlyIfNew: true });
    if (!requireWriteResult(created)) throw new ContentError('Draft revision collision; retry saving.', 409);
    return record;
  }

  const publicationKey = (page, id) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ContentError('Invalid publication revision.');
    return `${page}/${id}`;
  };
  async function archive(page, record) {
    const store = publications();
    const key = publicationKey(page, record.id);
    const result = await store.setJSON(key, record, { onlyIfNew: true });
    if (!requireWriteResult(result)) {
      const existing = await store.get(key, { type: 'json', consistency: 'strong' });
      if (canonical(existing) !== canonical(record)) throw new ContentError('Publication history identity mismatch.', 503);
    }
  }
  async function publicationChain(page) {
    definitionFor(page);
    let current = await published().get(page, { type: 'json', consistency: 'strong' });
    const rows = [];
    const seen = new Set();
    while (current) {
      publicationKey(page, current.id);
      if (seen.has(current.id) || rows.length >= 5000 || (current.page && current.page !== page)) {
        throw new ContentError('Publication history is invalid or exceeds the editor limit.', 503);
      }
      rows.push(current);
      seen.add(current.id);
      if (!current.parentRevision) break;
      const parentId = current.parentRevision;
      const parent = await publications().get(publicationKey(page, parentId), { type: 'json', consistency: 'strong' });
      if (!parent || parent.id !== parentId) throw new ContentError('Publication history is incomplete.', 503);
      current = parent;
    }
    return rows;
  }

  return {
    getPublished, getDraft, history, save, definition: definitionFor,
    async restore(page, id, actor) {
      const record = await getDraft(page, id);
      const current = await getPublished(page);
      return save(page, record.values, record.schema, actor, id, current);
    },
    async publicationHistory(page) {
      return (await publicationChain(page)).map((record) => ({
        id: record.id, at: record.at || null, actor: record.actor || null,
        schema: record.schema, sourceDraft: record.sourceDraft || null, parentRevision: record.parentRevision || null,
      }));
    },
    async restorePublication(page, id, actor) {
      publicationKey(page, id);
      const record = (await publicationChain(page)).find((entry) => entry.id === id);
      if (!record) throw new ContentError('Committed publication not found.', 404);
      const current = await getPublished(page);
      return save(page, record.values, record.schema, actor, `publication:${id}`, current);
    },
    async publish(page, draftId, requestedBase, actor) {
      const base = validateBase(requestedBase);
      const draft = await getDraft(page, draftId);
      if (!draft.base) throw new ContentError('This legacy draft has no publication base. Review and save a new draft first.', 409);
      if (canonical(validateBase(draft.base)) !== canonical(base)) {
        throw new ContentError('The publish request must use this saved draft’s original base. Review current text before rebasing.', 409);
      }
      const values = validate(page, draft.values, draft.schema);
      const store = published();
      const entry = await store.getWithMetadata(page, { type: 'json', consistency: 'strong' });
      const actual = entry ? storedBase(entry.data?.id, entry.etag) : { revision: null, etag: null };
      if (canonical(actual) !== canonical(base)) {
        throw new ContentError('Content changed since this draft was based on it. Your draft is preserved; review current published text before rebasing.', 409);
      }
      if (entry) {
        validate(page, entry.data.values, entry.data.schema);
        await publicationChain(page);
        await archive(page, entry.data);
      }
      const candidate = {
        id: uuid(), page, schema: draft.schema, values, at: now(), actor,
        sourceDraft: draft.id, parentRevision: actual.revision,
      };
      if (candidate.id === actual.revision) throw new ContentError('Publication revision collision.', 409);
      // Archive before the single-key CAS. Failed candidates are not committed:
      // only revisions reachable from the published head enter publication history.
      await archive(page, candidate);
      const result = await store.setJSON(page, candidate,
        actual.etag === null ? { onlyIfNew: true } : { onlyIfMatch: actual.etag });
      if (!requireWriteResult(result)) {
        // A response can be lost after commit and retried by the SDK with the same
        // precondition. Confirm only our exact candidate, never retry against a new ETag.
        const confirmed = await store.getWithMetadata(page, { type: 'json', consistency: 'strong' });
        if (confirmed?.data?.id === candidate.id && canonical(confirmed.data) === canonical(candidate)) {
          return { revision: candidate.id, etag: confirmed.etag };
        }
        throw new ContentError('Another editor published first. Your draft is preserved; reload and review before rebasing.', 409);
      }
      return { revision: candidate.id, etag: result.etag };
    },
  };
}

// The registry is trusted server code, never supplied through request bodies.
export function createScopedContentRepository({ registry, ...options }) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new ContentError('A server-side content registry is required.');
  return createContentRepository({ registry, ...options });
}

const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')) {
    throw new ContentError('JSON content type required.', 415);
  }
  if (!req.body) throw new ContentError('Request body required.');
  const reader = req.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 180000) {
      await reader.cancel();
      throw new ContentError('Request body too large.', 413);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new ContentError('Invalid JSON body.');
  }
}

export function createAdminContentHandler({ requireSession, repository = createContentRepository() }) {
  return async (req) => {
    try {
      const auth = await requireSession(req);
      if (auth.error) return auth.error;
      if (!auth.user || !['admin', 'super'].includes(auth.user.role)) {
        return response({ error: 'forbidden' }, 403);
      }
      const url = new URL(req.url);
      const page = url.searchParams.get('page') || 'home';
      const definition = repository.definition(page);
      if (req.method === 'GET') {
        const revision = url.searchParams.get('revision');
        if (revision) return response(await repository.getDraft(page, revision));
        const [current, history, publications] = await Promise.all([
          repository.getPublished(page), repository.history(page), repository.publicationHistory(page),
        ]);
        return response({ page, schema: definition.schema, current, history, publications, canPublish: true });
      }
      if (req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
      const data = await readBody(req);
      if (data.action === 'save') {
        return response(await repository.save(page, data.values, data.schema, auth.user.email, null, validateBase(data.base)), 201);
      }
      if (data.action === 'restore') {
        return response(await repository.restore(page, data.revision, auth.user.email), 201);
      }
      if (data.action === 'restorePublication') {
        return response(await repository.restorePublication(page, data.revision, auth.user.email), 201);
      }
      if (data.action === 'publish') {
        return response(await repository.publish(page, data.revision, data.base, auth.user.email), 200);
      }
      throw new ContentError('Unknown content action.');
    } catch (error) {
      if (error instanceof ContentError) return response({ error: error.message }, error.status);
      console.warn('[content] request failed');
      return response({ error: 'Content storage unavailable. No successful change is confirmed; try again.' }, 503);
    }
  };
}

export function createPublicContentHandler(repository = createContentRepository()) {
  return async (req) => {
    if (req.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
    try {
      const page = new URL(req.url).searchParams.get('page') || 'home';
      pageDefinition(page);
      if (page === 'saunas') throw new ContentError('Unknown content page.', 404);
      const scopes = page === 'shared' ? ['shared'] : ['shared', page];
      const records = await Promise.all(scopes.map(async (scope) => {
        const current = await repository.getPublished(scope);
        // Do not send defaults unnecessarily, and never read the private draft store.
        return [scope, current.revision ? current.values : {}];
      }));
      return response(Object.fromEntries(records));
    } catch (error) {
      return response({ error: error instanceof ContentError ? error.message : 'Content unavailable.' },
        error instanceof ContentError ? error.status : 503);
    }
  };
}
