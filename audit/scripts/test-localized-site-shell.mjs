import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localeNavigation, localeSearch } from '../../src/lib/public-locale.mjs';

const read = (file) => readFileSync(file, 'utf8');
const layout = read('src/layouts/Layout.astro');
const header = read('src/components/Header.astro');
const footer = read('src/components/Footer.astro');
const home = read('src/components/LocaleHomePage.astro');
const ru = read('src/pages/ru/index.astro');
const en = read('src/pages/en/index.astro');

assert.match(layout, /<Header locale=\{locale\} \/>/);
assert.match(layout, /<Footer locale=\{locale\} \/>/);
assert.match(layout, /locale === 'hy' \? <QuickTools locale=\{locale\} \/> : null/);
assert.match(layout, /locale === 'hy' \? <script type="application\/ld\+json" set:html=\{JSON\.stringify\(websiteSchema\(\)\)\} \/> : null/);
assert.match(layout, /robots: requestedRobots = ALLOW_INDEXING \? null : 'noindex, nofollow'/);
assert.match(layout, /const effectiveRobots = locale === 'hy' \? requestedRobots : 'noindex, nofollow';/);
assert.match(layout, /<meta name="robots" content=\{effectiveRobots\} \/>/);
assert.match(header, /localeNavigation\(locale\)/);
assert.match(header, /localeSearch\(locale\)/);
assert.match(footer, /localeNavigation\(locale\)/);
assert.match(ru, /LocaleHomePage locale=\{locale\}/);
assert.match(en, /LocaleHomePage locale=\{locale\}/);
assert.match(ru, /robots="noindex, nofollow"/);
assert.match(en, /robots="noindex, nofollow"/);
assert.match(home, /data-locale-home=\{locale\}/);
assert.match(home, /action=\{searchHref\}/);
assert.match(home, /copy\.empty\.unavailable/);
for (const forbidden of ['scanContentStore', 'listPublishedLocaleEntries', 'dreamPosts', 'featured']) assert.doesNotMatch(home, new RegExp(forbidden));

assert.deepEqual(localeNavigation('ru'), [
  { id: 'home', label: 'Главная', href: '/ru/' },
  { id: 'search', label: 'Поиск', href: '/ru/search/' },
  { id: 'alphabet', label: 'Алфавит', href: '/ru/letter/' },
]);
assert.deepEqual(localeNavigation('en'), [
  { id: 'home', label: 'Home', href: '/en/' },
  { id: 'search', label: 'Search', href: '/en/search/' },
  { id: 'alphabet', label: 'Alphabet', href: '/en/letter/' },
]);
assert.equal(localeSearch('ru'), '/ru/search/');
assert.equal(localeSearch('en'), '/en/search/');

const generated = [
  {
    locale: 'ru', file: 'dist/ru/index.html', root: '/ru/', search: '/ru/search/', lang: 'ru', ogLocale: 'ru_RU',
    title: 'Erazahan — толкование снов', description: 'Поиск опубликованных толкований снов.',
  },
  {
    locale: 'en', file: 'dist/en/index.html', root: '/en/', search: '/en/search/', lang: 'en', ogLocale: 'en_US',
    title: 'Erazahan — dream meanings', description: 'Search published dream meanings.',
  },
];

for (const page of generated) {
  const html = read(page.file);
  assert.match(html, new RegExp(`<html lang="${page.lang}">`));
  assert.match(html, new RegExp(`<title>${page.title}</title>`));
  assert.match(html, new RegExp(`<meta name="description" content="${page.description}">`));
  assert.match(html, new RegExp(`<link rel="canonical" href="https://erazahan\\.info${page.root}">`));
  assert.match(html, new RegExp(`<meta name="robots" content="noindex, nofollow">`));
  assert.match(html, new RegExp(`<meta property="og:locale" content="${page.ogLocale}">`));
  assert.ok(html.includes(`href="${page.root}"`), `${page.locale} generated home links to its locale root`);
  assert.ok(html.includes(`action="${page.search}"`), `${page.locale} generated home search targets its locale search route`);
  assert.ok(html.includes(`href="${page.search}"`), `${page.locale} generated navigation targets its locale search route`);
  for (const forbidden of ['href="/"', 'action="/search"', '/erazahan-online/', '/api/published-dreams', 'data-featured-dreams-mount', 'application/ld+json', 'https://erazahan.info/search?q=']) {
    assert.equal(html.includes(forbidden), false, `${page.locale} generated home excludes HY-only ${forbidden}`);
  }
}

const hy = read('dist/index.html');
assert.match(hy, /<script type="application\/ld\+json">/);
assert.match(hy, /https:\/\/erazahan\.info\/search\?q=\{search_term_string\}/);
assert.equal(hy.includes('<meta name="robots" content="noindex, nofollow">'), false, 'production HY output remains indexable when PUBLIC_ALLOW_INDEXING=true');
console.log('LOCALIZED SITE SHELL PASS');
