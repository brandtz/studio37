import quoteForm from '../../../assets/js/quote-form-schema.js';
import { createContentRepository } from './content.mjs';

// Published-only reader. Missing quote publication inherits existing published
// contact labels, then code defaults; storage failures are not absence.
export function createQuoteFormReader(repository = createContentRepository()) {
  return async function readQuoteForm() {
    const current = await repository.getPublished(quoteForm.scope);
    // Distinguishes the inherited published presentation from code defaults.
    return current.inheritedRevision ? { ...current, revision: 'contact-' + current.inheritedRevision } : current;
  };
}

export const readQuoteForm = createQuoteFormReader();

export function quoteChoiceMaps(record) {
  return Object.fromEntries(quoteForm.selectNames.map((name) => [
    name, new Map(quoteForm.parseChoices(name, record.values['choices-' + name]).map((row) => [row.id, row.label])),
  ]));
}
