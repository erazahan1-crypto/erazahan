import path from 'node:path';
import { assertSupportedLocale, publicPathFor } from '../content-schema/multilingual-contract.mjs';
import { listPublishedLocaleEntries } from './published-content.mjs';
import { scanContentStore } from './multilingual-store.mjs';

export const CONTENT_STORE_ROOT = path.resolve(
  process.cwd(),
  'src/data/content/dreams',
);

// Route generation is intentionally based only on Stage 12D published entries.
export function listLocalizedDreamRouteEntries(repository, locale) {
  assertSupportedLocale(locale);
  const entries = listPublishedLocaleEntries(repository, locale);
  const routes = entries.map((entry) => {
    const publicPath = publicPathFor(locale, entry.slug);
    const segments = publicPath.split('/').filter(Boolean);
    if (entry.path !== publicPath || segments.length !== (locale === 'hy' ? 1 : 2)
      || (locale !== 'hy' && segments[0] !== locale) || segments.at(-1) !== entry.slug) {
      throw new TypeError(`Localized dream route path mismatch for ${entry.content_id}/${locale}`);
    }
    return Object.freeze({ slug: entry.slug, path: entry.path, entry });
  });
  if (new Set(routes.map((route) => route.path)).size !== routes.length) {
    throw new TypeError(`Duplicate localized dream route path for ${locale}`);
  }
  return Object.freeze(routes);
}

export function loadLocalizedDreamRouteEntries(locale, root = CONTENT_STORE_ROOT) {
  return listLocalizedDreamRouteEntries(scanContentStore(root), locale);
}
