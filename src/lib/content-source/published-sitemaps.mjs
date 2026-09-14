import { assertSupportedLocale } from '../content-schema/multilingual-contract.mjs';
import { listPublishedLocaleEntries } from './published-content.mjs';

// Sitemap routes will serialize these intentionally small published snapshots.
// Sorting by canonical public path keeps future locale XML deterministic.
export function listPublishedDreamSitemapEntries(repository, locale) {
  assertSupportedLocale(locale);
  return Object.freeze(listPublishedLocaleEntries(repository, locale)
    .map(({ content_id, locale: entryLocale, path }) => Object.freeze({ content_id, locale: entryLocale, path }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en')));
}

// Kept beside the projection so a future XML route does not interpolate URLs
// unsafely. It intentionally has no route or timestamp policy.
export function escapeSitemapXmlText(value) {
  if (typeof value !== 'string') throw new TypeError('Sitemap XML text must be a string');
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}
