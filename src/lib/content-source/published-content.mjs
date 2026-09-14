import { CONTENT_LOCALES, SOURCE_LOCALE } from '../content-schema/schema.mjs';
import { assertSupportedLocale, publicPathFor } from '../content-schema/multilingual-contract.mjs';
import { deriveTranslationState, selectPublishedLocale } from '../content-schema/state.mjs';
import { getContentRecord, getLocaleDocument, listContentRecords } from './multilingual-store.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function publishedEntry(record, locale) {
  const document = record.locales[locale];
  const published = selectPublishedLocale(document);
  if (!published) return null;

  // Future public consumers must use this projection rather than raw Stage 12C
  // locale documents, which intentionally retain editorial drafts.
  return deepFreeze({
    content_id: record.content_id,
    locale,
    slug: published.slug,
    path: publicPathFor(locale, published.slug),
    published: structuredClone(published),
    freshness: locale === SOURCE_LOCALE ? null : deriveTranslationState(document, record.item).state,
  });
}

// Selects published snapshots only. Store scanning and structural validation stay
// owned by Stage 12C; this module deliberately does not perform public routing.
export function getPublishedLocaleEntry(repository, contentId, locale) {
  const document = getLocaleDocument(repository, contentId, locale);
  if (!document) return null;
  const record = getContentRecord(repository, contentId);
  return publishedEntry(record, locale);
}

export function listPublishedLocaleEntries(repository, locale) {
  assertSupportedLocale(locale);
  return Object.freeze(listContentRecords(repository)
    .map((record) => record.locales[locale] ? publishedEntry(record, locale) : null)
    .filter(Boolean));
}

export function listPublishedLocalesForContent(repository, contentId) {
  const record = getContentRecord(repository, contentId);
  if (!record) return Object.freeze([]);
  return Object.freeze(CONTENT_LOCALES.filter((locale) => (
    record.locales[locale] && publishedEntry(record, locale) !== null
  )));
}
