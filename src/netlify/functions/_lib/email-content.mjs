import schema from '../../../assets/js/email-template-schema.js';
import { createScopedContentRepository, createAdminContentHandler, ContentError, validateValues } from './content.mjs';

const defaultSubjects = {
  'email.quote-notification': 'New Studio 37 quote request — {{service}} — {{customerName}}',
  'email.quote-acknowledgement': 'We got your request — Studio 37 Custom Designs',
  'email.order-notification': '{{title}} — #{{orderNumber}}',
  'email.order-confirmation': 'Thanks for your order — Studio 37 #{{orderNumber}}',
};
const defaultBodies = {
  'email.quote-notification': 'Reply to this email to respond to {{customerEmail}} directly, or view the full lead in the admin dashboard.',
  'email.quote-acknowledgement': [
    'Hi {{firstName}},',
    'Thanks for reaching out about {{service}}. Your request is in front of Drew now — expect an initial response in approximately 3–5 business days with next steps, follow-up questions, or a quote.',
    'If your project is time-sensitive, feel free to call or text Drew directly at (541) 514-7720.',
  ].join('\n\n'),
  'email.order-notification': '',
  'email.order-confirmation': [
    'Hi {{firstName}},',
    'Thanks for your order from Studio 37 Custom Designs. Drew has been notified and your order is in the queue.',
    "What's next:",
    'In-stock goods ship in 3–7 business days. Custom pieces follow the timeline we discussed — Drew will reach out with an update as your piece progresses.',
    'Questions? Reply to this email or call Drew at (541) 514-7720.',
  ].join('\n\n'),
};
export const emailRegistry = Object.fromEntries(Object.entries(schema.registry).map(([scope, definition]) => [scope, {
  ...definition, fields: definition.fields.map((field) => ({ ...field, default: field.id === 'subject' ? defaultSubjects[scope] : defaultBodies[scope] })),
}]));
export const emailRepository = createScopedContentRepository({ registry: emailRegistry });
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function validateEmailHeaders(message) {
  for (const value of [message.subject, ...Object.values(message.headers || {})]) {
    if (typeof value !== 'string' || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value) || value.length > 998) {
      throw new Error('Invalid email header.');
    }
  }
}

export function renderEmailCopy(scope, values, variables) {
  schema.validate(scope, values);
  const replace = (text, header) => text.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, name) => {
    const value = String(variables[name] ?? '');
    return header ? (value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, 160) || 'Not provided') : value;
  });
  const subject = replace(values.subject, true);
  validateEmailHeaders({ subject });
  const body = replace(values.body, false);
  return { subject, text: body, html: escapeHtml(body).replace(/\r?\n/g, '<br>') };
}

export function applyEmailCopy(message, scope, current, variables) {
  const copy = renderEmailCopy(scope, current.values, variables);
  if (!message.html.includes('<!--studio37-email-narrative-->') || !message.text.includes('[[studio37-email-narrative]]')) {
    throw new Error('Missing protected email narrative slot.');
  }
  return {
    ...message, subject: copy.subject,
    html: message.html.replace('<!--studio37-email-narrative-->', () => `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;">${copy.html}</div>`),
    text: message.text.replace('[[studio37-email-narrative]]', () => copy.text),
  };
}

export function defaultEmailCopy(scope) {
  return {
    revision: null, schema: emailRegistry[scope].schema,
    values: Object.fromEntries(emailRegistry[scope].fields.map((field) => [field.id, field.default])),
  };
}

export async function readEmailCopy(scope, repository = emailRepository) {
  try {
    return await repository.getPublished(scope);
  } catch {
    console.error(`[email-cms] published read failed for ${scope}; using built-in copy`);
    return { ...defaultEmailCopy(scope), fallback: true };
  }
}

const samples = {
  firstName: 'Alex', customerName: 'Alex Example', customerEmail: 'alex@example.test', service: 'Cutting Board',
  orderNumber: 'EXAMPLE', total: '$25.00', title: 'New Studio 37 order',
};

export function createAdminEmailContentHandler({ requireSession, repository = emailRepository }) {
  const contentHandler = createAdminContentHandler({ requireSession, repository });
  return async (req) => {
    if (req.method !== 'POST') return contentHandler(req);
    const url = new URL(req.url);
    if (url.searchParams.get('preview') !== '1') return contentHandler(req);
    const response = (body, status = 200) => Response.json(body, {
      status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    try {
      const auth = await requireSession(req);
      if (auth.error) return auth.error;
      if (!auth.user || !['admin', 'super'].includes(auth.user.role)) return response({ error: 'forbidden' }, 403);
      const scope = url.searchParams.get('page');
      repository.definition(scope);
      if (!/^application\/json(?:;|$)/i.test(req.headers.get('content-type') || '')) return response({ error: 'JSON required.' }, 415);
      // Bound preview input as well as normal CMS write input.
      const reader = req.body?.getReader();
      if (!reader) return response({ error: 'Request body required.' }, 400);
      let text = '', bytes = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 20000) { await reader.cancel(); return response({ error: 'Preview too large.' }, 413); }
        text += decoder.decode(value, { stream: true });
      }
      let data;
      try { data = JSON.parse(text + decoder.decode()); } catch { return response({ error: 'Invalid JSON.' }, 400); }
      const values = validateValues(scope, data.values, data.schema, emailRegistry);
      const copy = renderEmailCopy(scope, values, samples);
      return response({ ...copy, note: 'Synthetic data only. Protected transaction details and secure links are included at send time; no message was sent.' });
    } catch (error) {
      if (error instanceof ContentError) return response({ error: error.message }, error.status);
      console.error('[email-cms] private preview failed');
      return response({ error: 'Email preview unavailable.' }, 503);
    }
  };
}
