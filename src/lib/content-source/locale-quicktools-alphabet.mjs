import { CONTENT_STORE_ROOT } from './localized-dream-routes.mjs';
import { listLocaleLetterRouteEntries } from './locale-letter-routes.mjs';
import { scanContentStore } from './multilingual-store.mjs';

function assertLocalizedLocale(locale) {
  if (locale !== 'ru' && locale !== 'en') {
    throw new TypeError(`QuickTools alphabet only supports ru or en, received ${JSON.stringify(locale)}`);
  }
}

// This is a UI-only projection: ordering and hrefs remain owned by the
// published alphabet and locale-letter route authorities.
export function projectLocaleQuickToolsAlphabetItems(repository, locale) {
  assertLocalizedLocale(locale);
  return Object.freeze(listLocaleLetterRouteEntries(repository, locale).map((route) => Object.freeze({
    label: route.group.alphabet_key,
    href: route.path,
  })));
}

let realRepository = null;
const realItemsByLocale = new Map();

// QuickTools is rendered broadly, so the real store is scanned once at most
// per module/build process, and each localized projection is memoized.
export function listRealLocaleQuickToolsAlphabetItems(locale) {
  assertLocalizedLocale(locale);
  if (realItemsByLocale.has(locale)) return realItemsByLocale.get(locale);
  if (realRepository === null) realRepository = scanContentStore(CONTENT_STORE_ROOT);
  const items = projectLocaleQuickToolsAlphabetItems(realRepository, locale);
  realItemsByLocale.set(locale, items);
  return items;
}
