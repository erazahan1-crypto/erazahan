import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { deriveNextSourceStateOnPublish, deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import {
  applyPublishedSlugReservation,
  assertDraftSlugAvailable,
  assertRuPublicSlug,
  localeDocumentFilename,
  localeFromDocumentFilename,
  publicPathFor,
  normalizeRuSlug,
  resolvePublishedContentLink,
  resolveReservedSlug,
  selectPublicLocaleDocument,
  translationSourceLocale,
  validateLocaleDocumentStorage,
  validateLocaleSlugReservations,
} from '../../src/lib/content-schema/multilingual-contract.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const fingerprint = 'a'.repeat(64);

function payload(locale, slug, overrides = {}) {
  return {
    slug, title: `${locale} title`, description: null, content: `<p>${locale}</p>`, image_alts: {}, tags: [locale], alphabet_key: null,
    based_on_source_revision: locale === 'hy' ? null : 1,
    based_on_source_fingerprint: locale === 'hy' ? null : fingerprint,
    ...overrides,
  };
}
function document(locale, slug, { draft = null, published = null } = {}) {
  return { schema_version: 1, content_id: A, locale, draft, published };
}
const hyPublished = { ...payload('hy', 'erazahan-dunch'), version: 1, published_at: '2026-09-14' };
const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hyPublished), fingerprint_spec_version: 1 };
const ruPublished = { ...payload('ru', 'сон-про-морду', { based_on_source_fingerprint: item.source_fingerprint }), version: 1, published_at: '2026-09-14' };
const enPublished = { ...payload('en', 'muzzle-dream-meaning', { based_on_source_fingerprint: item.source_fingerprint }), version: 1, published_at: '2026-09-14' };

assert.equal(publicPathFor('hy', 'erazahan-dunch'), '/erazahan-dunch/');
assert.equal(publicPathFor('ru', 'сон-про-морду'), '/ru/сон-про-морду/');
assert.equal(publicPathFor('en', 'muzzle-dream-meaning'), '/en/muzzle-dream-meaning/');
assert.equal(translationSourceLocale('ru'), 'hy');
assert.equal(translationSourceLocale('en'), 'hy');
assert.throws(() => translationSourceLocale('hy'));
assert.throws(() => publicPathFor('de', 'word'));
for (const unsafe of ['', ' word', '.', '..', 'a/b', 'a\\b', 'a?b', 'a#b', 'a%b', 'a%2Fb', 'a%2fb', 'a%5Cb', 'a%5cb', 'a%3Fb', 'a%3fb', 'a%23b', 'a%252Fb', A]) {
  assert.throws(() => publicPathFor('ru', unsafe), `unsafe slug ${unsafe} rejected`);
}

assert.equal(normalizeRuSlug('Ворона Во Сне'), 'ворона-во-сне');
assert.equal(normalizeRuSlug('Ёлка'), 'елка');
assert.equal(normalizeRuSlug('  море   во сне  '), 'море-во-сне');
assert.equal(normalizeRuSlug('ворона---во-сне'), 'ворона-во-сне');
for (const valid of ['ворона', 'ворона-во-сне', 'елка', 'сон-2026']) assert.equal(assertRuPublicSlug(valid), valid);
for (const invalid of ['Ворона', 'ёлка', 'vorona', 'ворона_во_сне', 'ворона во сне', 'ворона--во-сне', '-ворона', 'ворона-', 'ворона%20сне', 'ворона/сон', 'ворона\\сон', 'ворона?сон', 'ворона#сон']) {
  assert.throws(() => assertRuPublicSlug(invalid), `invalid stored RU slug ${invalid} rejected`);
}

const currentHyPosts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
assert.equal(currentHyPosts.length, 5800, 'current HY corpus has 5800 posts');
for (const post of currentHyPosts) {
  assert.equal(publicPathFor('hy', post.slug), `/${post.slug}/`, `HY path remains unchanged for ${post.slug}`);
}

for (const locale of ['hy', 'ru', 'en']) {
  const filename = localeDocumentFilename(locale);
  assert.equal(localeFromDocumentFilename(filename), locale);
  validateLocaleDocumentStorage({ item, filename, localeDocument: document(locale, `${locale}-slug`, { published: locale === 'hy' ? hyPublished : locale === 'ru' ? ruPublished : enPublished }) });
}
assert.throws(() => localeFromDocumentFilename('de.json'));
assert.throws(() => validateLocaleDocumentStorage({ item, filename: 'ru.json', localeDocument: document('en', 'en-slug', { published: enPublished }) }));
assert.throws(() => validateLocaleDocumentStorage({
  item,
  filename: 'ru.json',
  localeDocument: document('ru', 'ignored', { draft: payload('ru', 'Ворона', { based_on_source_fingerprint: item.source_fingerprint }) }),
}), 'stored non-canonical RU draft is rejected at the locale-document boundary');

const draftOnlyRu = document('ru', 'черновик-ру', { draft: payload('ru', 'черновик-ру', { based_on_source_fingerprint: item.source_fingerprint }) });
const publishedRu = document('ru', 'сон-про-морду', { published: ruPublished });
const bothRu = document('ru', 'сон-про-морду', { draft: payload('ru', 'новый-черновик', { based_on_source_fingerprint: item.source_fingerprint }), published: ruPublished });
assert.equal(selectPublicLocaleDocument(draftOnlyRu), null);
assert.equal(selectPublicLocaleDocument(publishedRu), ruPublished);
assert.equal(selectPublicLocaleDocument(bothRu), ruPublished);
assert.equal(deriveTranslationState(publishedRu, item).state, 'CURRENT');
const outdatedRu = { ...publishedRu, published: { ...ruPublished, based_on_source_revision: 2 } };
assert.equal(deriveTranslationState(outdatedRu, item).state, 'OUTDATED');
const fingerprintOutdatedRu = { ...publishedRu, published: { ...ruPublished, based_on_source_fingerprint: 'b'.repeat(64) } };
assert.equal(deriveTranslationState(fingerprintOutdatedRu, item).state, 'OUTDATED');
assert.equal(selectPublicLocaleDocument(outdatedRu), outdatedRu.published, 'outdated published translation remains public');

const slugOnly = { ...hyPublished, slug: 'renamed-hy-slug' };
assert.equal(sourceFingerprintV1(hyPublished), sourceFingerprintV1(slugOnly));
const afterSlugOnly = deriveNextSourceStateOnPublish(item, slugOnly);
assert.equal(afterSlugOnly.changed, false);
assert.equal(deriveTranslationState(publishedRu, {
  ...item,
  source_revision: afterSlugOnly.source_revision,
  source_fingerprint: afterSlugOnly.source_fingerprint,
}).state, 'CURRENT');
assert.notEqual(sourceFingerprintV1(hyPublished), sourceFingerprintV1({ ...hyPublished, content: '<p>changed</p>' }));

let reservations = { version: 1, reservations: [] };
reservations = applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: A, slug: 'сон' });
assert.throws(() => applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: B, slug: 'сон' }));
reservations = applyPublishedSlugReservation(reservations, { locale: 'en', content_id: B, slug: 'son' });
reservations = applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: A, slug: 'новый-сон' });
assert.deepEqual(resolveReservedSlug(reservations, 'ru', 'сон'), { kind: 'redirect', content_id: A, path: '/ru/новый-сон/' });
assert.deepEqual(resolveReservedSlug(reservations, 'ru', 'новый-сон'), { kind: 'active', content_id: A, path: '/ru/новый-сон/' });
assert.throws(() => validateLocaleSlugReservations({ version: 1, reservations: [{ locale: 'ru', slug: 'старый', content_id: A, kind: 'redirect' }] }));
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, locale: 'ru', content_id: B, slug: 'сон' }));
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, activeDrafts: [{ locale: 'ru', slug: 'черновик', content_id: A }], locale: 'ru', content_id: B, slug: 'черновик' }));
assert.equal(assertDraftSlugAvailable({ registry: reservations, locale: 'ru', content_id: B, slug: 'временный-черновик' }), true);
const deletedDraftClaims = [{ locale: 'ru', slug: 'освобожденный-черновик', content_id: A }];
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, activeDrafts: deletedDraftClaims, locale: 'ru', content_id: B, slug: 'освобожденный-черновик' }));
assert.equal(assertDraftSlugAvailable({ registry: reservations, activeDrafts: [], locale: 'ru', content_id: B, slug: 'освобожденный-черновик' }), true);
assert.equal(reservations.reservations.some((entry) => entry.locale === 'ru' && entry.slug === 'освобожденный-черновик'), false, 'deleted draft created no permanent reservation');

let renamedReservations = { version: 1, reservations: [] };
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'а' });
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'б' });
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'в' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'а'), { kind: 'redirect', content_id: A, path: '/ru/в/' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'б'), { kind: 'redirect', content_id: A, path: '/ru/в/' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'в'), { kind: 'active', content_id: A, path: '/ru/в/' });

const documents = [document('hy', 'erazahan-dunch', { published: hyPublished }), publishedRu, document('en', 'muzzle-dream-meaning', { draft: payload('en', 'muzzle-dream-meaning', { based_on_source_fingerprint: item.source_fingerprint }) })];
assert.equal(resolvePublishedContentLink(documents, A, 'ru'), '/ru/сон-про-морду/');
assert.equal(resolvePublishedContentLink(documents, A, 'en'), null, 'missing or draft EN never falls back to HY');
assert.equal(resolvePublishedContentLink(documents, B, 'ru'), null);

console.log('multilingual v1 contracts: locale, URL, storage, visibility, freshness, reservations, redirects, links, fingerprint PASS');
