import { canonicalAlphabetRouteKey } from './content-schema/locale-alphabet.mjs';
import { assertPublicLocale, localeAlphabet, localeHome, localeUiCopy } from './public-locale.mjs';

function assertLocalizedLocale(locale) {
  assertPublicLocale(locale);
  if (locale === 'hy') throw new TypeError('Localized dream breadcrumbs support ru and en only');
}

// Entries come from the already-resolved published locale route; this helper
// does not inspect locale documents or derive an alphabet key from a title.
export function localizedDreamBreadcrumb(locale, entry) {
  assertLocalizedLocale(locale);
  const copy = localeUiCopy(locale);
  const { title, alphabet_key: alphabetKey } = entry.published;
  const items = [
    Object.freeze({ href: localeHome(locale), label: copy.breadcrumbs.home }),
    Object.freeze({ href: localeAlphabet(locale), label: copy.navigation.alphabet }),
  ];
  if (alphabetKey !== null) {
    items.push(Object.freeze({
      href: `${localeAlphabet(locale)}${canonicalAlphabetRouteKey(locale, alphabetKey)}/`,
      label: alphabetKey,
    }));
  }
  items.push(Object.freeze({ href: null, label: title }));
  return Object.freeze(items);
}
