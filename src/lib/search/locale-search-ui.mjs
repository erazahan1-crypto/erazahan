import { SOURCE_LOCALE } from '../content-schema/schema.mjs';
import { assertSupportedLocale, publicPathFor } from '../content-schema/multilingual-contract.mjs';

// These are UI routes, not a second locale authority. Locale validation is
// always delegated to the multilingual content contract.
const SEARCH_UI_BY_LOCALE = Object.freeze({
  hy: Object.freeze({ indexPath: '/search-index.json', searchPagePath: '/search/' }),
  ru: Object.freeze({ indexPath: '/ru/search-index.json', searchPagePath: '/ru/search/' }),
  en: Object.freeze({ indexPath: '/en/search-index.json', searchPagePath: '/en/search/' }),
});

export function localeSearchUi(locale) {
  assertSupportedLocale(locale);
  return SEARCH_UI_BY_LOCALE[locale];
}

export function searchResultHref(locale, entry) {
  assertSupportedLocale(locale);
  if (!entry || typeof entry !== 'object') throw new TypeError('search entry must be an object');
  return publicPathFor(locale, entry.slug);
}

export const HY_SEARCH_LOCALE = SOURCE_LOCALE;
