/* Studio 37 — Commerce bootstrap
 * Loads Snipcart only after we have a public key from /api/public-config.
 * Avoids the placeholder-key issue entirely and makes test/live a single env-var swap. */

(() => {
  const SNIPCART_VERSION = 'v3.7.1';
  const SCRIPT_URL = `https://cdn.snipcart.com/themes/${SNIPCART_VERSION}/default/snipcart.js`;
  const STYLESHEET_URL = `https://cdn.snipcart.com/themes/${SNIPCART_VERSION}/default/snipcart.css`;

  // Static fallback for local development (file:// or `serve`) where /api isn't running.
  // Snipcart will refuse to checkout without a real key — this just keeps the page from erroring.
  const FALLBACK = { snipcartPublicKey: '', currency: 'usd' };

  function injectSnipcart(cfg) {
    if (!cfg.snipcartPublicKey) {
      console.info('[studio37] Snipcart key not configured — checkout disabled in this environment.');
      // Tag any add-to-cart buttons so they visibly disable.
      document.querySelectorAll('.snipcart-add-item').forEach((btn) => {
        btn.disabled = true;
        btn.title = 'Checkout is not yet configured.';
      });
      return;
    }

    window.SnipcartSettings = {
      publicApiKey: cfg.snipcartPublicKey,
      loadStrategy: 'on-user-interaction',
      currency: cfg.currency || 'usd',
    };

    // Stylesheet
    if (!document.querySelector(`link[href="${STYLESHEET_URL}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = STYLESHEET_URL;
      document.head.appendChild(link);
    }

    // Script
    if (!document.querySelector(`script[src="${SCRIPT_URL}"]`)) {
      const script = document.createElement('script');
      script.async = true;
      script.src = SCRIPT_URL;
      document.head.appendChild(script);
    }
  }

  fetch('/api/public-config')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(injectSnipcart)
    .catch(() => injectSnipcart(FALLBACK));
})();
