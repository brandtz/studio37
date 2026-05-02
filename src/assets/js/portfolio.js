/* Studio 37 — Portfolio page: filter + lightbox */
(() => {
  const grid = document.getElementById('portfolio-grid');
  if (!grid) return;
  const items = Array.from(grid.querySelectorAll('.masonry-item'));
  const pills = document.querySelectorAll('.portfolio-filters .filter-pill');

  pills.forEach((pill) => {
    pill.addEventListener('click', () => {
      pills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const f = pill.dataset.filter;
      items.forEach((it) => {
        const match = f === 'all' || it.dataset.category === f;
        it.style.display = match ? '' : 'none';
      });
    });
  });

  const lb = document.getElementById('lightbox');
  const lbImg = lb.querySelector('.lightbox-img');
  const lbCap = lb.querySelector('.lightbox-caption');
  let visibleIndex = 0;

  function visibleItems() {
    return items.filter((it) => it.style.display !== 'none');
  }
  function open(idx) {
    visibleIndex = idx;
    const list = visibleItems();
    if (!list.length) return;
    const it = list[((idx % list.length) + list.length) % list.length];
    visibleIndex = list.indexOf(it);
    lbImg.src = it.querySelector('img').src;
    lbCap.textContent = it.dataset.caption || '';
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  items.forEach((it) => {
    it.addEventListener('click', () => open(visibleItems().indexOf(it)));
  });
  lb.querySelector('.lightbox-close').addEventListener('click', close);
  lb.querySelector('.lightbox-prev').addEventListener('click', () => open(visibleIndex - 1));
  lb.querySelector('.lightbox-next').addEventListener('click', () => open(visibleIndex + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') open(visibleIndex - 1);
    if (e.key === 'ArrowRight') open(visibleIndex + 1);
  });
})();
