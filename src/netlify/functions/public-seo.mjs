import seoSchema from '../../assets/js/seo-schema.js';
import { createContentRepository } from './_lib/content.mjs';

export function createPublicSeoHandler(repository = createContentRepository()) {
  return async (request) => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
    const scope = new URL(request.url).searchParams.get('page');
    if (!Object.hasOwn(seoSchema, scope || '')) return response({ error: 'not_found' }, 404);
    try {
      const current = await repository.getPublished(scope);
      return response({ revision: current.revision, values: current.revision ? current.values : null });
    } catch {
      console.warn('[seo] published metadata read failed for ' + scope);
      return response({ error: 'unavailable' }, 503);
    }
  };
}

export default createPublicSeoHandler();
