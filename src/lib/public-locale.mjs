import { CONTENT_LOCALES } from './content-schema/schema.mjs';
import { assertSupportedLocale, publicPathFor } from './content-schema/multilingual-contract.mjs';
import { getPublishedLocaleEntry, listPublishedLocalesForContent } from './content-source/published-content.mjs';
import { localeSeoMetadata } from './content-source/published-seo.mjs';
import { localeSearchUi } from './search/locale-search-ui.mjs';

// This is the public-site locale facade. Content-schema validation remains the
// single authority for supported locales and public dream slugs.
export const PUBLIC_LOCALES = CONTENT_LOCALES;

const PUBLIC_LOCALE_METADATA = Object.freeze({
  hy: Object.freeze({ code: 'hy', root_path: '/', ...localeSeoMetadata('hy') }),
  ru: Object.freeze({ code: 'ru', root_path: '/ru/', ...localeSeoMetadata('ru') }),
  en: Object.freeze({ code: 'en', root_path: '/en/', ...localeSeoMetadata('en') }),
});

// Core shell copy only. Pages do not consume this yet; later shared components
// can do so without becoming a second locale or routing authority.
const PUBLIC_UI_COPY = Object.freeze({
  hy: Object.freeze({
    navigation: Object.freeze({ home: '\u0533\u056c\u056d\u0561\u057e\u0578\u0580', search: '\u0548\u0580\u0578\u0576\u0578\u0582\u0574', alphabet: '\u0531\u0575\u0562\u0578\u0582\u0562\u0565\u0576' }),
    breadcrumbs: Object.freeze({ home: '\u0533\u056c\u056d\u0561\u057e\u0578\u0580' }),
    search: Object.freeze({ heading: '\u0548\u0580\u0578\u0576\u0578\u0582\u0574', placeholder: '\u0553\u0576\u057f\u0580\u0565\u056c \u0565\u0580\u0561\u0566\u2026', empty_query: '\u0544\u0578\u0582\u057f\u0584\u0561\u0563\u0580\u0565\u0584 \u0578\u0580\u0578\u0576\u0574\u0561\u0576 \u0562\u0561\u057c\u0568:', no_results: '\u0548\u0579\u056b\u0576\u0579 \u0579\u056b \u0563\u057f\u0576\u057e\u0565\u056c:' }),
    related: Object.freeze({ heading: '\u0546\u0574\u0561\u0576\u0561\u057f\u056b\u057a \u0565\u0580\u0561\u0566\u0576\u0565\u0580' }),
    language: Object.freeze({ label: '\u053c\u0565\u0566\u0578\u0582' }),
    empty: Object.freeze({ unavailable: '\u0531\u0575\u057d \u056c\u0565\u0566\u057e\u0578\u057e \u0564\u0565\u057c \u0570\u0561\u057d\u0561\u0576\u0565\u056c\u056b \u0579\u0567\u0589' }),
  }),
  ru: Object.freeze({
    navigation: Object.freeze({ home: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f', search: '\u041f\u043e\u0438\u0441\u043a', alphabet: '\u0410\u043b\u0444\u0430\u0432\u0438\u0442' }),
    breadcrumbs: Object.freeze({ home: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f' }),
    search: Object.freeze({ heading: '\u041f\u043e\u0438\u0441\u043a', placeholder: '\u041f\u043e\u0438\u0441\u043a \u0441\u043d\u043e\u0432\u2026', empty_query: '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u043e\u0438\u0441\u043a\u043e\u0432\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441.', no_results: '\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e.' }),
    related: Object.freeze({ heading: '\u041f\u043e\u0445\u043e\u0436\u0438\u0435 \u0441\u043d\u044b' }),
    language: Object.freeze({ label: '\u042f\u0437\u044b\u043a' }),
    empty: Object.freeze({ unavailable: '\u041d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e.' }),
  }),
  en: Object.freeze({
    navigation: Object.freeze({ home: 'Home', search: 'Search', alphabet: 'Alphabet' }),
    breadcrumbs: Object.freeze({ home: 'Home' }),
    search: Object.freeze({ heading: 'Search', placeholder: 'Search dreams\u2026', empty_query: 'Enter a search query.', no_results: 'No results found.' }),
    related: Object.freeze({ heading: 'Related dreams' }),
    language: Object.freeze({ label: 'Language' }),
    empty: Object.freeze({ unavailable: 'Not available in this language yet.' }),
  }),
});

const NAVIGATION_ITEMS = Object.freeze([
  Object.freeze({ id: 'home', locales: Object.freeze(['hy']), href: localeHome }),
  Object.freeze({ id: 'search', locales: PUBLIC_LOCALES, href: localeSearch }),
  // The localized letter pages have no index-root page yet. Do not fabricate
  // one or fall back to this HY legacy index for RU/EN.
  Object.freeze({ id: 'alphabet', locales: Object.freeze(['hy']), href: localeAlphabet }),
]);

export function assertPublicLocale(locale) {
  return assertSupportedLocale(locale);
}

export function localeMetadata(locale) {
  assertPublicLocale(locale);
  return PUBLIC_LOCALE_METADATA[locale];
}

export function localeUiCopy(locale) {
  assertPublicLocale(locale);
  return PUBLIC_UI_COPY[locale];
}

export function localeHome(locale) {
  return localeMetadata(locale).root_path;
}

export function localeSearch(locale) {
  assertPublicLocale(locale);
  return localeSearchUi(locale).searchPagePath;
}

export function localeAlphabet(locale) {
  assertPublicLocale(locale);
  return locale === 'hy' ? '/erazahan-online/' : null;
}

export function localeDream(locale, publishedSlug) {
  assertPublicLocale(locale);
  return publicPathFor(locale, publishedSlug);
}

export function localeNavigation(locale) {
  const copy = localeUiCopy(locale);
  return Object.freeze(NAVIGATION_ITEMS
    .filter((item) => item.locales.includes(locale))
    .map((item) => Object.freeze({ id: item.id, label: copy.navigation[item.id], href: item.href(locale) })));
}

// Every variant is derived from the existing public projection. In particular,
// PUBLISHED_WITH_DRAFT exposes the published snapshot only.
export function publishedLocaleHref(repository, contentId, locale) {
  assertPublicLocale(locale);
  return getPublishedLocaleEntry(repository, contentId, locale)?.path ?? null;
}

export function publishedLocaleVariants(repository, contentId) {
  return Object.freeze(listPublishedLocalesForContent(repository, contentId)
    .map((locale) => Object.freeze({ locale, href: publishedLocaleHref(repository, contentId, locale) })));
}
