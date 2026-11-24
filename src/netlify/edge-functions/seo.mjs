const routes = {
  '/': 'home', '/index.html': 'home',
  '/services': 'services', '/services/': 'services', '/services.html': 'services',
  '/portfolio': 'portfolio', '/portfolio/': 'portfolio', '/portfolio.html': 'portfolio',
  '/shop': 'shop', '/shop/': 'shop', '/shop.html': 'shop',
  '/about': 'about', '/about/': 'about', '/about.html': 'about',
  '/contact': 'contact', '/contact/': 'contact', '/contact.html': 'contact',
  '/reviews': 'reviews', '/reviews/': 'reviews', '/reviews.html': 'reviews',
  '/shop/product': 'product', '/shop/product/': 'product', '/shop/product.html': 'product',
  '/404': '404', '/404/': '404', '/404.html': '404',
  '/order/confirmed': 'order-confirmed', '/order/confirmed/': 'order-confirmed', '/order/confirmed.html': 'order-confirmed',
  '/stripe/onboarding-complete': 'stripe-onboarding-complete', '/stripe/onboarding-complete/': 'stripe-onboarding-complete', '/stripe/onboarding-complete.html': 'stripe-onboarding-complete',
};

export const config = {
  path: '/*',
  excludedPath: ['/assets/*', '/api', '/api/*', '/.netlify/*', '/admin', '/admin/*', '/manifest.json'],
  method: 'GET',
  onError: 'bypass',
};

const fullFields = ['title', 'description', 'og-title', 'og-description'];
const fieldsByPage = {
  product: ['title', 'description'],
  'order-confirmed': ['title'],
  'stripe-onboarding-complete': ['title'],
};

const escapeText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');

export function renderMetadata(html, values, keys = fullFields) {
  if (!values || typeof values !== 'object' || Array.isArray(values) ||
      Object.keys(values).length !== keys.length ||
      keys.some((key) => typeof values[key] !== 'string' || values[key].length > (key.includes('description') ? 500 : 300) ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(values[key]))) return null;
  const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i);
  if (!head) return null;
  let modified = head[0];
  const title = /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi;
  const replaceOne = (pattern, replacement) => {
    const matches = [...modified.matchAll(pattern)];
    if (matches.length !== 1) return false;
    modified = modified.replace(pattern, replacement);
    return true;
  };
  if (!replaceOne(title, () => '<title>' + escapeText(values.title) + '</title>')) return null;
  for (const [key, attr, name] of [
    ['description', 'name', 'description'],
    ['og-title', 'property', 'og:title'], ['og-description', 'property', 'og:description'],
  ].filter(([key]) => keys.includes(key))) {
    const tag = new RegExp('<meta\\b(?=[^>]*\\b' + attr + '\\s*=\\s*["\\\']' + name + '["\\\'])[^>]*>', 'gi');
    if (!replaceOne(tag, (original) => {
      const content = /\bcontent\s*=\s*(["'])[\s\S]*?\1/i;
      if (!content.test(original)) return original;
      return original.replace(content, () => 'content="' + escapeText(values[key]) + '"');
    })) return null;
    // Refuse to alter a template missing the expected content attribute.
    const updated = modified.match(tag);
    if (!updated || !/\bcontent\s*=\s*(["'])[\s\S]*?\1/i.test(updated[0])) return null;
  }
  return html.replace(head[0], () => modified);
}

function noCache(response, body, transformed = false) {
  const headers = new Headers(response.headers);
  for (const name of ['etag', 'last-modified', 'cdn-cache-control', 'netlify-cdn-cache-control']) headers.delete(name);
  if (transformed) for (const name of ['content-length', 'content-encoding', 'content-md5']) headers.delete(name);
  headers.set('cache-control', 'no-store');
  headers.set('netlify-cdn-cache-control', 'no-store');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function fetchJson(url, fetcher) {
  try {
    const result = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    if (!result.ok) {
      if (result.status !== 404) console.warn('[seo] metadata dependency returned HTTP ' + result.status);
      return null;
    }
    return await result.json();
  } catch {
    console.warn('[seo] metadata dependency unavailable');
    return null;
  }
}

async function productMetadata(request, fetcher) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  const url = new URL('/.netlify/functions/products', request.url);
  url.searchParams.set('id', id);
  const product = await fetchJson(url, fetcher);
  if (!product || Array.isArray(product) || product.id !== id ||
      typeof product.name !== 'string' || !product.name.trim() ||
      product.name.length + ' — Studio 37'.length > 300 ||
      /[\u0000-\u001f\u007f]/.test(product.name)) return null;
  const values = { title: product.name + ' — Studio 37' };
  if (typeof product.subtitle === 'string' && product.subtitle.trim() && product.subtitle.length <= 500 &&
      !/[\u0000-\u001f\u007f]/.test(product.subtitle)) values.description = product.subtitle;
  return values;
}

export async function handleSeo(request, context, fetcher = fetch) {
  let page = routes[new URL(request.url).pathname];
  if (request.method !== 'GET' || request.headers.has('range')) return context.next();
  const headers = new Headers(request.headers);
  headers.set('accept-encoding', 'identity');
  const response = await context.next(new Request(request, { headers }));
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) return response;
  if (response.status !== 200 && response.status !== 404) return response;
  if (!page && response.status !== 404) return response;

  try {
    if (response.headers.has('content-encoding') && response.headers.get('content-encoding') !== 'identity') {
      return page && response.status === 200 ? noCache(response, response.body) : response;
    }
    let html;
    if (response.status === 404 || page === '404') {
      html = await response.clone().text();
      if (!/<html\b[^>]*\bdata-page\s*=\s*["']404["'][^>]*>/i.test(html)) return response;
      page = '404';
    }
    if (!page) return response;
    const url = new URL('/.netlify/functions/public-seo', request.url);
    url.searchParams.set('page', 'seo-' + page);
    const [data, product] = await Promise.all([
      fetchJson(url, fetcher),
      page === 'product' ? productMetadata(request, fetcher) : null,
    ]);
    if ((typeof data?.revision === 'string' && data.revision) || product) {
      html = html ?? await response.clone().text();
      if (page === 'order-confirmed' || page === 'stripe-onboarding-complete') {
        if (!/<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']\s*\/?>/i.test(html)) return noCache(response, response.body);
      }
      let rendered = html;
      if (data?.revision) rendered = renderMetadata(html, data.values, fieldsByPage[page] || fullFields) || html;
      if (product) rendered = renderMetadata(rendered, product, Object.keys(product)) || rendered;
      if (rendered !== html) return noCache(response, rendered, true);
    }
  } catch {
    console.warn('[seo] unable to apply published metadata');
  }
  return noCache(response, response.body);
}

export default handleSeo;
