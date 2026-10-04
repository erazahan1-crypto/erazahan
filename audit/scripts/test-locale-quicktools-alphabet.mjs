import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  listRealLocaleQuickToolsAlphabetItems,
  projectLocaleQuickToolsAlphabetItems,
} from '../../src/lib/content-source/locale-quicktools-alphabet.mjs';
import { listPublishedAlphabetGroups } from '../../src/lib/content-source/published-alphabet.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';

const fingerprint = 'a'.repeat(64);
const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';

function snapshot(locale, slug, title, alphabetKey, revision = 1) {
  return { slug, title, description: null, content: '<p>published</p>', image_alts: {}, tags: [locale], alphabet_key: alphabetKey,
    based_on_source_revision: revision, based_on_source_fingerprint: fingerprint };
}
function record(contentId, locale, published, draft = null, sourceRevision = 1) {
  return { content_id: contentId,
    item: { content_id: contentId, schema_version: 1, type: 'dream_dictionary', source_locale: 'hy', source_revision: sourceRevision, source_fingerprint: fingerprint, fingerprint_spec_version: 1 },
    locales: { [locale]: { schema_version: 1, content_id: contentId, locale, draft, published: published ? { ...published, version: 1, published_at: '2026-09-15' } : null } } };
}
const repo = (records) => ({ records });
const draft = snapshot('ru', 'draft-only', 'Черновик', 'Ч');
const items = (records, locale) => projectLocaleQuickToolsAlphabetItems(repo(records), locale);

assert.deepEqual(items([], 'ru'), []);
assert.deepEqual(items([], 'en'), []);
assert.throws(() => items([], 'hy'));

const ru = items([
  record(A, 'ru', snapshot('ru', 'еда', 'Еда', 'Е')),
  record(B, 'ru', snapshot('ru', 'еж', 'Ёж', 'Ё')),
  record(C, 'ru', snapshot('ru', 'жук', 'Жук', 'Ж')),
], 'ru');
assert.deepEqual(ru, [
  { label: 'Е', href: '/ru/letter/е/' },
  { label: 'Ё', href: '/ru/letter/ё/' },
  { label: 'Ж', href: '/ru/letter/ж/' },
]);
assert.deepEqual(items([record(A, 'ru', snapshot('ru', 'ворона', 'Ворона', 'Г'))], 'ru'), [{ label: 'Г', href: '/ru/letter/г/' }]);
assert.deepEqual(items([record(A, 'en', snapshot('en', 'crow', 'Crow', 'D'))], 'en'), [{ label: 'D', href: '/en/letter/d/' }]);
assert.deepEqual(items([
  record(A, 'en', snapshot('en', 'dog', 'Dog', 'D')),
  record(B, 'en', snapshot('en', 'ant', 'Ant', 'A')),
  record(C, 'en', snapshot('en', 'cat', 'Cat', 'C')),
], 'en'), [
  { label: 'A', href: '/en/letter/a/' },
  { label: 'C', href: '/en/letter/c/' },
  { label: 'D', href: '/en/letter/d/' },
]);
assert.deepEqual(items([record(A, 'ru', null, draft)], 'ru'), []);
assert.deepEqual(items([record(A, 'ru', snapshot('ru', 'нуль', 'Null', null))], 'ru'), []);
assert.deepEqual(items([record(A, 'ru', snapshot('ru', 'устаревший', 'Вчера', 'В'), snapshot('ru', 'новый-черновик', 'Новый черновик', 'Н'), 2)], 'ru'), [{ label: 'В', href: '/ru/letter/в/' }]);
assert.deepEqual(items([record(A, 'en', snapshot('en', 'crow', 'Crow', 'C'))], 'ru'), []);

const realRepository = scanContentStore('src/data/content/dreams');
for (const locale of ['ru', 'en']) {
  const expectedGroups = listPublishedAlphabetGroups(realRepository, locale);
  const expected = expectedGroups.map((group) => ({ label: group.alphabet_key, href: `/${locale}/letter/${group.route_key}/` }));
  const actual = listRealLocaleQuickToolsAlphabetItems(locale);
  assert.deepEqual(actual, expected, `${locale} quicktools exactly matches populated canonical published alphabet groups`);
  assert.equal(new Set(actual.map((item) => item.label)).size, actual.length, `${locale} quicktools has no duplicate letters`);
  assert.equal(new Set(actual.map((item) => item.href)).size, actual.length, `${locale} quicktools has no duplicate letter routes`);
  for (const [index, item] of actual.entries()) {
    const group = expectedGroups[index];
    assert.equal(item.label, group.alphabet_key, `${locale} quicktools uses the stored published alphabet key`);
    assert.equal(item.href, `/${locale}/letter/${group.route_key}/`, `${locale} quicktools uses the canonical locale letter route`);
    assert.equal(group.locale, locale, `${locale} quicktools cannot receive another locale's alphabet group`);
  }
  assert.strictEqual(listRealLocaleQuickToolsAlphabetItems(locale), actual, `${locale} real quicktools projection remains memoized`);
}

const quickTools = readFileSync('src/components/QuickTools.astro', 'utf8');
assert.match(quickTools, /ALPHABET, letterPathByLetter, normLetter/);
assert.match(quickTools, /locale === 'hy'/);
assert.match(quickTools, /listRealLocaleQuickToolsAlphabetItems/);
assert.doesNotMatch(quickTools, /classifyAlphabetKey/);
const helper = readFileSync('src/lib/content-source/locale-quicktools-alphabet.mjs', 'utf8');
assert.match(helper, /listLocaleLetterRouteEntries/);
assert.doesNotMatch(helper, /classifyAlphabetKey/);

console.log('LOCALE QUICKTOOLS ALPHABET PASS');
