import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localeNavigation, localeSearch } from '../../src/lib/public-locale.mjs';
import { loadPublishedLocaleAvailability } from '../../src/lib/content-source/published-locale-availability.mjs';

const read = (file) => readFileSync(file, 'utf8');
const localizedIndexingReleased = process.env.PUBLIC_ALLOW_INDEXING === 'true'
  && process.env.PUBLIC_ALLOW_LOCALIZED_INDEXING === 'true';
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
assert.match(layout, /import \{ isRuntimeLocaleIndexingAllowed \} from '..\/lib\/indexing-policy\.mjs';/);
assert.match(layout, /robots: requestedRobots = null/);
assert.match(layout, /const effectiveRobots = isRuntimeLocaleIndexingAllowed\(locale\)/);
assert.match(layout, /<meta name="robots" content=\{effectiveRobots\} \/>/);
assert.match(header, /localeNavigation\(locale\)/);
assert.match(header, /localeSearch\(locale\)/);
assert.match(footer, /localeNavigation\(locale\)/);
assert.match(ru, /LocaleHomePage locale=\{locale\}/);
assert.match(en, /LocaleHomePage locale=\{locale\}/);
assert.doesNotMatch(ru, /robots=/);
assert.doesNotMatch(en, /robots=/);
assert.match(home, /data-locale-home=\{locale\}/);
assert.match(home, /action=\{searchHref\}/);
assert.match(home, /copy\.empty\.unavailable/);
assert.match(home, /loadPublishedLocaleAvailability/);
for (const forbidden of ['scanContentStore', 'listPublishedLocaleEntries', 'dreamPosts', 'featured']) assert.doesNotMatch(home, new RegExp(forbidden));

const enAvailability = loadPublishedLocaleAvailability('en');
const ruAvailability = loadPublishedLocaleAvailability('ru');
assert.equal(enAvailability.available, true);
assert.deepEqual(enAvailability.entries.map((entry) => ({ title: entry.published.title, path: entry.path })), [
  { title: 'Tar Musical Instrument Dream Meaning', path: '/en/tar-musical-instrument-dream-meaning/' },
]);
assert.equal(ruAvailability.available, false);

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
  if (localizedIndexingReleased) {
    assert.doesNotMatch(html, /<meta name="robots" content=/, `${page.locale} home is not centrally blocked after localized release`);
  } else {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  }
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

const enHome = read('dist/en/index.html');
assert.equal(enHome.includes('Not available in this language yet.'), false, 'EN home and footer do not claim published content is unavailable');
assert.match(enHome, /href="\/en\/tar-musical-instrument-dream-meaning\/"[^>]*>Tar Musical Instrument Dream Meaning<\/a>/);
assert.match(enHome, /Published dream meanings are available in English\./);

const ruHome = read('dist/ru/index.html');
assert.ok(ruHome.includes('\u041d\u0430 \u044d\u0442\u043e\u043c \u044f\u0437\u044b\u043a\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e.'), 'RU home and footer retain their zero-content state');

const enDream = read('dist/en/tar-musical-instrument-dream-meaning/index.html');
if (localizedIndexingReleased) {
  assert.doesNotMatch(enDream, /<meta name="robots" content=/, 'published EN dream is not centrally blocked after localized release');
} else {
  assert.match(enDream, /<meta name="robots" content="noindex, nofollow">/);
}

for (const file of ['dist/en/search/index.html', 'dist/ru/search/index.html']) {
  assert.match(read(file), /<meta name="robots" content="noindex, nofollow">/, `${file} retains its page-level noindex directive`);
}
console.log('LOCALIZED SITE SHELL PASS');
