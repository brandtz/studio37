/* Metadata defaults mirror the static templates; canonical URLs remain code-owned. */
(function (root) {
  const pages = {
    home: ['Home', '/', 'Studio 37 Custom Designs — Custom Woodworking in Springfield, Oregon', 'Custom cabinetry, slab flattening, furniture, and small goods handcrafted by Drew Trano in Springfield, Oregon.', 'Studio 37 Custom Designs', 'Custom woodworking, handcrafted in the Pacific Northwest by Drew Trano.'],
    services: ['Services', '/services', 'Services — Studio 37 Custom Designs', 'Custom cabinetry, slab flattening, CNC and laser engraving, custom furniture, and small goods. Built to last generations.', 'Services — Studio 37 Custom Designs', 'Custom cabinetry, slab flattening, CNC and laser engraving, custom furniture, and small goods. Built to last generations.'],
    portfolio: ['Portfolio', '/portfolio', 'Portfolio — Studio 37 Custom Designs', 'A gallery of custom woodworking, furniture, slab work, and small goods by Studio 37.', 'Portfolio — Studio 37 Custom Designs', 'A gallery of custom woodworking, furniture, slab work, and small goods by Drew Trano.'],
    shop: ['Shop', '/shop', 'Shop — Studio 37 Custom Designs', 'Handcrafted small goods, cutting boards, charcuterie, and gift pieces, ready to ship.', 'Shop — Studio 37 Custom Designs', 'Handcrafted small goods, cutting boards, charcuterie boards, and gift pieces, ready to ship.'],
    about: ['About', '/about', 'About — Studio 37 Custom Designs', "Drew Trano's story — a craftsman raised in his father's shop, working in local and exotic timbers from Springfield, Oregon.", 'About — Studio 37 Custom Designs', "Drew Trano — a craftsman raised in his father's shop, working in local and exotic timbers from Springfield, Oregon."],
    contact: ['Contact', '/contact', 'Request for Quote — Studio 37 Custom Designs', 'Tell me about your project. Expect an initial response in approximately 3–5 business days.', 'Request for Quote — Studio 37 Custom Designs', 'Tell me about your project. Expect an initial response in approximately 3–5 business days.'],
    reviews: ['Reviews', '/reviews', 'Customer Reviews — Studio 37 Custom Designs', 'What customers say about Studio 37 Custom Designs — custom woodworking, cabinetry, and small goods by Drew Trano in Springfield, Oregon.', 'Customer Reviews — Studio 37 Custom Designs', 'What customers say about Studio 37 Custom Designs.'],
    product: ['Product page (generic fallback)', '/shop/product', 'Product — Studio 37', 'Handcrafted goods from Studio 37.'],
    '404': ['Not found', '/404', 'Not Found — Studio 37 Custom Designs', "That page doesn't exist — head back to the Studio 37 homepage.", 'Not Found — Studio 37 Custom Designs', "That page doesn't exist."],
    'order-confirmed': ['Order confirmation (noindex)', '/order/confirmed', 'Order Confirmed — Studio 37'],
    'stripe-onboarding-complete': ['Stripe onboarding confirmation (noindex)', '/stripe/onboarding-complete', 'Stripe Setup — Studio 37'],
  };
  const labels = ['Page title', 'Meta description', 'Open Graph title', 'Open Graph description'];
  const ids = ['title', 'description', 'og-title', 'og-description'];
  const registry = Object.fromEntries(Object.entries(pages).map(([key, page]) => [
    'seo-' + key,
    {
      label: 'SEO — ' + page[0], path: page[1], schema: 'seo-v1',
      fields: page.slice(2).map((value, index) => ({
        id: ids[index], label: labels[index], default: value, targets: [], maxLength: index % 2 ? 500 : 300,
      })),
    },
  ]));
  if (typeof module === 'object' && module.exports) module.exports = registry;
  else root.Studio37SeoSchema = registry;
})(typeof globalThis !== 'undefined' ? globalThis : this);
