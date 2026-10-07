import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const pages = [
  {
    locale: 'ru', file: 'dist/ru/o-proekte/index.html', path: '/ru/o-proekte/', lang: 'ru', ogLocale: 'ru_RU',
    title: 'О проекте Erazahan', description: 'О проекте Erazahan, истории источника и принципах сохранения традиционных толкований снов.',
    home: 'Главная', crumb: 'О проекте', footer: 'О проекте', marker: 'Источники книги',
  },
  {
    locale: 'en', file: 'dist/en/about/index.html', path: '/en/about/', lang: 'en', ogLocale: 'en_US',
    title: 'About Erazahan', description: 'About Erazahan, its historical source, and the principles used to preserve traditional dream interpretations.',
    home: 'Home', crumb: 'About', footer: 'About', marker: 'The book\'s sources',
  },
];

for (const page of pages) {
  const html = read(page.file);
  assert.match(html, new RegExp(`<html lang="${page.lang}">`));
  assert.match(html, new RegExp(`<title>${page.title}</title>`));
  assert.match(html, new RegExp(`<meta name="description" content="${page.description}">`));
  assert.match(html, new RegExp(`<link rel="canonical" href="https://erazahan\\.info${page.path}">`));
  assert.match(html, new RegExp(`<meta name="robots" content="noindex, nofollow">`));
  assert.match(html, new RegExp(`<meta property="og:locale" content="${page.ogLocale}">`));
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${page.locale} has exactly one H1`);
  assert.ok(html.includes(`href="/${page.locale}/"`));
  assert.ok(html.includes(page.home));
  assert.ok(html.includes(page.crumb));
  assert.ok(html.includes(page.marker));
  assert.ok(html.includes(`href="${page.path}"`), `${page.locale} footer exposes About`);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.equal(header.includes(`href="${page.path}"`), false, `${page.locale} header excludes About`);
  for (const forbidden of ['application/ld+json', 'SearchAction', 'https://erazahan.info/search?q={search_term_string}', 'href="/about/"', 'href="/erazahan-online/"']) {
    assert.equal(html.includes(forbidden), false, `${page.locale} excludes ${forbidden}`);
  }
}

for (const [locale, slug] of [['ru', 'o-proekte'], ['en', 'about']]) {
  const searchEntries = JSON.parse(read(`dist/${locale}/search-index.json`));
  assert.equal(searchEntries.some((entry) => entry.slug === slug), false, `${locale} static About is absent from its search index`);
  assert.equal(read(`dist/sitemap-${locale}.xml`).includes(`<loc>https://erazahan.info/${locale}/${slug}/</loc>`), false, `${locale} static About is absent from its sitemap`);
}

const hyAbout = read('dist/about/index.html');
assert.match(hyAbout, /<title>Մեր Մասին<\/title>/);
assert.match(hyAbout, /About the Project: How Erazahan\.info Was Created/);
console.log('LOCALIZED STATIC PAGE OUTPUT PASS');
