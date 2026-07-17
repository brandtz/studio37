/* Studio 37 — Reviews page
 * Renders published reviews from /api/reviews and handles the public
 * "Leave a Review" submission form. Submitted reviews are always pending
 * (published: false server-side) until an admin approves them. */

(function () {
  const grid = document.getElementById('reviews-grid');
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function escape(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function render(items) {
    if (!grid) return;
    if (!items.length) {
      grid.innerHTML = `<p class="reviews-empty" style="grid-column:1/-1;text-align:center;color:var(--color-text-muted);padding:var(--space-8) 0;">No reviews yet — be the first to share your experience below.</p>`;
      return;
    }
    grid.innerHTML = items.map((r) => `
      <div class="review-card-full">
        <div class="review-stars" aria-label="${r.stars} out of 5 stars">${stars(r.stars)}</div>
        <p class="review-text">${escape(r.text)}</p>
        <p class="review-byline"><strong>${escape(r.name)}</strong> &mdash; ${escape(r.location || '')}</p>
        ${r.project ? `<p style="font-size:var(--text-xs);color:var(--color-accent);letter-spacing:0.08em;text-transform:uppercase;margin-top:var(--space-1);">${escape(r.project)}</p>` : ''}
      </div>
    `).join('');
  }

  if (grid) {
    fetch('/api/reviews')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((items) => render(Array.isArray(items) ? items : []))
      .catch(() => render([]));
  }

  // ── Leave a Review form ────────────────────────────────
  const form = document.getElementById('review-form');
  if (!form) return;
  const success = document.getElementById('review-form-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.querySelector('[name="bot-field"]')?.value) return; // honeypot
    if (!form.reportValidity()) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    const body = {
      name: form.querySelector('#review-name').value,
      location: form.querySelector('#review-location').value,
      project: form.querySelector('#review-project').value,
      stars: form.querySelector('#review-stars').value,
      text: form.querySelector('#review-text').value,
    };

    try {
      const r = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      form.hidden = true;
      if (success) success.hidden = false;
    } catch (err) {
      console.error('Review submission failed', err);
      alert('Something went wrong sending your review. Please try again in a moment.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Review';
    }
  });
}());
