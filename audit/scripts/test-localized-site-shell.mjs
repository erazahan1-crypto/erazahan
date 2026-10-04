import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localeNavigation, localeSearch, localeUiCopy } from '../../src/lib/public-locale.mjs';
import { isRuntimeLocaleIndexingAllowed } from '../../src/lib/indexing-policy.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { listPublishedLocaleEntries } from '../../src/lib/content-source/published-content.mjs';
import { loadPublishedLocaleAvailability } from '../../src/lib/content-source/published-locale-availability.mjs';

const read = (file) => readFileSync(file, 'utf8');
const origin = 'https://erazahan.info';
function assertCanonicalPath(html, expectedPath, label) {
  const match = html.match(/<link rel="canonical" href="([^"]+)">/);
  assert.ok(match, `${label} has a canonical URL`);
  const canonical = new URL(match[1]);
  assert.equal(canonical.origin, origin, `${label} canonical URL uses the public origin`);
  assert.equal(decodeURIComponent(canonical.pathname), expectedPath, `${label} canonical URL uses the canonical public path`);
}
const localizedIndexingReleased = isRuntimeLocaleIndexingAllowed('en');
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
const canonicalRepository = scanContentStore('src/data/content/dreams');
for (const [locale, availability] of [['ru', ruAvailability], ['en', enAvailability]]) {
  const expected = listPublishedLocaleEntries(canonicalRepository, locale);
  assert.equal(availability.available, expected.length > 0, `${locale} availability follows published locale documents`);
  assert.deepEqual(availability.entries.map((entry) => ({ content_id: entry.content_id, title: entry.published.title, path: entry.path })), expected.map((entry) => ({ content_id: entry.content_id, title: entry.published.title, path: entry.path })), `${locale} availability uses current published locale snapshots`);
  assert.equal(new Set(availability.entries.map((entry) => entry.path)).size, availability.entries.length, `${locale} availability paths are unique`);
  assert.equal(availability.entries.every((entry) => entry.locale === locale && entry.path.startsWith(`/${locale}/`)), true, `${locale} availability has no wrong-locale entries`);
}

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
  const availability = page.locale === 'ru' ? ruAvailability : enAvailability;
  if (availability.available) {
    assert.equal(html.includes(localeUiCopy(page.locale).empty.unavailable), false, `${page.locale} home does not show an unavailable message when published pages exist`);
    for (const entry of availability.entries) {
      assert.ok(html.includes(`href="${entry.path}"`), `${page.locale} home links to each published locale page`);
      assert.ok(html.includes(entry.published.title), `${page.locale} home uses each published locale title`);
    }
  } else assert.ok(html.includes(localeUiCopy(page.locale).empty.unavailable), `${page.locale} home shows the localized unavailable message without published pages`);
}

const hy = read('dist/index.html');
assert.match(hy, /<script type="application\/ld\+json">/);
assert.match(hy, /https:\/\/erazahan\.info\/search\?q=\{search_term_string\}/);
assertCanonicalPath(hy, '/', 'HY home');
if (isRuntimeLocaleIndexingAllowed('hy')) {
  assert.equal(hy.includes('<meta name="robots" content="noindex, nofollow">'), false, 'HY output is indexable when runtime HY indexing is enabled');
} else {
  assert.equal(hy.includes('<meta name="robots" content="noindex, nofollow">'), true, 'HY output is fail-closed when runtime HY indexing is disabled');
}

for (const [locale, availability] of [['ru', ruAvailability], ['en', enAvailability]]) {
  for (const entry of availability.entries) {
    const dream = read(`dist${entry.path}index.html`);
    if (localizedIndexingReleased) {
      assert.doesNotMatch(dream, /<meta name="robots" content=/, `${locale} published dream is not centrally blocked after localized release`);
    } else {
      assert.match(dream, /<meta name="robots" content="noindex, nofollow">/);
    }
    assertCanonicalPath(dream, entry.path, `${locale} published dream`);
    assert.ok(dream.includes(entry.published.title), `${locale} public page uses its published title`);
  }
}

for (const file of ['dist/en/search/index.html', 'dist/ru/search/index.html']) {
  assert.match(read(file), /<meta name="robots" content="noindex, nofollow">/, `${file} retains its page-level noindex directive`);
}
console.log('LOCALIZED SITE SHELL PASS');
