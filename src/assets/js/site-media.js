/* Studio 37 — Site media runtime swap.
   Loads admin overrides for image slots and applies them to <img data-site-slot="..."> tags.
   Designed to be loaded with `defer` on every public page. */
(() => {
  const elements = document.querySelectorAll('[data-site-slot]');
  if (!elements.length) return;

  fetch('/api/site-media', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((map) => {
      elements.forEach((el) => {
        const slot = el.getAttribute('data-site-slot');
        const entry = map && map[slot];
        if (!entry || !entry.url) return;
        if (el.tagName === 'IMG') {
          el.src = entry.url;
          if (entry.alt) el.alt = entry.alt;
        } else {
          // Background-image style for non-img elements
          el.style.backgroundImage = `url("${entry.url}")`;
          if (entry.alt) el.setAttribute('aria-label', entry.alt);
        }
      });
    })
    .catch(() => { /* offline / network — fall back to defaults */ });
})();
