import assert from 'node:assert/strict';
import {
  DRAFT_SLUG_CLAIMS_VERSION, assertDraftSlugClaimOwner, claimDraftSlug, getDraftSlugOwner, releaseDraftSlug, validateLocaleDraftSlugClaims,
} from '../../src/lib/content-write/locale-draft-slug-claims.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242'; const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const empty = { version: DRAFT_SLUG_CLAIMS_VERSION, claims: [] };
const reservations = { version: 1, reservations: [] };
assert.deepEqual(validateLocaleDraftSlugClaims(empty), empty);
assert.throws(() => validateLocaleDraftSlugClaims({ version: 1, claims: [{ locale: 'hy', slug: 'a', content_id: A }] }));
assert.throws(() => validateLocaleDraftSlugClaims({ version: 1, claims: [{ locale: 'ru', slug: 'Ворона', content_id: A }] }));
assert.throws(() => validateLocaleDraftSlugClaims({ version: 1, claims: [{ locale: 'ru', slug: 'search', content_id: A }] }));
assert.throws(() => validateLocaleDraftSlugClaims({ version: 1, claims: [{ locale: 'en', slug: 'a', content_id: 'bad' }] }));
assert.throws(() => validateLocaleDraftSlugClaims({ version: 1, claims: [{ locale: 'en', slug: 'a', content_id: A }, { locale: 'en', slug: 'a', content_id: A }] }));
const source = { version: 1, claims: [{ locale: 'ru', slug: 'я', content_id: A }, { locale: 'en', slug: 'z', content_id: B }] };
const sorted = validateLocaleDraftSlugClaims(source); assert.deepEqual(sorted.claims.map((x) => `${x.locale}/${x.slug}`), ['en/z', 'ru/я']); assert.deepEqual(source.claims.map((x) => x.slug), ['я', 'z']);
const claimed = claimDraftSlug({ registry: empty, publishedReservations: reservations, locale: 'ru', slug: 'ворона', content_id: A });
assert.equal(getDraftSlugOwner(claimed, { locale: 'ru', slug: 'ворона' }), A);
assert.equal(assertDraftSlugClaimOwner(claimed, { locale: 'ru', slug: 'ворона', content_id: A }), true);
assert.throws(() => assertDraftSlugClaimOwner(empty, { locale: 'ru', slug: 'ворона', content_id: A }), (e) => e.code === 'DRAFT_INVALID');
assert.throws(() => assertDraftSlugClaimOwner(claimed, { locale: 'ru', slug: 'ворона', content_id: B }), (e) => e.code === 'SLUG_CLAIMED');
assert.deepEqual(claimDraftSlug({ registry: claimed, publishedReservations: reservations, locale: 'ru', slug: 'ворона', content_id: A }), claimed);
assert.throws(() => claimDraftSlug({ registry: claimed, publishedReservations: reservations, locale: 'ru', slug: 'ворона', content_id: B }), (e) => e.code === 'SLUG_CLAIMED');
assert.throws(() => releaseDraftSlug({ registry: claimed, locale: 'ru', slug: 'ворона', content_id: B }), (e) => e.code === 'SLUG_CLAIMED');
assert.equal(getDraftSlugOwner(releaseDraftSlug({ registry: claimed, locale: 'ru', slug: 'ворона', content_id: A }), { locale: 'ru', slug: 'ворона' }), null);
const permanent = { version: 1, reservations: [{ locale: 'ru', slug: 'сон', content_id: A, kind: 'active' }] };
assert.throws(() => claimDraftSlug({ registry: empty, publishedReservations: permanent, locale: 'ru', slug: 'сон', content_id: B }), (e) => e.code === 'SLUG_PERMANENTLY_RESERVED');
assert.equal(getDraftSlugOwner(claimDraftSlug({ registry: empty, publishedReservations: permanent, locale: 'ru', slug: 'сон', content_id: A }), { locale: 'ru', slug: 'сон' }), A);
assert.equal(getDraftSlugOwner(claimDraftSlug({ registry: empty, publishedReservations: reservations, locale: 'en', slug: 'ворона', content_id: B }), { locale: 'ru', slug: 'ворона' }), null);
console.log('LOCALE DRAFT SLUG CLAIMS PASS');
