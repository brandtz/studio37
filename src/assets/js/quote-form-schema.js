/* One published scope for quote presentation. Field structure remains code-owned. */
(function (root) {
  const catalog = typeof module === 'object' && module.exports ? require('./content-schema.js') : root.Studio37ContentSchema;
  const options = typeof module === 'object' && module.exports ? require('./quote-options.js') : root.Studio37QuoteOptions;
  const scope = 'quote-form';
  const groupIds = ['live-edge', 'custom-orders', 'home-goods'];
  const fields = catalog.contact.fields
    .filter((field) => field.targets.some((target) => target.selector.includes(' > form:')))
    .map((field) => ({ ...field, requiredText: true }));
  const text = (id, label, value, targets = [], extra = {}) => fields.push({ id, label, default: value, targets, ...extra });
  const selectNames = ['customerType', 'service', 'budget', 'referral'];
  const placeholders = ['Select customer type…', 'Select a service…', 'Select…', 'Select…'];
  selectNames.forEach((name, index) => text('placeholder-' + name, name + ': dropdown prompt', placeholders[index], [], { requiredText: true }));
  text('submit', 'Submit button', 'Send My Request →', [], { requiredText: true });
  const messages = {
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
    invalid_budget: 'Please select a currently available budget choice.',
    invalid_referral: 'Please select a currently available referral choice.',
    invalid_contact_method: 'Please select a valid contact method.',
    quote_form_changed: 'Quote choices have changed. Review the refreshed choices and submit again; your entered details have been kept.',
    quote_form_unavailable: 'Quote choices are temporarily unavailable. Please try again in a moment.',
    photo_upload_failed: 'Your photos could not be uploaded. Please try again or email Drew@studio37customdesigns.com.',
    lead_save_failed: 'Your request could not be saved. Please try again or email Drew@studio37customdesigns.com.',
    too_many_requests: 'Please give us a chance to respond before sending more requests.',
    fallback: 'Something went wrong sending your request. Please email Drew@studio37customdesigns.com or try again in a moment.',
    defaults: 'Showing default choices. Current availability will be checked when you submit.',
    file_count: 'Up to 3 images please.',
    file_size: 'Each image must be 10 MB or smaller.',
    sending: 'Sending…',
    friend: 'friend',
  };
  Object.entries(messages).forEach(([name, value]) => text('message-' + name, 'Message: ' + name.replace(/_/g, ' '), value, [], { requiredText: true }));
  // Existing description/photo guidance and notices are already in the text-node catalog.
  const helpNames = ['firstName', 'lastName', 'phone', 'email', 'customerType', 'city', 'state', 'hasDeadline', 'deadlineDate', 'service', 'engravingAddon', 'budget', 'contactMethod', 'referral'];
  helpNames.forEach((name) => text('help-' + name, name + ': optional help text', ''));
  options.serviceGroups.forEach((group, index) => text('group-' + groupIds[index], 'Service group heading: ' + group.label, group.label, [], { requiredText: true }));
  const choices = {
    customerType: Object.entries(options.customerTypes).map(([id, label]) => ({ id, label })),
    service: options.serviceGroups.flatMap((group, index) => group.options.map(([id, label]) => ({ id, label, group: groupIds[index] })))
      .concat({ id: 'other', label: 'Other (describe in Order Details)', group: 'none' }),
    budget: [
      { id: 'under-500', label: 'Under $500' }, { id: '500-2000', label: '$500 – $2,000' },
      { id: '2000-5000', label: '$2,000 – $5,000' }, { id: '5000-plus', label: '$5,000+' },
      { id: 'not-sure', label: 'Not sure yet' },
    ],
    referral: ['Google', 'Instagram', 'Pinterest', 'Referral', 'Other'].map((label) => ({ id: label.toLowerCase(), label })),
  };
  selectNames.forEach((name) => text('choices-' + name, name + ': dropdown choices', JSON.stringify(choices[name]), [], {
    kind: 'choices', name, maxLength: 20000,
  }));
  const definition = { label: 'Quote form — labels, help, choices and messages', path: '/contact', schema: 'quote-form-v2-' + catalog.contact.schema, fields, maxFieldLength: 20000 };
  const defaults = () => Object.fromEntries(fields.map((field) => [field.id, field.default]));
  function parseChoices(name, encoded) {
    let rows;
    try { rows = JSON.parse(encoded); } catch { throw new Error(name + ': invalid dropdown choices.'); }
    if (!Array.isArray(rows) || rows.length > 80 || (['service', 'customerType'].includes(name) && !rows.length)) {
      throw new Error(name + ': provide 1–80 choices for required dropdowns, or 0–80 for optional dropdowns.');
    }
    const ids = new Set();
    const labels = new Set();
    return rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.keys(row).some((key) => !['id', 'label', ...(name === 'service' ? ['group'] : [])].includes(key)) ||
          typeof row.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(row.id) ||
          typeof row.label !== 'string' || !row.label.trim() || row.label.length > 160 ||
          /[\u0000-\u001f]/.test(row.label) || ids.has(row.id) || labels.has(row.label.trim().toLowerCase())) {
        throw new Error(name + ': choices need unique stable IDs and unique plain-text labels (1–160 characters).');
      }
      if (name === 'service' && (![...groupIds, 'none'].includes(row.group) || /\bsaunas?\b/i.test(row.id) || /\bsaunas?\b/i.test(row.label))) {
        throw new Error('Unavailable offerings cannot be added to service choices; select a listed service group.');
      }
      ids.add(row.id);
      labels.add(row.label.trim().toLowerCase());
      return { id: row.id, label: row.label.trim(), ...(name === 'service' ? { group: row.group } : {}) };
    });
  }
  function validate(values) {
    fields.forEach((field) => {
      if (field.requiredText && !values[field.id]?.trim()) throw new Error(field.label + ' cannot be empty.');
    });
    selectNames.forEach((name) => parseChoices(name, values['choices-' + name]));
  }
  function apply(values, documentRoot = document) {
    validate(values);
    fields.filter((field) => field.targets.length).forEach((field) => {
      field.targets.forEach((target) => documentRoot.querySelectorAll(target.selector).forEach((element) => {
        if (target.attribute) {
          element.setAttribute(target.attribute, values[field.id]);
          return;
        }
        const node = Array.from(element.childNodes).filter((child) => child.nodeType === 3)[target.text];
        if (node) {
          const before = node.nodeValue.match(/^\s*/)[0];
          const after = node.nodeValue.match(/\s*$/)[0];
          node.nodeValue = before + values[field.id] + after;
        }
      }));
    });
    const form = documentRoot.getElementById('quote-form');
    if (!form) return;
    selectNames.forEach((name) => {
      const select = form.elements[name];
      const selected = select.value;
      select.replaceChildren();
      const prompt = documentRoot.createElement('option');
      prompt.value = '';
      prompt.textContent = values['placeholder-' + name];
      select.append(prompt);
      let previousGroup = null;
      let groupElement = null;
      parseChoices(name, values['choices-' + name]).forEach((row) => {
        const option = documentRoot.createElement('option');
        option.value = row.id;
        option.textContent = row.label;
        if (name !== 'service' || row.group === 'none') {
          select.append(option);
          previousGroup = null;
          return;
        }
        if (previousGroup !== row.group) {
          const group = documentRoot.createElement('optgroup');
          group.label = values['group-' + row.group];
          groupElement = group;
          previousGroup = row.group;
          select.append(group);
        }
        groupElement.append(option);
      });
      if (Array.from(select.options).some((option) => option.value === selected)) select.value = selected;
    });
    helpNames.forEach((name) => {
      const controls = form.querySelectorAll('[name="' + name + '"]');
      const id = 'quote-help-' + name;
      let help = documentRoot.getElementById(id);
      if (!help) {
        help = documentRoot.createElement('p');
        help.id = id;
        help.className = 'quote-helper';
        const control = controls[0];
        const container = control.closest('.form-field, fieldset') || control.parentElement;
        container.append(help);
      }
      help.textContent = values['help-' + name];
      help.hidden = !help.textContent;
      controls.forEach((control) => {
        const ids = new Set((control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        ids.add(id);
        control.setAttribute('aria-describedby', Array.from(ids).join(' '));
      });
    });
    form.querySelector('button[type="submit"]').textContent = values.submit;
  }
  const api = { scope, definition, defaults, validate, parseChoices, apply, selectNames, groupIds };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Studio37QuoteForm = api;
})(globalThis);
