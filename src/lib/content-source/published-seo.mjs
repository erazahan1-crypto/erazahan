import { assertSupportedLocale } from '../content-schema/multilingual-contract.mjs';
import { getPublishedLocaleEntry, listPublishedLocalesForContent } from './published-content.mjs';

const SEO_LOCALES = Object.freeze({
  hy: Object.freeze({ html_lang: 'hy', og_locale: 'hy_AM' }),
  ru: Object.freeze({ html_lang: 'ru', og_locale: 'ru_RU' }),
  en: Object.freeze({ html_lang: 'en', og_locale: 'en_US' }),
});

export function localeSeoMetadata(locale) {
  assertSupportedLocale(locale);
  return SEO_LOCALES[locale];
}

// Uses only Stage 12D projections; drafts and unpublished locales never enter SEO.
export function buildPublishedSeoContext(repository, contentId, locale) {
  const entry = getPublishedLocaleEntry(repository, contentId, locale);
  if (!entry) return null;
  const variants = listPublishedLocalesForContent(repository, contentId)
    .map((variantLocale) => getPublishedLocaleEntry(repository, contentId, variantLocale));
  return Object.freeze({
    locale,
    ...localeSeoMetadata(locale),
    canonical_path: entry.path,
    alternates: Object.freeze(variants.length > 1 ? variants.map((variant) => Object.freeze({ locale: variant.locale, path: variant.path })) : []),
  });
}
