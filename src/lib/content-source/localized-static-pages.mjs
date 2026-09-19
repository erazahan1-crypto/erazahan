import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const STATIC_PAGE_SCHEMA_VERSION = 1;
export const STATIC_PAGE_ROOT = path.resolve(process.cwd(), 'src/data/content/static-pages');

const STATIC_PAGE_DEFINITIONS = Object.freeze({
  about: Object.freeze({
    ru: Object.freeze({ slug: 'o-proekte' }),
    en: Object.freeze({ slug: 'about' }),
  }),
});
const DOCUMENT_KEYS = Object.freeze([
  'body_markdown',
  'description',
  'locale',
  'navigation_label',
  'page_id',
  'schema_version',
  'slug',
  'title',
]);
const RAW_HTML_RE = /<\/?[a-z][^>]*>/i;
const MARKDOWN_H1_RE = /(?:^|\n)\s{0,3}#(?!#)\s+/;

function fail(message) {
  throw new TypeError(`Localized static page: ${message}`);
}

function freezePage(page) {
  return Object.freeze({ ...page });
}

export function assertStaticPageId(pageId) {
  if (!Object.hasOwn(STATIC_PAGE_DEFINITIONS, pageId)) fail(`unsupported page_id ${JSON.stringify(pageId)}`);
  return pageId;
}

export function assertStaticPageLocale(pageId, locale) {
  assertStaticPageId(pageId);
  if (!Object.hasOwn(STATIC_PAGE_DEFINITIONS[pageId], locale)) {
    fail(`unsupported locale ${JSON.stringify(locale)} for ${pageId}`);
  }
  return locale;
}

export function staticPagePath(pageId, locale) {
  assertStaticPageLocale(pageId, locale);
  return `/${locale}/${STATIC_PAGE_DEFINITIONS[pageId][locale].slug}/`;
}

export function validateLocalizedStaticPage(document, { pageId, locale } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) fail('document must be an object');
  if (!pageId || !locale) fail('expected page_id and locale are required');
  assertStaticPageLocale(pageId, locale);

  const keys = Object.keys(document).sort();
  if (JSON.stringify(keys) !== JSON.stringify(DOCUMENT_KEYS)) fail('document has an unexpected shape');
  if (document.schema_version !== STATIC_PAGE_SCHEMA_VERSION) fail('unsupported schema_version');
  if (document.page_id !== pageId) fail('page_id does not match storage identity');
  if (document.locale !== locale) fail('locale does not match storage identity');
  if (document.slug !== STATIC_PAGE_DEFINITIONS[pageId][locale].slug) fail('slug does not match page_id/locale');

  for (const field of ['title', 'description', 'navigation_label', 'body_markdown']) {
    if (typeof document[field] !== 'string' || !document[field].trim()) fail(`${field} must be a non-empty string`);
  }
  if (RAW_HTML_RE.test(document.body_markdown)) fail('body_markdown must not contain raw HTML');
  if (MARKDOWN_H1_RE.test(document.body_markdown)) fail('body_markdown must not contain an H1');

  return freezePage(document);
}

function documentPath(root, pageId, locale) {
  return path.join(root, pageId, `${locale}.json`);
}

export function getLocalizedStaticPage(pageId, locale, root = STATIC_PAGE_ROOT) {
  assertStaticPageLocale(pageId, locale);
  const file = documentPath(root, pageId, locale);
  if (!existsSync(file)) return null;
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`could not read ${pageId}/${locale}: ${error.message}`);
  }
  return validateLocalizedStaticPage(document, { pageId, locale });
}

// Footer links are derived only from physically present, validated documents.
export function listLocalizedStaticPageNavigation(locale, root = STATIC_PAGE_ROOT) {
  const links = [];
  for (const pageId of Object.keys(STATIC_PAGE_DEFINITIONS)) {
    if (!Object.hasOwn(STATIC_PAGE_DEFINITIONS[pageId], locale)) continue;
    const page = getLocalizedStaticPage(pageId, locale, root);
    if (page) links.push(Object.freeze({ id: page.page_id, label: page.navigation_label, href: staticPagePath(pageId, locale) }));
  }
  return Object.freeze(links);
}
