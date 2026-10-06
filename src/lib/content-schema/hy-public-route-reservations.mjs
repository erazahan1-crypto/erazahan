import pagesJson from '../../data/pages.json' with { type: 'json' };
import { CONTENT_LOCALES, SOURCE_LOCALE } from './schema.mjs';
import { localeSearchUi } from '../search/locale-search-ui.mjs';

// Compatibility aliases are public route owners even though they redirect.
export const LEGACY_HY_PATH_ALIASES = Object.freeze({
  'arakan-anunner-a': 'արական-անուններ-սկսվող-ա-տառով',
});

// These are the top-level public endpoints and namespace roots outside the
// imported page dataset. Dotted endpoints are also retained for callers that
// use this projection independently of the admin slug validator.
const SYSTEM_PUBLIC_ROOT_PATHS = Object.freeze([
  '404',
  'admin',
  'api',
  'dream-content-index.json',
  'keystatic',
  'robots.txt',
  'search-index.json',
  'sitemap.xml',
  'sitemap-en.xml',
  'sitemap-hy.xml',
  'sitemap-ru.xml',
]);

const BOYS_NAME_CATEGORY = 'Արական Անունների Նշանակությունը';
const GIRLS_NAME_CATEGORY = 'Իգական Անուների Նշանակությունը';
const ARMENIAN_NAME_LETTERS = new Set([
  'Ա', 'Բ', 'Գ', 'Դ', 'Ե', 'Զ', 'Է', 'Ը', 'Թ', 'Ժ', 'Ի', 'Լ', 'Խ', 'Ծ', 'Կ',
  'Հ', 'Ձ', 'Ղ', 'Ճ', 'Մ', 'Յ', 'Ն', 'Շ', 'Ո', 'Չ', 'Պ', 'Ջ', 'Ռ', 'Ս', 'Վ',
  'Տ', 'Ր', 'Ց', 'Ու', 'Փ', 'Ք', 'Օ', 'Ֆ',
]);

function normalizeArmenianLetter(value) {
  return value.replace(/\u0552/g, '\u0582').trim();
}

function nameFromTitle(title) {
  let value = title.trim();
  const prefix = value.match(/^Անունների\s+(?:Նշանակություն(?:ը)?|Բացատրություն(?:ը)?)\s*(.+)$/i);
  if (prefix) return prefix[1].trim();
  const anvanIndex = value.search(/անվան/i);
  if (anvanIndex > 0) return value.slice(0, anvanIndex).trim();
  const anan = value.match(/^(.*?)\s*անան\s*(?=նշանակ|բացատր)/i);
  if (anan) return anan[1].trim();
  if (/նշանակ|բացատր|Անունների/i.test(value)) return '';
  return value;
}

function firstNameLetter(name) {
  const value = name.trim();
  if (!value) return '';
  if (normalizeArmenianLetter(value.slice(0, 2)) === 'Ու') return 'Ու';
  const first = value.charAt(0).toUpperCase();
  return ARMENIAN_NAME_LETTERS.has(first) ? first : '';
}

function listGeneratedNamePagePaths(posts) {
  const paths = new Set();
  for (const [gender, category] of [['boys', BOYS_NAME_CATEGORY], ['girls', GIRLS_NAME_CATEGORY]]) {
    for (const post of posts) {
      if (!Array.isArray(post?.categories) || !post.categories.includes(category) || typeof post.title !== 'string') continue;
      const letter = firstNameLetter(nameFromTitle(post.title));
      if (!letter) continue;
      const segment = `${gender === 'boys' ? 'արական' : 'իգական'}-անուններ-սկսվող-${normalizeArmenianLetter(letter).toLowerCase()}-տառով`;
      addPublicPath(paths, segment);
    }
  }
  return paths;
}

export function normalizeUnprefixedPublicPath(value) {
  if (typeof value !== 'string') return null;
  const path = value.replace(/^\/+|\/+$/g, '');
  if (!path || path.includes('/')) return null;
  return path.normalize('NFKC');
}

function addPublicPath(paths, value) {
  const normalized = normalizeUnprefixedPublicPath(value);
  if (normalized) paths.add(normalized);
}

// This is the route-ownership projection for a native HY slug, whose public
// output is always exactly `/<slug>/`.
export function listOccupiedNativeHySlugs(posts) {
  if (!Array.isArray(posts)) throw new TypeError('Native HY route reservation requires a post array');
  const paths = new Set();
  for (const post of posts) addPublicPath(paths, post?.slug);
  for (const path of listGeneratedNamePagePaths(posts)) paths.add(path);
  for (const page of pagesJson) addPublicPath(paths, page?.path);
  for (const alias of Object.keys(LEGACY_HY_PATH_ALIASES)) addPublicPath(paths, alias);
  for (const path of SYSTEM_PUBLIC_ROOT_PATHS) addPublicPath(paths, path);
  for (const locale of CONTENT_LOCALES) {
    if (locale !== SOURCE_LOCALE) addPublicPath(paths, locale);
  }
  addPublicPath(paths, localeSearchUi(SOURCE_LOCALE).searchPagePath);
  return Object.freeze([...paths].sort((left, right) => left.localeCompare(right, 'en')));
}
