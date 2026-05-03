/* Studio 37 — Reviews page
 * Renders all reviews from the shared REVIEWS data into the grid.
 * To add new reviews, edit the REVIEWS array in home.js (single source of truth)
 * and also add them here. Both files share the same structure. */

const ALL_REVIEWS = [
  {
    stars: 5,
    text: 'Drew built us a custom entertainment center with sliding barn doors — the craftsmanship is unreal. Every detail was perfect and he finished ahead of schedule.',
    name: 'Sarah M.',
    location: 'Springfield, OR',
    project: 'Custom Built-in Cabinetry',
  },
  {
    stars: 5,
    text: 'We ordered a set of Black Walnut cutting boards as wedding gifts and everyone was blown away. High-quality, beautiful grain, and shipped fast. Will absolutely order again.',
    name: 'Jake & Tori R.',
    location: 'Eugene, OR',
    project: 'Black Walnut Cutting Boards',
  },
  {
    stars: 5,
    text: "Brought in a slab I've had for years and Drew flattened it perfectly. Turned it into a dining table top. The whole process was easy, communication was great, and the result is stunning.",
    name: 'Chris D.',
    location: 'Bend, OR',
    project: 'Slab Flattening',
  },
  {
    stars: 5,
    text: 'Studio 37 built out our entire home office — floating shelves, a custom desk, and built-in cabinetry. Drew nailed the design on the first pass. Highly recommend.',
    name: 'Melissa K.',
    location: 'Corvallis, OR',
    project: 'Home Office Build-out',
  },
];

(function () {
  const grid = document.getElementById('reviews-grid');
  if (!grid) return;

  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function render(items) {
    grid.innerHTML = items.map((r) => `
      <div class="review-card-full">
        <div class="review-stars" aria-label="${r.stars} out of 5 stars">${stars(r.stars)}</div>
        <p class="review-text">${r.text}</p>
        <p class="review-byline"><strong>${r.name}</strong> &mdash; ${r.location || ''}</p>
        ${r.project ? `<p style="font-size:var(--text-xs);color:var(--color-accent);letter-spacing:0.08em;text-transform:uppercase;margin-top:var(--space-1);">${r.project}</p>` : ''}
      </div>
    `).join('');
  }

  fetch('/api/reviews')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((items) => render(Array.isArray(items) && items.length ? items : ALL_REVIEWS))
    .catch(() => render(ALL_REVIEWS));
}());
