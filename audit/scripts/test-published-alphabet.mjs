import assert from 'node:assert/strict';
import { listPublishedAlphabetGroups } from '../../src/lib/content-source/published-alphabet.mjs';

const fingerprint = 'a'.repeat(64);
function payload(locale, title, alphabetKey, extra = {}) {
  const { id = title, ...payloadExtra } = extra;
  return {
    slug: extra.slug ?? `${locale}-${id}`.toLowerCase().replace(/\s+/g, '-'), title, description: null,
    content: '<p>published</p>', image_alts: {}, tags: [locale], alphabet_key: alphabetKey,
    based_on_source_revision: 1, based_on_source_fingerprint: fingerprint, version: 1, published_at: '2026-09-14', ...payloadExtra,
  };
}
function record(contentId, locale, published, draft = null, sourceRevision = 1) {
  return {
    content_id: contentId,
    item: { content_id: contentId, schema_version: 1, type: 'dream_dictionary', source_locale: 'hy', source_revision: sourceRevision, source_fingerprint: fingerprint, fingerprint_spec_version: 1 },
    locales: { [locale]: { schema_version: 1, content_id: contentId, locale, draft, published } },
  };
}
function repository(records) { return { records }; }

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';
const D = '11111111-1111-5111-8111-111111111111';

const current = payload('ru', 'Ворона 10', 'Г', { id: 'a', slug: 'ворона-10' });
const outdated = payload('ru', 'Ворона 2', 'Г', { id: 'b', slug: 'ворона-2', based_on_source_revision: 2 });
const nullKey = payload('ru', '123 Ворона', null, { id: 'c', slug: 'ворона-123' });
const draft = { ...payload('ru', 'Черновик', 'Ч', { id: 'draft' }), version: undefined, published_at: undefined };
delete draft.version; delete draft.published_at;
const records = [
  record(A, 'ru', current, draft),
  record(B, 'ru', outdated),
  record(C, 'ru', nullKey),
  record(D, 'ru', null, draft),
  record('22222222-2222-5222-8222-222222222222', 'en', payload('en', 'Crow', 'D', { id: 'en', slug: 'crow' })),
];
const groups = listPublishedAlphabetGroups(repository(records), 'ru');
assert.deepEqual(groups.map((group) => group.alphabet_key), ['Г']);
assert.equal(groups[0].route_key, 'г');
assert.deepEqual(groups[0].entries.map((entry) => entry.slug), ['ворона-2', 'ворона-10']);
assert.equal(JSON.stringify(groups).includes('Черновик'), false);
assert.equal(JSON.stringify(groups).includes('draft'), false);
assert.deepEqual(Object.keys(groups[0].entries[0]).sort(), ['alphabet_key', 'content_id', 'slug', 'title']);

const ruOrder = repository([
  record(A, 'ru', payload('ru', 'Жук', 'Ж', { id: 'z', slug: 'жук' })),
  record(B, 'ru', payload('ru', 'Ёж', 'Ё', { id: 'yo', slug: 'еж' })),
  record(C, 'ru', payload('ru', 'Ель', 'Е', { id: 'e', slug: 'ель' })),
]);
assert.deepEqual(listPublishedAlphabetGroups(ruOrder, 'ru').map((group) => group.alphabet_key), ['Е', 'Ё', 'Ж']);

const ties = repository([
  record(B, 'en', payload('en', 'Álpha', 'A', { id: 'b', slug: 'b' })),
  record(A, 'en', payload('en', 'Alpha', 'A', { id: 'a', slug: 'a' })),
  record(C, 'en', payload('en', 'Alpha', 'A', { id: 'c', slug: 'c' })),
]);
const first = listPublishedAlphabetGroups(ties, 'en');
const second = listPublishedAlphabetGroups(repository([...ties.records].reverse()), 'en');
assert.deepEqual(first, second);
assert.deepEqual(first[0].entries.map((entry) => entry.content_id), [C, A, B]);
assert.deepEqual(listPublishedAlphabetGroups(repository(records), 'en').map((group) => group.alphabet_key), ['D']);
assert.throws(() => listPublishedAlphabetGroups(repository(records), 'hy'));

console.log(`PUBLISHED ALPHABET PROJECTION PASS (Node ${process.version}; ICU ${process.versions.icu ?? 'unknown'})`);
