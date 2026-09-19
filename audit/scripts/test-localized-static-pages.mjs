import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getLocalizedStaticPage,
  listLocalizedStaticPageNavigation,
  validateLocalizedStaticPage,
} from '../../src/lib/content-source/localized-static-pages.mjs';
import { assertLocalePublicSlug } from '../../src/lib/content-schema/multilingual-contract.mjs';

const roots = [];
const valid = (locale) => ({
  schema_version: 1,
  page_id: 'about',
  locale,
  slug: locale === 'ru' ? 'o-proekte' : 'about',
  title: `${locale} title`,
  description: `${locale} description`,
  navigation_label: `${locale} navigation`,
  body_markdown: 'Intro paragraph.\n\n## Section',
});
const root = () => {
  const value = mkdtempSync(path.join(tmpdir(), 'erazahan-static-pages-'));
  roots.push(value);
  return value;
};
const write = (base, pageId, locale, document) => {
  const file = path.join(base, pageId, `${locale}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
};

try {
  const ru = getLocalizedStaticPage('about', 'ru');
  const en = getLocalizedStaticPage('about', 'en');
  assert.equal(ru.title, 'О проекте Erazahan');
  assert.equal(en.title, 'About Erazahan');
  assert.equal(ru.slug, 'o-proekte');
  assert.equal(en.slug, 'about');
  assert.match(ru.body_markdown, /«Համամարդկային Երազահան»/);
  assert.match(en.body_markdown, /A note for readers/);

  const onlyRu = root();
  write(onlyRu, 'about', 'ru', valid('ru'));
  assert.equal(getLocalizedStaticPage('about', 'en', onlyRu), null, 'missing EN cannot fall back to RU');
  assert.deepEqual(listLocalizedStaticPageNavigation('ru', onlyRu), [{ id: 'about', label: 'ru navigation', href: '/ru/o-proekte/' }]);
  assert.deepEqual(listLocalizedStaticPageNavigation('en', onlyRu), [], 'missing locale suppresses its footer link');
  assert.equal(getLocalizedStaticPage('about', 'ru', root()), null, 'missing page is unavailable');

  assert.throws(() => validateLocalizedStaticPage({ ...valid('ru'), locale: 'en' }, { pageId: 'about', locale: 'ru' }));
  assert.throws(() => validateLocalizedStaticPage({ ...valid('en'), slug: 'elsewhere' }, { pageId: 'about', locale: 'en' }));
  assert.throws(() => validateLocalizedStaticPage({ ...valid('en'), unexpected: true }, { pageId: 'about', locale: 'en' }));
  assert.throws(() => validateLocalizedStaticPage({ ...valid('en'), body_markdown: '<p>raw HTML</p>' }, { pageId: 'about', locale: 'en' }));
  assert.throws(() => validateLocalizedStaticPage({ ...valid('en'), body_markdown: '# Body heading' }, { pageId: 'about', locale: 'en' }));
  assert.throws(() => getLocalizedStaticPage('contact', 'en'));
  assert.throws(() => getLocalizedStaticPage('about', 'hy'));

  for (const [locale, slug] of [['ru', 'o-proekte'], ['en', 'about']]) assert.throws(() => assertLocalePublicSlug(locale, slug));

  const header = readFileSync('src/components/Header.astro', 'utf8');
  const footer = readFileSync('src/components/Footer.astro', 'utf8');
  assert.doesNotMatch(header, /LocalizedStaticPage|listLocalizedStaticPageNavigation|staticFooterPages/);
  assert.match(footer, /listLocalizedStaticPageNavigation\(locale\)/);
  for (const forbidden of ['scanContentStore', 'multilingual-store', 'pages.json', 'published-search', 'published-sitemaps']) {
    assert.doesNotMatch(readFileSync('src/lib/content-source/localized-static-pages.mjs', 'utf8'), new RegExp(forbidden));
  }

  console.log('LOCALIZED STATIC PAGES PASS');
} finally {
  for (const value of roots) rmSync(value, { recursive: true, force: true });
}
