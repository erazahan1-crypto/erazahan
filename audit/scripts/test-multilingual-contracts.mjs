import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { deriveNextSourceStateOnPublish, deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import {
  applyPublishedSlugReservation,
  assertDraftSlugAvailable,
  localeDocumentFilename,
  localeFromDocumentFilename,
  publicPathFor,
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
const ruPublished = { ...payload('ru', 'son-pro-mordu', { based_on_source_fingerprint: item.source_fingerprint }), version: 1, published_at: '2026-09-14' };
const enPublished = { ...payload('en', 'muzzle-dream-meaning', { based_on_source_fingerprint: item.source_fingerprint }), version: 1, published_at: '2026-09-14' };

assert.equal(publicPathFor('hy', 'erazahan-dunch'), '/erazahan-dunch/');
assert.equal(publicPathFor('ru', 'son-pro-mordu'), '/ru/son-pro-mordu/');
assert.equal(publicPathFor('en', 'muzzle-dream-meaning'), '/en/muzzle-dream-meaning/');
assert.equal(translationSourceLocale('ru'), 'hy');
assert.equal(translationSourceLocale('en'), 'hy');
assert.throws(() => translationSourceLocale('hy'));
assert.throws(() => publicPathFor('de', 'word'));
for (const unsafe of ['', ' word', '.', '..', 'a/b', 'a\\b', 'a?b', 'a#b', 'a%b', 'a%2Fb', 'a%2fb', 'a%5Cb', 'a%5cb', 'a%3Fb', 'a%3fb', 'a%23b', 'a%252Fb', A]) {
  assert.throws(() => publicPathFor('ru', unsafe), `unsafe slug ${unsafe} rejected`);
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

const draftOnlyRu = document('ru', 'draft-ru', { draft: payload('ru', 'draft-ru', { based_on_source_fingerprint: item.source_fingerprint }) });
const publishedRu = document('ru', 'son-pro-mordu', { published: ruPublished });
const bothRu = document('ru', 'son-pro-mordu', { draft: payload('ru', 'new-draft', { based_on_source_fingerprint: item.source_fingerprint }), published: ruPublished });
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
reservations = applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: A, slug: 'son' });
assert.throws(() => applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: B, slug: 'son' }));
reservations = applyPublishedSlugReservation(reservations, { locale: 'en', content_id: B, slug: 'son' });
reservations = applyPublishedSlugReservation(reservations, { locale: 'ru', content_id: A, slug: 'novyi-son' });
assert.deepEqual(resolveReservedSlug(reservations, 'ru', 'son'), { kind: 'redirect', content_id: A, path: '/ru/novyi-son/' });
assert.deepEqual(resolveReservedSlug(reservations, 'ru', 'novyi-son'), { kind: 'active', content_id: A, path: '/ru/novyi-son/' });
assert.throws(() => validateLocaleSlugReservations({ version: 1, reservations: [{ locale: 'ru', slug: 'old', content_id: A, kind: 'redirect' }] }));
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, locale: 'ru', content_id: B, slug: 'son' }));
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, activeDrafts: [{ locale: 'ru', slug: 'draft', content_id: A }], locale: 'ru', content_id: B, slug: 'draft' }));
assert.equal(assertDraftSlugAvailable({ registry: reservations, locale: 'ru', content_id: B, slug: 'temporary-draft' }), true);
const deletedDraftClaims = [{ locale: 'ru', slug: 'released-draft', content_id: A }];
assert.throws(() => assertDraftSlugAvailable({ registry: reservations, activeDrafts: deletedDraftClaims, locale: 'ru', content_id: B, slug: 'released-draft' }));
assert.equal(assertDraftSlugAvailable({ registry: reservations, activeDrafts: [], locale: 'ru', content_id: B, slug: 'released-draft' }), true);
assert.equal(reservations.reservations.some((entry) => entry.locale === 'ru' && entry.slug === 'released-draft'), false, 'deleted draft created no permanent reservation');

let renamedReservations = { version: 1, reservations: [] };
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'a' });
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'b' });
renamedReservations = applyPublishedSlugReservation(renamedReservations, { locale: 'ru', content_id: A, slug: 'c' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'a'), { kind: 'redirect', content_id: A, path: '/ru/c/' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'b'), { kind: 'redirect', content_id: A, path: '/ru/c/' });
assert.deepEqual(resolveReservedSlug(renamedReservations, 'ru', 'c'), { kind: 'active', content_id: A, path: '/ru/c/' });

const documents = [document('hy', 'erazahan-dunch', { published: hyPublished }), publishedRu, document('en', 'muzzle-dream-meaning', { draft: payload('en', 'muzzle-dream-meaning', { based_on_source_fingerprint: item.source_fingerprint }) })];
assert.equal(resolvePublishedContentLink(documents, A, 'ru'), '/ru/son-pro-mordu/');
assert.equal(resolvePublishedContentLink(documents, A, 'en'), null, 'missing or draft EN never falls back to HY');
assert.equal(resolvePublishedContentLink(documents, B, 'ru'), null);

console.log('multilingual v1 contracts: locale, URL, storage, visibility, freshness, reservations, redirects, links, fingerprint PASS');
