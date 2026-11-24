"""Generate the checked-in, text-node-only CMS allowlist from public HTML."""
import hashlib
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = {
    "home": ("index.html", "/"),
    "about": ("about.html", "/about"),
    "services": ("services.html", "/services"),
    "portfolio": ("portfolio.html", "/portfolio"),
    "shop": ("shop.html", "/shop"),
    "product": ("shop/product.html", "/shop/product.html"),
    "contact": ("contact.html", "/contact"),
    "reviews": ("reviews.html", "/reviews"),
    "not-found": ("404.html", "/404.html"),
    "order-confirmed": ("order/confirmed.html", "/order/confirmed.html"),
    "stripe-onboarding-complete": ("stripe/onboarding-complete.html", "/stripe/onboarding-complete.html"),
}
VOID = set("area base br col embed hr img input link meta param source track wbr".split())
TEXT_TAGS = set("h1 h2 h3 h4 p li a button span strong label legend".split())
EXCLUDED_IDS = {
    "product-grid", "home-featured-shop", "reviews-carousel", "reviews-grid",
    "sauna-kit-grid", "upload-list", "success-name", "order-ref", "lightbox",
}


class CatalogParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.fields = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        parent = self.stack[-1] if self.stack else None
        counts = parent["counts"] if parent else {}
        counts[tag] = counts.get(tag, 0) + 1
        selector = f'{tag}:nth-of-type({counts[tag]})'
        if parent:
            selector = parent["selector"] + " > " + selector
        attributes_excluded = bool(parent and parent["excluded"])
        attributes_excluded |= tag in {"head", "script", "style", "svg"}
        attributes_excluded |= attrs.get("id") in EXCLUDED_IDS
        attributes_excluded |= attrs.get("name") == "bot-field"
        attributes_excluded |= attrs.get("href", "").startswith(("mailto:", "tel:"))
        attributes_excluded |= "hp-field" in attrs.get("class", "")
        attributes_excluded |= "display:none" in attrs.get("style", "").replace(" ", "")
        excluded = attributes_excluded or tag in {"select", "textarea"}
        if not attributes_excluded:
            for name in ("alt", "placeholder", "aria-label", "data-caption"):
                value = attrs.get(name, "")
                if value and re.search(r"[A-Za-z0-9]", value):
                    self.fields.append({
                        "label": name.replace("-", " ").title() + " — " + re.sub(r"\s+", " ", value)[:74],
                        "default": value,
                        "requiredText": name in {"alt", "aria-label"},
                        "targets": [{"selector": selector, "attribute": name}],
                    })
        node = dict(tag=tag, attrs=attrs, selector=selector, excluded=excluded,
                    counts={}, texts=0, pending=None)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        if not self.stack:
            return
        node = self.stack[-1]
        text_index = node["texts"]
        node["texts"] += 1
        text = data.strip()
        if node["excluded"] or node["tag"] not in TEXT_TAGS or not re.search(r"[A-Za-z0-9]", text):
            return
        # Submit buttons have temporary labels and are owned by their form scripts.
        if node["tag"] == "button" and node["attrs"].get("type") == "submit":
            return
        ancestors = self.stack
        # Never expose honeypot text or dynamically rendered cart/review/product content.
        if any(n["attrs"].get("id") in EXCLUDED_IDS for n in ancestors):
            return
        classes = node["attrs"].get("class", "").split()
        label = next((c.replace("-", " ").title() for c in classes if c != "reveal"), node["tag"].upper())
        self.fields.append({
            "label": label + " — " + re.sub(r"\s+", " ", text)[:74],
            "default": text,
            "targets": [{"selector": node["selector"], "text": text_index}],
        })


def shared_field(key, label, default, selectors):
    return {"id": key, "label": label, "default": default,
            "targets": [{"selector": selector, "text": 0} for selector in selectors]}


def shared_attribute(key, label, default, selector, attribute):
    return {"id": key, "label": label, "default": default, "requiredText": True,
            "targets": [{"selector": selector, "attribute": attribute}]}


shared = []
for index, (name, _) in enumerate([("Home", "/"), ("Services", "/services"),
                                   ("Portfolio", "/portfolio"), ("Shop", "/shop"),
                                   ("About", "/about")], 1):
    shared.append(shared_field("nav-" + name.lower(), "Navigation: " + name, name, [
        f".nav-links li:nth-child({index}) > a",
        f".nav-mobile-overlay > a:nth-child({index})",
        f".footer-inner > div:nth-child(2) li:nth-child({index}) > a",
    ]))
shared.extend([
    shared_field("nav-quote", "Navigation quote CTA", "Get a Quote",
                 [".nav-cta", ".nav-mobile-overlay > a.accent"]),
    shared_field("footer-explore", "Footer explore heading", "Explore",
                 [".footer-inner > div:nth-child(2) > h4"]),
    shared_field("footer-connect", "Footer connect heading", "Connect",
                 [".footer-inner > div:nth-child(3) > h4"]),
    shared_field("footer-description", "Footer business description",
                 "Custom woodworking, cabinetry, and design — handcrafted in Springfield, Oregon.",
                 [".footer-brand > p"]),
    shared_field("footer-quote", "Footer quote CTA", "Request a Quote →", [".footer-cta"]),
    shared_field("footer-credit", "Footer site credit", "Site by Brandtworks-Enterprises LLC",
                 [".footer-bottom > span:nth-child(2)"]),
    shared_attribute("nav-home-accessible", "Navigation logo accessible label", "Studio 37 home", ".nav-logo", "aria-label"),
    shared_attribute("nav-logo-alt", "Navigation logo description", "Studio 37 Custom Designs", ".nav-logo img", "alt"),
    shared_attribute("nav-cart-accessible", "Open cart accessible label", "Open cart", ".nav-cart", "aria-label"),
    shared_attribute("nav-menu-accessible", "Open menu accessible label", "Open menu", ".nav-mobile-toggle", "aria-label"),
    shared_attribute("footer-logo-alt", "Footer logo description", "Studio 37 Custom Designs", ".footer-brand img", "alt"),
    shared_attribute("footer-instagram-accessible", "Instagram accessible label", "Instagram", ".footer-social a:nth-child(1)", "aria-label"),
    shared_attribute("footer-pinterest-accessible", "Pinterest accessible label", "Pinterest", ".footer-social a:nth-child(2)", "aria-label"),
])
pages = {"shared": {"label": "Shared navigation and footer", "path": "/", "fields": shared}}
cart_copy = [
    ("title", "Cart title", "Your Cart"),
    ("empty", "Empty cart message", "Your cart is empty."),
    ("browse", "Empty cart link", "Browse the shop"),
    ("remove", "Remove button", "Remove"),
    ("subtotal", "Subtotal label", "Subtotal"),
    ("shipping", "Shipping and tax notice", "Shipping & tax calculated at checkout."),
    ("blocked", "Checkout blocked notice", "Resolve the issues above before checking out."),
    ("checkout", "Checkout button", "Checkout →"),
    ("starting", "Starting checkout", "Starting checkout…"),
    ("unavailable", "Unavailable item notice", "No longer available."),
    ("remove-from-cart", "Unavailable item removal link", "Remove from cart"),
    ("by-request", "By-request item notice", "This item is by request only."),
    ("contact", "By-request contact link", "Contact Drew"),
    ("to-order", "By-request order instruction", "to order."),
    ("out-of-stock", "Out-of-stock item notice", "Out of stock right now."),
    ("check-back", "Out-of-stock follow-up", "or check back soon."),
    ("price-changed", "Price change prefix", "Price changed to"),
    ("accept-price", "Accept new price button", "Use new price"),
    ("or-remove", "Price change removal link", "or remove"),
    ("checkout-disabled", "Checkout unavailable message", "Checkout is not yet active. Please contact Drew at (541) 514-7720 to place this order."),
    ("checkout-error", "Checkout failure message", "Could not start checkout. Please try again."),
    ("success", "Successful checkout notice", "Thank you! Your order is in. You'll receive a confirmation email shortly."),
    ("cancelled", "Cancelled checkout notice", "Checkout cancelled. Your cart is still here when you’re ready."),
    ("cart-accessible", "Cart accessible label", "Shopping cart"),
    ("close-accessible", "Close cart accessible label", "Close cart"),
    ("decrease-accessible", "Decrease quantity accessible label", "Decrease quantity"),
    ("increase-accessible", "Increase quantity accessible label", "Increase quantity"),
]
cart_fields = [{"id": key, "label": label, "default": default, "targets": []}
               for key, label, default in cart_copy]
pages["cart"] = {"label": "Shopping cart and checkout", "path": "/", "fields": cart_fields}
dynamic_copy = [
    ("shop-made-to-order", "Shop: made-to-order category", "Made to Order"),
    ("shop-small-goods", "Shop: small goods category", "Small Goods"),
    ("shop-furniture", "Shop: furniture category", "Furniture"),
    ("shop-cabinetry", "Shop: cabinetry category", "Cabinetry"),
    ("shop-slab", "Shop: slab category", "Slab"),
    ("shop-custom", "Shop: custom category", "Custom"),
    ("shop-default-category", "Shop: default category", "Studio 37"),
    ("shop-add", "Shop: add to cart", "Add to Cart"),
    ("shop-request", "Shop: request item", "Request This Item"),
    ("shop-unavailable", "Shop: out of stock", "Out of Stock"),
    ("shop-from", "Shop: starting price prefix", "From"),
    ("shop-empty", "Shop: empty category", "No items in this category yet."),
    ("shop-error", "Shop: loading error", "The shop is taking a breather. Please refresh in a moment."),
    ("home-shop", "Home: featured shop link", "Shop →"),
    ("home-slab", "Home: slab category", "Slab Work"),
    ("product-unspecified", "Product: missing selection", "Product not specified."),
    ("product-back", "Product: back link", "Back to shop"),
    ("product-unavailable", "Product: unavailable", "This product is no longer available."),
    ("product-error", "Product: loading error", "Could not load this product."),
    ("product-browse", "Product: browse link", "Browse the shop"),
    ("product-dimensions", "Product: dimensions", "Dimensions"),
    ("product-materials", "Product: materials", "Materials"),
    ("product-lead-time", "Product: lead time", "Lead time"),
    ("product-days", "Product: lead time unit", "days"),
    ("product-sku", "Product: SKU", "SKU"),
    ("product-add", "Product: add to cart", "Add to cart"),
    ("product-request", "Product: quote link", "Request a quote"),
    ("product-unavailable-button", "Product: out of stock", "Out of stock"),
    ("reviews-empty", "Reviews: empty list", "No reviews yet — be the first to share your experience below."),
    ("reviews-sending", "Reviews: submitting", "Sending…"),
    ("reviews-error", "Reviews: submission error", "Something went wrong sending your review. Please try again in a moment."),
    ("reviews-submit", "Reviews: submit button", "Submit Review"),
    ("reviews-star-label", "Reviews: rating suffix", "out of 5 stars"),
    ("reviews-dot-label", "Home: review navigation label", "Review"),
    ("quote-prefill-service", "Quote: service prefill prefix", "Inquiring about:"),
    ("quote-prefill-product", "Quote: product prefill prefix", "I'm interested in:"),
]
dynamic_fields = [{"id": key, "label": label, "default": default, "targets": []}
                  for key, label, default in dynamic_copy]
pages["dynamic-copy"] = {"label": "Shop, product and review messages", "path": "/", "fields": dynamic_fields}
for key, (filename, url) in PAGES.items():
    parser = CatalogParser()
    parser.feed((ROOT / "src" / filename).read_text(encoding="utf-8"))
    for index, field in enumerate(parser.fields, 1):
        field["id"] = f"text-{index:03}"
    pages[key] = {"label": key.replace("-", " ").title(), "path": url, "fields": parser.fields}
for page in pages.values():
    page["schema"] = hashlib.sha256(json.dumps(page["fields"], sort_keys=True).encode()).hexdigest()[:16]
payload = json.dumps(pages, ensure_ascii=False, indent=2)
output = """/* Generated by scripts/generate-content-schema.py; review schema changes before release. */
(function (root) {
  const pages = PAYLOAD;
  if (typeof module === 'object' && module.exports) module.exports = pages;
  else root.Studio37ContentSchema = pages;
})(typeof globalThis !== 'undefined' ? globalThis : this);
""".replace("PAYLOAD", payload)
target = ROOT / "src" / "assets" / "js" / "content-schema.js"
if "--check" in sys.argv:
    if target.read_text(encoding="utf-8") != output:
        raise SystemExit("CMS schema is stale. Regenerate and review scripts/generate-content-schema.py output.")
else:
    target.write_text(output, encoding="utf-8")
print("Generated CMS schema: " + ", ".join(f'{key}={len(page["fields"])}' for key, page in pages.items()))
