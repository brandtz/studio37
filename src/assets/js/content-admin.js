/* Private draft editor; preview never runs page scripts or puts drafts in public URLs. */
(() => {
  const quoteForm = window.Studio37QuoteForm;
  const emailTemplates = window.Studio37EmailTemplates.registry;
  const seoSchema = window.Studio37SeoSchema;
  const schema = { ...window.Studio37ContentSchema, ...seoSchema, [quoteForm.scope]: quoteForm.definition, ...emailTemplates };
  const $ = (id) => document.getElementById(id);
  let helpers;
  let page = 'home';
  let state;
  let values = {};
  let dirty = false;
  let busy = false;
  let loaded = false;
  let previewSequence = 0;
  let editorBase = null;
  let savedDraft = null;
  let reviewedBase = null;

  const path = (extra = '') => '/.netlify/functions/' + (emailTemplates[page] ? 'admin-email-content' : 'admin-content') + '?page=' + encodeURIComponent(page) + extra;
  const message = (text) => { $('content-status').textContent = text; };
  function setDirty(value) {
    dirty = value;
    if (value) helpers?.markDirty('content');
    else helpers?.markClean('content');
    updatePublish();
  }
  function updatePublish() {
    $('content-publish').disabled = busy || !loaded || dirty || !savedDraft || !editorBase || !state?.canPublish;
    $('content-publish').title = dirty ? 'Save current text as a private draft before publishing.' :
      !savedDraft ? 'Load or save a private draft first.' : !editorBase ? 'Review the current published base first.' : '';
  }
  function clearComparison() {
    reviewedBase = null;
    $('content-comparison').hidden = true;
    $('content-differences').replaceChildren();
  }
  function leaveOkay() {
    return !dirty || window.confirm('Discard the current unsaved content changes? Saved draft history will remain.');
  }
  function setBusy(value) {
    busy = value;
    ['content-save', 'content-preview', 'content-reload', 'content-page', 'content-rebase', 'content-use-base'].forEach((id) => { $(id).disabled = value; });
    $('content-fields').querySelectorAll('textarea, input, select, button').forEach((input) => { input.disabled = value || input.dataset.minimum === 'true'; });
    $('content-history').querySelectorAll('button').forEach((button) => { button.disabled = value || button.dataset.oldSchema === 'true'; });
    $('content-publications').querySelectorAll('button').forEach((button) => { button.disabled = value || button.dataset.oldSchema === 'true'; });
    $('content-save').disabled = value || !loaded || !editorBase;
    $('content-preview').disabled = value || !loaded;
    $('content-rebase').disabled = value || !loaded;
    $('content-use-base').disabled = value || !reviewedBase;
    updatePublish();
  }
  function renderFields() {
    $('content-fields').replaceChildren();
    if (emailTemplates[page]) {
      const note = document.createElement('p');
      note.textContent = 'Plain-text email copy only. Allowed variables: ' + emailTemplates[page].variables.map((name) => '{{' + name + '}}').join(', ') +
        '. Body copy replaces the existing narrative, including response/shipping language. Transaction details, secure links, recipients, sender, reply-to, secrets and headers remain protected.';
      $('content-fields').append(note);
    }
    if (page === 'contact' || page === quoteForm.scope) {
      const note = document.createElement('p');
      note.textContent = 'Quote form labels, guidance, messages and dropdown choices are edited together in the Quote form scope. Fields, requiredness and radio values cannot be changed. New choices get permanent IDs; removing a choice never changes old leads.';
      $('content-fields').append(note);
    }
    for (const field of schema[page].fields) {
      if (page === 'contact' && field.targets.some((target) => target.selector.includes(' > form:'))) continue;
      if (field.kind === 'choices') { renderChoices(field); continue; }
      const container = document.createElement('div');
      container.className = 'form-field';
      const label = document.createElement('label');
      label.className = 'form-label';
      label.htmlFor = 'cms-' + field.id;
      label.textContent = field.label;
      const input = document.createElement('textarea');
      input.id = label.htmlFor;
      input.className = 'form-textarea';
      input.rows = values[field.id]?.length > 150 ? 4 : 2;
      input.maxLength = field.maxLength || 4000;
      input.value = values[field.id] ?? field.default;
      input.addEventListener('input', () => {
        values[field.id] = input.value;
        setDirty(true);
        clearComparison();
        hidePreview();
        message('Unsaved changes — save a private draft to keep this revision.');
      });
      container.append(label, input);
      $('content-fields').append(container);
    }
  }
  function changed() {
    setDirty(true);
    clearComparison();
    hidePreview();
    message('Unsaved changes — save a private draft to keep this revision.');
  }
  function renderChoices(field) {
    const container = document.createElement('fieldset');
    container.className = 'quote-fieldset';
    const legend = document.createElement('legend');
    legend.textContent = field.label;
    container.append(legend);
    const instructions = document.createElement('p');
    instructions.textContent = 'Edit labels, reorder, add or remove choices. IDs are permanent and not editable. A new choice means a new ID; do not repurpose old choices.';
    container.append(instructions);
    const rows = quoteForm.parseChoices(field.name, values[field.id]);
    const list = document.createElement('div');
    const sync = () => { values[field.id] = JSON.stringify(rows); changed(); };
    function draw() {
      list.replaceChildren();
      add.dataset.minimum = String(rows.length >= 80);
      add.disabled = rows.length >= 80;
      rows.forEach((row, index) => {
        const box = document.createElement('div');
        box.className = 'form-field';
        const label = document.createElement('label');
        label.htmlFor = 'cms-' + field.id + '-' + row.id;
        label.textContent = 'Choice ' + (index + 1) + ' label';
        const input = document.createElement('input');
        input.id = label.htmlFor;
        input.className = 'form-input';
        input.value = row.label;
        input.required = true;
        input.maxLength = 160;
        const id = document.createElement('small');
        id.id = input.id + '-id';
        id.textContent = 'Permanent option ID: ' + row.id;
        input.setAttribute('aria-describedby', id.id);
        input.addEventListener('input', () => { row.label = input.value; sync(); });
        box.append(label, input, id);
        if (field.name === 'service') {
          const groupLabel = document.createElement('label');
          groupLabel.htmlFor = input.id + '-group';
          groupLabel.textContent = 'Service group (Home goods enables the existing engraving add-on)';
          const select = document.createElement('select');
          select.id = groupLabel.htmlFor;
          select.className = 'form-select';
          [...quoteForm.groupIds, 'none'].forEach((group) => {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group === 'none' ? 'No group' : values['group-' + group];
            select.append(option);
          });
          select.value = row.group;
          select.addEventListener('change', () => { row.group = select.value; sync(); });
          box.append(groupLabel, select);
        }
        [['Move up', -1], ['Move down', 1], ['Remove choice', 0]].forEach(([text, delta]) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn-admin-ghost';
          button.textContent = text;
          button.setAttribute('aria-label', text + ': choice ' + (index + 1) + ' in ' + field.name);
          const minimum = delta === 0 ? rows.length === 1 && ['service', 'customerType'].includes(field.name) :
            index + delta < 0 || index + delta >= rows.length;
          button.dataset.minimum = String(minimum);
          button.disabled = minimum;
          button.addEventListener('click', () => {
            if (busy) return;
            if (delta === 0) {
              if (!window.confirm('Remove this choice from future quotes? Historical leads and IDs remain unchanged.')) return;
              rows.splice(index, 1);
            } else [rows[index], rows[index + delta]] = [rows[index + delta], rows[index]];
            sync();
            draw();
            (list.querySelector('input') || add).focus();
          });
          box.append(button);
        });
        list.append(box);
      });
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-admin-ghost';
    add.textContent = 'Add ' + field.name + ' choice';
    add.addEventListener('click', () => {
      if (busy || rows.length >= 80) return;
      rows.push({ id: 'opt-' + crypto.randomUUID().replace(/-/g, ''), label: 'New choice', ...(field.name === 'service' ? { group: 'custom-orders' } : {}) });
      sync();
      draw();
      list.querySelectorAll('input')[rows.length - 1].focus();
    });
    draw();
    container.append(list, add);
    $('content-fields').append(container);
  }
  function hidePreview() {
    previewSequence++;
    const frame = $('content-preview-frame');
    frame.hidden = true;
    frame.removeAttribute('srcdoc');
  }
  async function loadPage(revision = null) {
    if (busy) return;
    setBusy(true);
    hidePreview();
    clearComparison();
    message('Loading content…');
    try {
      state = await helpers.api(path());
      if (state.schema !== schema[page].schema) throw new Error('Page schema changed. Reload this dashboard.');
      values = { ...state.current.values };
      editorBase = { revision: state.current.revision, etag: state.current.etag };
      savedDraft = null;
      if (revision) {
        const record = await helpers.api(path('&revision=' + encodeURIComponent(revision)));
        if (record.schema !== state.schema) throw new Error('This revision uses an older page template and cannot be loaded.');
        values = { ...record.values };
        editorBase = record.base || null;
        savedDraft = record;
      }
      setDirty(false);
      renderFields();
      renderHistory();
      renderPublications();
      $('content-publish-blocker').textContent = 'Publishing replaces this scope only, using the saved draft’s original published revision and strong ETag. Conflicts preserve your draft; review differences before rebasing.';
      message(revision ? 'Editing private draft ' + revision.slice(0, 8) + '. Public content has not changed.' +
        (!editorBase ? ' This legacy draft needs a reviewed publication base before saving or publishing.' : '') :
        state.current.revision ? 'Editing a copy of published text.' : 'Editing original site text. Nothing is published by the CMS.');
      loaded = true;
    } catch (error) {
      message(error.message || 'Could not load content.');
      loaded = false;
      $('content-fields').replaceChildren();
      $('content-history').replaceChildren();
      $('content-publications').replaceChildren();
    } finally {
      setBusy(false);
      $('content-save').disabled = !loaded || !editorBase;
      $('content-preview').disabled = !loaded;
      $('content-rebase').disabled = !loaded;
      updatePublish();
    }
  }
  function renderPublications() {
    const list = $('content-publications');
    list.replaceChildren();
    if (!state.publications.length) { list.textContent = 'No committed publications yet.'; return; }
    state.publications.forEach((record) => {
      const row = document.createElement('div');
      const description = document.createElement('p');
      description.textContent = (record.at || 'Legacy publication') + ' · ' + (record.actor || 'Unknown actor') + ' · ' + record.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-admin-ghost';
      button.textContent = 'Restore publication as private draft';
      button.dataset.oldSchema = String(record.schema !== state.schema);
      button.disabled = record.schema !== state.schema;
      button.addEventListener('click', async () => {
        if (busy || !leaveOkay()) return;
        setBusy(true);
        try {
          const restored = await helpers.api(path(), {
            method: 'POST', body: JSON.stringify({ action: 'restorePublication', revision: record.id }),
          });
          setBusy(false);
          await loadPage(restored.id);
        } catch (error) { setBusy(false); message(error.message || 'Restore failed.'); }
      });
      row.append(description, button);
      list.append(row);
    });
  }
  function renderHistory() {
    const list = $('content-history');
    list.replaceChildren();
    if (!state.history.length) {
      list.textContent = 'No saved drafts yet.';
      return;
    }
    state.history.forEach((record) => {
      const row = document.createElement('div');
      row.style.marginBottom = '1rem';
      const description = document.createElement('p');
      description.textContent = record.at + ' · ' + record.actor + ' · ' + record.id.slice(0, 8) +
        (record.restoredFrom ? ' · restored from ' + record.restoredFrom.slice(0, 8) : '');
      row.append(description);
      [['Load draft', false], ['Restore as new draft', true]].forEach(([label, restore]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-admin-ghost';
        button.textContent = record.schema === state.schema ? label : label + ' (old template)';
        button.dataset.oldSchema = String(record.schema !== state.schema);
        button.disabled = record.schema !== state.schema;
        button.addEventListener('click', async () => {
          if (busy || !leaveOkay()) return;
          if (!restore) { await loadPage(record.id); return; }
          setBusy(true);
          try {
            const saved = await helpers.api(path(), {
              method: 'POST', body: JSON.stringify({ action: 'restore', revision: record.id }),
            });
            setBusy(false);
            await loadPage(saved.id);
          } catch (error) {
            setBusy(false);
            message(error.message || 'Restore failed; no change is confirmed.');
          }
        });
        row.append(button);
      });
      list.append(row);
    });
  }

  async function preview() {
    if (!loaded || busy) return;
    const sequence = ++previewSequence;
    const previewPage = page === 'shared' ? 'home' : page === quoteForm.scope ? 'contact' : page;
    setBusy(true);
    message('Building private, non-interactive preview…');
    try {
      if (page === 'cart' || page === 'dynamic-copy' || seoSchema[page]) {
        const snapshot = document.implementation.createHTMLDocument('Private text preview');
        const heading = snapshot.createElement('h2');
        heading.textContent = schema[page].label;
        const note = snapshot.createElement('p');
        note.textContent = 'Text preview only; page structure and behavior remain protected. Nothing has been published.';
        snapshot.body.append(heading, note);
        for (const field of schema[page].fields) {
          const label = snapshot.createElement('strong');
          const text = snapshot.createElement('p');
          label.textContent = field.label;
          text.textContent = values[field.id];
          snapshot.body.append(label, text);
        }
        const frame = $('content-preview-frame');
        frame.srcdoc = '<!doctype html>\n' + snapshot.documentElement.outerHTML;
        frame.hidden = false;
        message('Private text preview; nothing has been published.');
        return;
      }
      if (emailTemplates[page]) {
        const copy = await helpers.api(path('&preview=1'), {
          method: 'POST', body: JSON.stringify({ schema: state.schema, values }),
        });
        if (sequence !== previewSequence) return;
        const snapshot = document.implementation.createHTMLDocument('Private email copy preview');
        const policy = snapshot.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; style-src 'unsafe-inline'";
        snapshot.head.append(policy);
        const heading = snapshot.createElement('h2');
        heading.textContent = copy.subject;
        const body = snapshot.createElement('pre');
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = copy.text;
        const note = snapshot.createElement('p');
        note.textContent = copy.note;
        snapshot.body.append(heading, body, note);
        const frame = $('content-preview-frame');
        frame.srcdoc = '<!doctype html>\n' + snapshot.documentElement.outerHTML;
        frame.hidden = false;
        message('Private email copy preview with synthetic data; nothing sent or published.');
        return;
      }
      const [pageResponse, chromeResponse] = await Promise.all([
        fetch(schema[previewPage].path, { cache: 'no-store' }),
        fetch('/assets/js/site.js', { cache: 'no-store' }),
      ]);
      if (!pageResponse.ok || !chromeResponse.ok) throw new Error('Preview template unavailable.');
      const snapshot = new DOMParser().parseFromString(await pageResponse.text(), 'text/html');
      const chromeSource = await chromeResponse.text();
      [['header.nav', 'NAV_HTML'], ['.nav-mobile-overlay', 'MOBILE_NAV_HTML'], ['footer.footer', 'FOOTER_HTML']].forEach(([selector, name]) => {
        const template = chromeSource.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'));
        const mount = snapshot.querySelector(selector);
        if (mount && template) mount.innerHTML = template[1]; // Trusted local template; never CMS text.
      });
      const year = snapshot.getElementById('footer-year');
      if (year) year.textContent = String(new Date().getFullYear());
      snapshot.querySelectorAll('script, base, iframe, object, embed, meta[http-equiv], link[rel="canonical"]').forEach((node) => node.remove());
      const base = snapshot.createElement('base');
      base.href = location.origin + '/';
      snapshot.head.prepend(base);
      const noindex = snapshot.createElement('meta');
      noindex.name = 'robots';
      noindex.content = 'noindex,nofollow';
      snapshot.head.append(noindex);
      snapshot.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).filter((attr) => attr.name.startsWith('on')).forEach((attr) => node.removeAttribute(attr.name));
      });
      snapshot.querySelectorAll('a, form').forEach((node) => {
        node.removeAttribute('href');
        node.removeAttribute('action');
        node.removeAttribute('target');
      });
      snapshot.querySelectorAll('input, select, textarea, button').forEach((node) => { node.disabled = true; });
      snapshot.querySelectorAll('.reveal').forEach((node) => node.classList.add('visible'));
      const publicScopes = await helpers.api('/.netlify/functions/public-content?page=' + encodeURIComponent(previewPage));
      window.Studio37Content.apply('shared', publicScopes.shared, snapshot);
      window.Studio37Content.apply(previewPage, publicScopes[previewPage], snapshot);
      window.Studio37Content.apply(page, values, snapshot);
      if (previewPage === 'contact') {
        const currentQuote = await helpers.api('/.netlify/functions/quote-form-content');
        quoteForm.apply(page === quoteForm.scope ? values : currentQuote.values, snapshot);
      }
      if (sequence !== previewSequence) return;
      const frame = $('content-preview-frame');
      frame.srcdoc = '<!doctype html>\n' + snapshot.documentElement.outerHTML;
      frame.hidden = false;
      message('Private preview of current text. Scripts and submission actions are disabled; nothing has been published.');
    } catch (error) {
      message(error.message || 'Could not build preview.');
    } finally { setBusy(false); }
  }

  Object.entries(schema).forEach(([key, definition]) => {
    if (key === 'saunas') return;
    const option = document.createElement('option');
    option.value = key;
    option.textContent = definition.label + ' (' + definition.fields.length + ' fields)';
    $('content-page').append(option);
  });
  $('content-page').value = page;
  $('content-page').addEventListener('change', async () => {
    if (!leaveOkay()) { $('content-page').value = page; return; }
    page = $('content-page').value;
    setDirty(false);
    await loadPage();
  });
  $('content-reload').addEventListener('click', async () => {
    if (leaveOkay()) await loadPage();
  });
  $('content-preview').addEventListener('click', preview);
  $('content-rebase').addEventListener('click', async () => {
    if (busy || !loaded) return;
    setBusy(true);
    clearComparison();
    try {
      const fresh = await helpers.api(path());
      if (fresh.schema !== state.schema) throw new Error('The template changed. Reload before rebasing.');
      reviewedBase = { revision: fresh.current.revision, etag: fresh.current.etag };
      let count = 0;
      schema[page].fields.forEach((field) => {
        if (fresh.current.values[field.id] === values[field.id]) return;
        count++;
        const label = document.createElement('h4');
        label.textContent = field.label;
        const difference = document.createElement('pre');
        difference.style.whiteSpace = 'pre-wrap';
        difference.textContent = 'Published:\n' + fresh.current.values[field.id] + '\n\nYour editor:\n' + values[field.id];
        $('content-differences').append(label, difference);
      });
      if (!count) $('content-differences').textContent = 'No text differences. The publication revision may still have changed.';
      $('content-comparison').hidden = false;
      message('Review the comparison, then explicitly accept this base and save a new private draft.');
    } catch (error) { message(error.message || 'Could not read current published text.'); }
    finally { setBusy(false); }
  });
  $('content-use-base').addEventListener('click', () => {
    if (busy || !reviewedBase || !window.confirm('Use this reviewed publication as the base? Your editor text will replace it only after saving and explicitly publishing a new draft.')) return;
    editorBase = reviewedBase;
    savedDraft = null;
    clearComparison();
    setDirty(true);
    $('content-save').disabled = false;
    message('Reviewed base accepted. Save a new private draft; another publication can still cause a conflict.');
  });
  $('content-publish').addEventListener('click', async () => {
    if (busy || dirty || !savedDraft || !editorBase ||
        !window.confirm('Publish this saved draft for ' + schema[page].label + '? This replaces the visible text for this scope.')) return;
    setBusy(true);
    try {
      const result = await helpers.api(path(), {
        method: 'POST', body: JSON.stringify({ action: 'publish', revision: savedDraft.id, base: editorBase }),
      });
      setBusy(false);
      await loadPage();
      message('Published revision ' + result.revision + '. The committed history is retained.');
    } catch (error) {
      message((error.message || 'Publication not confirmed.') + ' No automatic retry or rebase was performed. Your saved draft remains available.');
      setBusy(false);
    }
  });
  $('content-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !loaded || !editorBase) return;
    setBusy(true);
    try {
      const saved = await helpers.api(path(), {
        method: 'POST', body: JSON.stringify({ action: 'save', schema: state.schema, values, base: editorBase }),
      });
      setDirty(false);
      setBusy(false);
      await loadPage(saved.id);
    } catch (error) {
      message(error.message || 'Draft save failed; no change is confirmed.');
      setBusy(false);
    }
  });
  window.Studio37ContentAdmin = {
    hasUnsaved: () => dirty,
    load: async (providedHelpers) => {
      helpers = providedHelpers;
      if (!loaded && !busy) await loadPage();
    },
  };
})();
