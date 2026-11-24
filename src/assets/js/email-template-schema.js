(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Studio37EmailTemplates = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const specifications = [
    ['quote-notification', 'Quote notification', ['service', 'customerName', 'firstName', 'customerEmail']],
    ['quote-acknowledgement', 'Quote acknowledgement', ['service', 'customerName', 'firstName']],
    ['order-notification', 'Order notification', ['title', 'orderNumber', 'customerName', 'firstName', 'total']],
    ['order-confirmation', 'Order confirmation', ['orderNumber', 'customerName', 'firstName', 'total']],
  ];
  function validate(scope, values) {
    const definition = registry[scope];
    if (!definition || !values || Object.keys(values).length !== 2 ||
        !Object.hasOwn(values, 'subject') || !Object.hasOwn(values, 'body')) throw new Error('Only subject and body may be edited.');
    if (typeof values.subject !== 'string' || !values.subject.trim() || values.subject.length > 300 ||
        /[\u0000-\u001f\u007f\u2028\u2029]/.test(values.subject)) throw new Error('Subject must be nonempty, at most 300 characters, and contain no header controls or newlines.');
    if (values.subject.replace(/\{\{[A-Za-z][A-Za-z0-9]*\}\}/g, 'x'.repeat(160)).length > 998) {
      throw new Error('Subject has too many variable expansions for the email header limit.');
    }
    if (typeof values.body !== 'string' || values.body.length > 4000 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(values.body)) throw new Error('Body must be plain text within 4,000 characters without control characters.');
    for (const text of [values.subject, values.body]) {
      const remaining = text.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, name) => {
        if (!definition.variables.includes(name)) throw new Error('Unknown email variable: ' + name);
        return '';
      });
      if (remaining.includes('{{') || remaining.includes('}}')) throw new Error('Use exact {{variable}} placeholders; expressions are not supported.');
    }
  }
  const registry = Object.fromEntries(specifications.map(([id, label, variables]) => {
    const scope = 'email.' + id;
    return [scope, {
      label, schema: 'email-copy-v2', variables,
      fields: [
        { id: 'subject', label: 'Subject', maxLength: 300 },
        { id: 'body', label: 'Message body (replaces narrative; transaction details and secure links stay protected)', maxLength: 4000 },
      ],
      validate: (values) => validate(scope, values),
    }];
  }));
  return { registry, validate };
});
