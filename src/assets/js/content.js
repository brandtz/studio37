/* Safe text-node hydration; layout, links, attributes, and scripts stay code-owned. */
(function (root) {
  const pendingScopes = new Map();
  function loadScope(scope) {
    const definition = root.Studio37ContentSchema?.[scope];
    if (!definition) return Promise.reject(new Error('Unknown content scope: ' + scope));
    if (!pendingScopes.has(scope)) {
      pendingScopes.set(scope, (async () => {
        const values = Object.fromEntries(definition.fields.map((field) => [field.id, field.default]));
        try {
          const response = await fetch('/.netlify/functions/public-content?page=' + encodeURIComponent(scope), { cache: 'no-store' });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const published = await response.json();
          for (const field of definition.fields) {
            if (typeof published[scope]?.[field.id] === 'string') values[field.id] = published[scope][field.id];
          }
        } catch (error) {
          console.warn('Published content unavailable for ' + scope + '; using built-in text.', error);
        }
        return values;
      })());
    }
    return pendingScopes.get(scope);
  }
  function apply(scope, values, documentRoot = document) {
    const definition = root.Studio37ContentSchema?.[scope];
    if (!definition || !values || typeof values !== 'object') return;
    definition.fields.forEach((field) => {
      if (!Object.hasOwn(values, field.id) || typeof values[field.id] !== 'string') return;
      field.targets.forEach((target) => {
        documentRoot.querySelectorAll(target.selector).forEach((element) => {
          if (scope === 'contact' && element.closest('#quote-form') && root.Studio37QuoteForm) return;
          if (target.attribute) {
            element.setAttribute(target.attribute, values[field.id]);
            if (target.attribute === 'alt') element.setAttribute('data-cms-alt-owned', 'true');
            return;
          }
          const text = Array.from(element.childNodes).filter((node) => node.nodeType === 3)[target.text];
          if (!text) return;
          const before = text.nodeValue.match(/^\s*/)[0];
          const after = text.nodeValue.match(/\s*$/)[0];
          text.nodeValue = before + values[field.id] + after;
          if (scope === 'shared' && field.id === 'footer-description') element.setAttribute('data-cms-text-owned', 'true');
        });
      });
    });
  }
  root.Studio37Content = { apply, loadScope };
  if (document.documentElement.dataset.page === 'admin-dashboard') return;
  document.addEventListener('DOMContentLoaded', async () => {
    const htmlPage = document.documentElement.dataset.page;
    const page = ({ '404': 'not-found' })[htmlPage] || htmlPage;
    if (!root.Studio37ContentSchema?.[page]) return;
    try {
      const result = await fetch('/.netlify/functions/public-content?page=' + encodeURIComponent(page), { cache: 'no-store' });
      if (!result.ok) return;
      const published = await result.json();
      apply('shared', published.shared);
      apply(page, published[page]);
    } catch { /* Keep every original HTML text node when storage is unavailable. */ }
  });
})(globalThis);
