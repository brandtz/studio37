/* Studio 37 — Contact / Quote form: validation, prefill, file picker, submit */
(() => {
  const form = document.getElementById('quote-form');
  if (!form) return;
  const success = document.getElementById('form-success');
  const successName = document.getElementById('success-name');

  const { serviceLabels } = window.Studio37QuoteOptions;
  const quoteForm = window.Studio37QuoteForm;
  let presentation = { schema: quoteForm.definition.schema, revision: null, values: quoteForm.defaults() };
  const message = (name) => presentation.values['message-' + name];
  const sel = form.querySelector('#service');
  quoteForm.apply(presentation.values);
  async function refreshPresentation() {
    const response = await fetch('/.netlify/functions/quote-form-content', { cache: 'no-store' });
    if (!response.ok) throw new Error(message('quote_form_unavailable'));
    const record = await response.json();
    if (record.schema !== quoteForm.definition.schema) throw new Error(message('quote_form_unavailable'));
    quoteForm.apply(record.values);
    presentation = record;
    updateEngraving();
  }

  const engravingField = document.getElementById('engraving-field');
  const engraving = form.elements.engravingAddon;
  function updateEngraving() {
    const show = quoteForm.parseChoices('service', presentation.values['choices-service'])
      .some((row) => row.id === sel.value && row.group === 'home-goods');
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
  let serviceTouched = false;
  let prefillText = '';
  sel.addEventListener('change', () => { serviceTouched = true; });
  function prefillService() {
    if (!serviceParam || serviceTouched || /\bsaunas?\b/i.test(serviceParam)) return;
    const aliases = { slab: 'hardwood-flattening', 'slab-flattening': 'hardwood-flattening' };
    const requested = aliases[serviceParam] || serviceParam;
    if (Array.from(sel.options).some((o) => o.value === requested)) {
      sel.value = requested;
      if (prefillText && desc.value === prefillText) desc.value = '';
    } else {
      sel.value = 'other';
      const label = serviceLabels[serviceParam] || serviceParam.replace(/[-_]+/g, ' ');
      if (!desc.value || desc.value === prefillText) {
        prefillText = `Inquiring about: ${label}\n\n`;
        desc.value = prefillText;
      }
    }
    updateEngraving();
  }
  prefillService();
  updateEngraving();
  const productParam = params.get('product');
  if (productParam && !/\bsaunas?\b/i.test(productParam) && !/\bsaunas?\b/i.test(serviceParam || '')) {
    desc.value += `I'm interested in: ${productParam}\n\n`;
  }
  const originalPrefill = desc.value;
  window.Studio37Content.loadScope('dynamic-copy').then((copy) => {
    if (!originalPrefill || desc.value !== originalPrefill) return;
    let updated = originalPrefill;
    if (prefillText && updated.startsWith(prefillText)) {
      const newPrefill = prefillText.replace('Inquiring about:', copy['quote-prefill-service']);
      updated = newPrefill + updated.slice(prefillText.length);
      prefillText = newPrefill;
    }
    if (productParam) updated = updated.replace("I'm interested in:", copy['quote-prefill-product']);
    desc.value = updated;
  });
  const ready = refreshPresentation().then(prefillService).catch(() => {
    document.getElementById('quote-form-status').textContent = message('defaults');
  });

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
      alert(message('file_count'));
      fileInput.value = '';
      return;
    }
    if (files.some((f) => f.size > MAX_BYTES)) {
      alert(message('file_size'));
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

    await ready;
    if (form.querySelector('button[type="submit"]').disabled) return;
    if (!form.reportValidity()) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = message('sending');

    try {
      const fd = new FormData(form);
      fd.set('quoteSchema', presentation.schema);
      fd.set('quoteRevision', presentation.revision || '');
      const r = await fetch('/api/quote-request', {
        method: 'POST',
        body: fd,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.error === 'quote_form_changed') await refreshPresentation();
        const field = 'message-' + body.error;
        throw new Error(Object.hasOwn(presentation.values, field) ? presentation.values[field] : message('fallback'));
      }

      successName.textContent = (fd.get('firstName') || message('friend')).toString();
      form.hidden = true;
      success.hidden = false;
      window.scrollTo({ top: success.offsetTop - 100, behavior: 'smooth' });
    } catch (err) {
      console.error('Quote submission failed', err);
      const status = document.getElementById('quote-form-status');
      const knownMessages = quoteForm.definition.fields.filter((field) => field.id.startsWith('message-')).map((field) => presentation.values[field.id]);
      status.textContent = err.message && knownMessages.includes(err.message) ? err.message : message('fallback');
      status.tabIndex = -1;
      status.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = presentation.values.submit;
    }
  });
})();
