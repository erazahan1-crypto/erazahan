import assert from 'node:assert/strict';
import { listLocaleLetterRouteEntries } from '../../src/lib/content-source/locale-letter-routes.mjs';
import { publicPathFor } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { readFileSync } from 'node:fs';

const fingerprint = 'a'.repeat(64);
const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';

function published(locale, slug, title, alphabetKey, extra = {}) {
  return { slug, title, description: null, content: '<p>published</p>', image_alts: {}, tags: [locale], alphabet_key: alphabetKey,
    based_on_source_revision: extra.based_on_source_revision ?? 1, based_on_source_fingerprint: fingerprint, version: 1, published_at: '2026-09-14' };
}
function record(contentId, locale, snapshot, draft = null) {
  return { content_id: contentId,
    item: { content_id: contentId, schema_version: 1, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: fingerprint, fingerprint_spec_version: 1 },
    locales: { [locale]: { schema_version: 1, content_id: contentId, locale, draft, published: snapshot } } };
}
const repo = (records) => ({ records });
const draft = { slug: 'черновик', title: 'Черновик', description: null, content: '<p>draft</p>', image_alts: {}, tags: ['ru'], alphabet_key: 'Ч', based_on_source_revision: 1, based_on_source_fingerprint: fingerprint };

assert.deepEqual(listLocaleLetterRouteEntries(repo([]), 'ru'), []);
assert.deepEqual(listLocaleLetterRouteEntries(repo([]), 'en'), []);

const ru = listLocaleLetterRouteEntries(repo([
  record(A, 'ru', published('ru', 'ворона', 'Ворона', 'В')),
  record(B, 'ru', published('ru', 'еж', 'Ёж', 'Ё')),
  record(C, 'ru', published('ru', 'ворона-старая', 'Ворона старая', 'Г', { based_on_source_revision: 2 }), draft),
] ), 'ru');
assert.deepEqual(ru.map((route) => route.path), ['/ru/letter/в/', '/ru/letter/г/', '/ru/letter/ё/']);
assert.equal(ru.some((route) => route.path === '/ru/letter/В/'), false);
assert.equal(ru.find((route) => route.group.alphabet_key === 'Ё')?.path, '/ru/letter/ё/');
assert.equal(ru.find((route) => route.group.alphabet_key === 'Г')?.path, '/ru/letter/г/');
assert.equal(ru.find((route) => route.group.alphabet_key === 'Г')?.group.entries[0].slug, 'ворона-старая');
assert.equal(publicPathFor('ru', ru[0].group.entries[0].slug), '/ru/ворона/');

const en = listLocaleLetterRouteEntries(repo([
  record(A, 'en', published('en', 'crow', 'Crow', 'C')),
  record(B, 'en', published('en', 'crow-override', 'Crow override', 'D')),
] ), 'en');
assert.deepEqual(en.map((route) => route.path), ['/en/letter/c/', '/en/letter/d/']);
assert.equal(publicPathFor('en', en[0].group.entries[0].slug), '/en/crow/');
assert.deepEqual(listLocaleLetterRouteEntries(repo([record(A, 'ru', null, draft)]), 'ru'), []);
assert.deepEqual(listLocaleLetterRouteEntries(repo([record(A, 'ru', published('ru', 'нуль', '123 Ворона', null))]), 'ru'), []);
assert.deepEqual(listLocaleLetterRouteEntries(repo([record(A, 'en', published('en', 'crow', 'Crow', 'C'))]), 'ru'), []);

const ruPage = readFileSync('src/pages/ru/letter/[key].astro', 'utf8');
const enPage = readFileSync('src/pages/en/letter/[key].astro', 'utf8');
for (const source of [ruPage, enPage]) {
  assert.match(source, /alternates=\{\[\]\}/);
  assert.match(source, /robots="noindex, follow"/);
  assert.match(source, /listLocaleLetterRouteEntries/);
}
assert.match(ruPage, /Сны на букву «\$\{group\.alphabet_key\}»/);
assert.match(ruPage, /Толкования снов на букву «\$\{group\.alphabet_key\}»\./);
assert.match(ruPage, /homeLabel="Главная"/);
assert.match(enPage, /Dreams Starting with “\$\{group\.alphabet_key\}”/);
assert.match(enPage, /Dream meanings starting with the letter “\$\{group\.alphabet_key\}”\./);
assert.match(enPage, /homeLabel="Home"/);

console.log('LOCALE LETTER ROUTES PASS');
