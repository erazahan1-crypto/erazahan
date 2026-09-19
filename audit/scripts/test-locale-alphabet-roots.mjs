import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localeAlphabet, localeNavigation, localeUiCopy } from '../../src/lib/public-locale.mjs';

const read = (file) => readFileSync(file, 'utf8');
const component = read('src/components/LocaleAlphabetPage.astro');
const ruRoute = read('src/pages/ru/letter/index.astro');
const enRoute = read('src/pages/en/letter/index.astro');

assert.match(component, /data-locale-alphabet=\{locale\}/);
assert.match(component, /localeHome\(locale\)/);
assert.match(component, /localeAlphabet\(locale\)/);
assert.match(component, /groups\.map/);
assert.match(component, /\$\{alphabetHref\}\$\{group\.route_key\}\//);
assert.match(component, /copy\.alphabet\.empty/);
for (const source of [ruRoute, enRoute]) {
  assert.match(source, /listPublishedAlphabetGroups/);
  assert.match(source, /scanContentStore/);
  assert.match(source, /<LocaleAlphabetPage locale=\{locale\} groups=\{groups\} \/>/);
  assert.doesNotMatch(source, /robots=/);
}

assert.equal(localeAlphabet('ru'), '/ru/letter/');
assert.equal(localeAlphabet('en'), '/en/letter/');
assert.deepEqual(localeNavigation('ru').map(({ href }) => href), ['/ru/', '/ru/search/', '/ru/letter/']);
assert.deepEqual(localeNavigation('en').map(({ href }) => href), ['/en/', '/en/search/', '/en/letter/']);

for (const locale of ['ru', 'en']) {
  const root = locale === 'ru' ? '/ru/' : '/en/';
  const file = `dist${root}letter/index.html`;
  const html = read(file);
  const copy = localeUiCopy(locale).alphabet;
  assert.match(html, new RegExp(`<html lang="${locale}">`));
  assert.match(html, new RegExp(`<link rel="canonical" href="https://erazahan\\.info${root}letter/">`));
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(html.includes(copy.heading), `${locale} root renders localized alphabet heading`);
  assert.ok(html.includes(copy.empty), `${locale} zero-content root renders honest localized empty state`);
  assert.ok(html.includes(`href="${root}"`), `${locale} root breadcrumb stays in locale`);
  assert.equal(/href="\/(?:ru|en)\/letter\/[^\"]+\//.test(html), false, `${locale} zero-content root has no letter links`);
  for (const forbidden of ['href="/"', '/erazahan-online/', 'application/ld+json', 'data-featured-dreams-mount', '/api/published-dreams']) {
    assert.equal(html.includes(forbidden), false, `${locale} root excludes HY-only ${forbidden}`);
  }
}

console.log('LOCALE ALPHABET ROOTS PASS');
