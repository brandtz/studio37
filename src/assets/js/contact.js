/* Studio 37 — Contact / Quote form: validation, prefill, file picker, submit */
(() => {
  const form = document.getElementById('quote-form');
  if (!form) return;
  const success = document.getElementById('form-success');
  const successName = document.getElementById('success-name');

  // Prefill service from query string (?service=cabinetry, etc.)
  const params = new URLSearchParams(location.search);
  const serviceParam = params.get('service');
  if (serviceParam) {
    const sel = form.querySelector('#service');
    if (sel && Array.from(sel.options).some((o) => o.value === serviceParam)) {
      sel.value = serviceParam;
    }
  }
  const productParam = params.get('product');
  if (productParam) {
    const desc = form.querySelector('#description');
    if (desc) desc.value = `I'm interested in: ${productParam}\n\n`;
  }

  // File picker UI
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('photos');
  const fileList = document.getElementById('upload-list');
  const MAX_FILES = 3;
  const MAX_BYTES = 10 * 1024 * 1024;

  function refreshFileList() {
    fileList.innerHTML = '';
    Array.from(fileInput.files).slice(0, MAX_FILES).forEach((f) => {
      const li = document.createElement('li');
      li.textContent = `📎 ${f.name} (${Math.round(f.size / 1024)} KB)`;
      fileList.appendChild(li);
    });
  }
  zone.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') fileInput.click(); });
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files);
    if (files.length > MAX_FILES) {
      alert(`Up to ${MAX_FILES} images please.`);
      fileInput.value = '';
      return;
    }
    if (files.some((f) => f.size > MAX_BYTES)) {
      alert('Each image must be 10 MB or smaller.');
      fileInput.value = '';
      return;
    }
    refreshFileList();
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('dragover'); }),
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('dragover'); }),
  );
  zone.addEventListener('drop', (e) => {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.querySelector('[name="bot-field"]').value) return; // honeypot

    if (!form.reportValidity()) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';

    try {
      const fd = new FormData(form);
      const r = await fetch('/api/quote-request', {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      successName.textContent = (fd.get('firstName') || 'friend').toString();
      form.hidden = true;
      success.hidden = false;
      window.scrollTo({ top: success.offsetTop - 100, behavior: 'smooth' });
    } catch (err) {
      console.error('Quote submission failed', err);
      alert('Something went wrong sending your request. Please email Drew@studio37customdesigns.com or try again in a moment.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send My Request →';
    }
  });
})();
