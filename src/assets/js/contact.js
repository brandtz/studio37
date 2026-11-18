/* Studio 37 — Contact / Quote form: validation, prefill, file picker, submit */
(() => {
  const form = document.getElementById('quote-form');
  if (!form) return;
  const success = document.getElementById('form-success');
  const successName = document.getElementById('success-name');

  const QUOTE_ERROR_MESSAGES = {
    too_many_photos: 'Please attach up to 3 reference photos.',
    photo_too_large: 'Each reference photo must be 10 MB or smaller.',
    invalid_photo_type: 'Reference photos must be JPG, PNG, WEBP, or GIF images.',
    invalid_email: 'Please enter a valid email address.',
    invalid_phone: 'Please enter a valid phone number.',
    invalid_customer_type: 'Please select a valid customer type.',
    invalid_state: 'Please enter a two-letter state abbreviation.',
    invalid_deadline: 'Please select a valid deadline date.',
    invalid_service: 'Please select a valid service offering.',
    invalid_engraving: 'Engraving is available with home goods and gifts.',
    photo_upload_failed: 'Your photos could not be uploaded. Please try again or email Drew@studio37customdesigns.com.',
    lead_save_failed: 'Your request could not be saved. Please try again or email Drew@studio37customdesigns.com.',
    too_many_requests: 'Please give us a chance to respond before sending more requests.',
  };
  const QUOTE_ERROR_MESSAGE_VALUES = new Set(Object.values(QUOTE_ERROR_MESSAGES));

  const { serviceGroups, customerTypes, serviceLabels, homeGoods } = window.Studio37QuoteOptions;
  const sel = form.querySelector('#service');
  serviceGroups.forEach((group) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    group.options.forEach(([value, label]) => optgroup.appendChild(new Option(label, value)));
    sel.add(optgroup);
  });
  sel.add(new Option('Other (describe in Order Details)', 'other'));
  const customerType = form.querySelector('#customerType');
  Object.entries(customerTypes).forEach(([value, label]) => customerType.add(new Option(label, value)));

  const engravingField = document.getElementById('engraving-field');
  const engraving = form.elements.engravingAddon;
  function updateEngraving() {
    const show = homeGoods.includes(sel.value);
    engravingField.hidden = !show;
    engraving.disabled = !show;
    if (!show) engraving.checked = false;
  }
  sel.addEventListener('change', updateEngraving);

  const deadlineField = document.getElementById('deadline-field');
  const deadlineDate = form.elements.deadlineDate;
  const today = new Date();
  deadlineDate.min = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  function updateDeadline() {
    const show = form.elements.hasDeadline.value === 'yes';
    deadlineField.hidden = !show;
    deadlineDate.disabled = !show;
    deadlineDate.required = show;
    if (!show) deadlineDate.value = '';
  }
  form.querySelectorAll('[name="hasDeadline"]').forEach((input) => input.addEventListener('change', updateDeadline));

  const params = new URLSearchParams(location.search);
  const serviceParam = params.get('service');
  const desc = form.querySelector('#description');
  if (serviceParam) {
    const aliases = { slab: 'hardwood-flattening', 'slab-flattening': 'hardwood-flattening', saunas: 'outdoor-sauna' };
    const requested = aliases[serviceParam] || serviceParam;
    if (Array.from(sel.options).some((o) => o.value === requested)) {
      sel.value = requested;
    } else {
      sel.value = 'other';
      const label = serviceLabels[serviceParam] || serviceParam.replace(/[-_]+/g, ' ');
      desc.value = `Inquiring about: ${label}\n\n`;
    }
  }
  updateEngraving();
  const productParam = params.get('product');
  if (productParam) {
    desc.value += `I'm interested in: ${productParam}\n\n`;
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
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(QUOTE_ERROR_MESSAGES[body.error] || body.message || ('HTTP ' + r.status));
      }

      successName.textContent = (fd.get('firstName') || 'friend').toString();
      form.hidden = true;
      success.hidden = false;
      window.scrollTo({ top: success.offsetTop - 100, behavior: 'smooth' });
    } catch (err) {
      console.error('Quote submission failed', err);
      alert(err.message && QUOTE_ERROR_MESSAGE_VALUES.has(err.message)
        ? err.message
        : 'Something went wrong sending your request. Please email Drew@studio37customdesigns.com or try again in a moment.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send My Request →';
    }
  });
})();
