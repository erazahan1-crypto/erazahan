import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listPublishedAlphabetGroups } from '../../src/lib/content-source/published-alphabet.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
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

// Keep an explicit empty projection fixture: the component's groups.length
// branch must receive no links and render the localized empty copy for a truly
// empty locale, independently of the current production corpus.
for (const locale of ['ru', 'en']) {
  assert.deepEqual(listPublishedAlphabetGroups({ records: [] }, locale), [], `${locale} empty fixture has no alphabet groups`);
}

const repository = scanContentStore('src/data/content/dreams');
for (const locale of ['ru', 'en']) {
  const root = locale === 'ru' ? '/ru/' : '/en/';
  const file = `dist${root}letter/index.html`;
  const html = read(file);
  const copy = localeUiCopy(locale).alphabet;
  const groups = listPublishedAlphabetGroups(repository, locale);
  assert.match(html, new RegExp(`<html lang="${locale}">`));
  assert.match(html, new RegExp(`<link rel="canonical" href="https://erazahan\\.info${root}letter/">`));
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(html.includes(copy.heading), `${locale} root renders localized alphabet heading`);
  assert.ok(html.includes(`href="${root}"`), `${locale} root breadcrumb stays in locale`);
  const actualHrefs = [...html.matchAll(new RegExp(`href="${root}letter/([^\"]+)/"`, 'g'))].map((match) => match[1]);
  const expectedRouteKeys = groups.map((group) => group.route_key);
  assert.deepEqual(actualHrefs, expectedRouteKeys, `${locale} root renders every populated canonical alphabet group once and in canonical order`);
  assert.equal(new Set(actualHrefs).size, actualHrefs.length, `${locale} root has no duplicate letter links`);
  if (groups.length === 0) {
    assert.ok(html.includes(copy.empty), `${locale} empty root renders honest localized empty state`);
  } else {
    assert.equal(html.includes(copy.empty), false, `${locale} populated root omits the empty state`);
    for (const group of groups) {
      assert.ok(html.includes(`>${group.alphabet_key}</a>`), `${locale} root renders canonical alphabet key ${group.alphabet_key}`);
      assert.ok(group.entries.every((entry) => entry.alphabet_key === group.alphabet_key), `${locale}/${group.alphabet_key} retains localized published alphabet ownership`);
    }
  }
  for (const forbidden of ['href="/"', '/erazahan-online/', 'application/ld+json', 'data-featured-dreams-mount', '/api/published-dreams']) {
    assert.equal(html.includes(forbidden), false, `${locale} root excludes HY-only ${forbidden}`);
  }
}

console.log('LOCALE ALPHABET ROOTS PASS');
