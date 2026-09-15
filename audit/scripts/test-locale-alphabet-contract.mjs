import assert from 'node:assert/strict';
import {
  allowedAlphabetKeys,
  canonicalAlphabetRouteKey,
  classifyAlphabetKey,
  validateStoredAlphabetKey,
} from '../../src/lib/content-schema/locale-alphabet.mjs';
import { assertLocalePublicSlug } from '../../src/lib/content-schema/multilingual-contract.mjs';

assert.deepEqual(allowedAlphabetKeys('ru'), ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ё', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я']);
assert.deepEqual(allowedAlphabetKeys('en'), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
assert.notEqual(classifyAlphabetKey('ru', 'Ель'), classifyAlphabetKey('ru', 'Ёж'));

assert.equal(classifyAlphabetKey('ru', 'Ворона'), 'В');
assert.equal(classifyAlphabetKey('ru', '  — Ёж'), 'Ё');
for (const title of ['123 Ворона', '🪶 Ворона', 'Crow']) assert.equal(classifyAlphabetKey('ru', title), null);
assert.equal(classifyAlphabetKey('en', 'Crow'), 'C');
assert.equal(classifyAlphabetKey('en', '“Crow”'), 'C');
assert.equal(classifyAlphabetKey('en', 'Éagle'), 'E');
for (const title of ['123 Crow', '🪶 Crow', 'Ворона']) assert.equal(classifyAlphabetKey('en', title), null);

assert.equal(validateStoredAlphabetKey('ru', 'Ворона во сне', 'В'), 'В');
assert.equal(validateStoredAlphabetKey('ru', 'Ворона во сне', 'Г'), 'Г');
assert.equal(validateStoredAlphabetKey('ru', 'Ворона во сне', null), null);
for (const key of ['в', 'A', '']) assert.throws(() => validateStoredAlphabetKey('ru', 'Ворона во сне', key));
assert.equal(validateStoredAlphabetKey('en', 'Crow Dream Meaning', 'C'), 'C');
assert.equal(validateStoredAlphabetKey('en', 'Crow Dream Meaning', 'D'), 'D');
assert.equal(validateStoredAlphabetKey('en', 'Crow Dream Meaning', null), null);
for (const key of ['c', 'В', '']) assert.throws(() => validateStoredAlphabetKey('en', 'Crow Dream Meaning', key));
assert.equal(validateStoredAlphabetKey('ru', '123 Ворона', null), null);
assert.equal(validateStoredAlphabetKey('ru', '123 Ворона', 'В'), 'В');
assert.equal(validateStoredAlphabetKey('en', '🪶 Crow', null), null);
assert.equal(validateStoredAlphabetKey('en', '🪶 Crow', 'C'), 'C');

for (const [locale, slug] of [['ru', 'search'], ['ru', 'letter'], ['en', 'search'], ['en', 'letter'], ['en', 'search-index.json']]) {
  assert.throws(() => assertLocalePublicSlug(locale, slug));
}
assert.equal(assertLocalePublicSlug('en', 'searching'), 'searching');
assert.equal(assertLocalePublicSlug('en', 'letter-a'), 'letter-a');
assert.equal(assertLocalePublicSlug('ru', 'поиск'), 'поиск');
assert.equal(canonicalAlphabetRouteKey('ru', 'В'), 'в');
assert.equal(canonicalAlphabetRouteKey('ru', 'Ё'), 'ё');
assert.equal(canonicalAlphabetRouteKey('en', 'C'), 'c');
assert.throws(() => canonicalAlphabetRouteKey('hy', 'Ա'));

console.log('LOCALE ALPHABET CONTRACT PASS');
