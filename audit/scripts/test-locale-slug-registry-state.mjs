import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { claimDraftSlug, validateLocaleDraftSlugClaims } from '../../src/lib/content-write/locale-draft-slug-claims.mjs';
import { validateLocaleSlugReservations } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';

const RESERVATIONS_PATH = 'src/data/content/locale-slug-reservations.v1.json';
const CLAIMS_PATH = 'src/data/content/locale-draft-slug-claims.v1.json';
const STORE_PATH = 'src/data/content/dreams';
const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';

function readRegistry(file, validator, arrayKey) {
  const text = readFileSync(file, 'utf8');
  const registry = JSON.parse(text);
  assert.deepEqual(Object.keys(registry).sort(), [arrayKey, 'version']);
  assert.equal(registry.version, 1);
  assert.ok(Array.isArray(registry[arrayKey]));
  assert.equal(text, canonicalJson(registry), `${file} uses canonical JSON`);
  return validator(registry);
}

function localeDocuments(repository) {
  return repository.records.flatMap((record) => ['ru', 'en'].flatMap((locale) => {
    const document = record.locales[locale];
    return document ? [{ locale, content_id: record.content_id, document }] : [];
  }));
}

function auditRegistryState(repository, reservations, claims) {
  validateLocaleSlugReservations(reservations);
  validateLocaleDraftSlugClaims(claims);
  const documents = localeDocuments(repository);
  const byOwner = new Map(documents.map((entry) => [`${entry.locale}\u0000${entry.content_id}`, entry]));
  const active = new Map(reservations.reservations.filter((entry) => entry.kind === 'active').map((entry) => [`${entry.locale}\u0000${entry.slug}`, entry]));
  const claimBySlug = new Map(claims.claims.map((entry) => [`${entry.locale}\u0000${entry.slug}`, entry]));

  for (const reservation of reservations.reservations) {
    const owner = byOwner.get(`${reservation.locale}\u0000${reservation.content_id}`);
    assert.ok(owner, `reservation ${reservation.locale}/${reservation.slug} has a real locale owner`);
    if (reservation.kind === 'active') {
      assert.equal(owner.document.published?.slug, reservation.slug, `active reservation matches published slug ${reservation.locale}/${reservation.slug}`);
    }
  }
  for (const { locale, content_id: contentId, document } of documents) {
    if (document.published) {
      const reservation = active.get(`${locale}\u0000${document.published.slug}`);
      assert.ok(reservation, `published ${locale}/${document.published.slug} has an active reservation`);
      assert.equal(reservation.content_id, contentId, `published ${locale}/${document.published.slug} has its owner`);
    }
    if (!document.published && document.draft) {
      const claim = claimBySlug.get(`${locale}\u0000${document.draft.slug}`);
      assert.ok(claim, `draft-only ${locale}/${document.draft.slug} has a claim`);
      assert.equal(claim.content_id, contentId, `draft-only ${locale}/${document.draft.slug} has its owner`);
    }
  }
  for (const claim of claims.claims) {
    const owner = byOwner.get(`${claim.locale}\u0000${claim.content_id}`);
    assert.ok(owner, `draft claim ${claim.locale}/${claim.slug} has a real locale owner`);
    assert.equal(owner.document.published, null, `draft claim ${claim.locale}/${claim.slug} belongs only to a draft-only document`);
    assert.equal(owner.document.draft?.slug, claim.slug, `draft claim ${claim.locale}/${claim.slug} matches draft slug`);
    const permanent = reservations.reservations.find((entry) => entry.locale === claim.locale && entry.slug === claim.slug);
    assert.ok(!permanent || permanent.content_id === claim.content_id, `draft claim ${claim.locale}/${claim.slug} does not conflict with permanent ownership`);
  }
  return { documents, active, claimBySlug };
}

const reservations = readRegistry(RESERVATIONS_PATH, validateLocaleSlugReservations, 'reservations');
const claims = readRegistry(CLAIMS_PATH, validateLocaleDraftSlugClaims, 'claims');
const repository = scanContentStore(STORE_PATH);
const real = auditRegistryState(repository, reservations, claims);

assert.equal(repository.counts.hy_documents, 5800);
assert.equal(repository.counts.ru_documents, 0);
assert.equal(repository.counts.en_documents, 0);
assert.equal(real.documents.filter(({ document }) => document.published).length, 0);
assert.equal(real.documents.filter(({ document }) => document.draft).length, 0);
assert.equal(reservations.reservations.length, 0);
assert.equal(claims.claims.length, 0);

const publishedRu = { locale: 'ru', content_id: A, document: { published: { slug: 'ворона' }, draft: null } };
const draftOnlyRu = { locale: 'ru', content_id: A, document: { published: null, draft: { slug: 'ворона' } } };
const publishedWithDraftRu = { locale: 'ru', content_id: A, document: { published: { slug: 'ворона' }, draft: { slug: 'ворона' } } };
const fixture = (documents, publishedReservations = [], draftClaims = []) => ({
  records: documents.map(({ locale, content_id: contentId, document }) => ({ content_id: contentId, locales: { [locale]: document } })),
  counts: {},
});
const validReservations = (entries) => ({ version: 1, reservations: entries });
const validClaims = (entries) => ({ version: 1, claims: entries });

assert.throws(() => auditRegistryState(fixture([publishedRu]), validReservations([]), validClaims([])), /has an active reservation/);
assert.throws(() => auditRegistryState(fixture([publishedRu, { ...publishedRu, content_id: B }]), validReservations([{ locale: 'ru', slug: 'ворона', content_id: B, kind: 'active' }]), validClaims([])), /has its owner/);
assert.throws(() => auditRegistryState(fixture([]), validReservations([{ locale: 'ru', slug: 'ворона', content_id: A, kind: 'active' }]), validClaims([])), /real locale owner/);
assert.throws(() => auditRegistryState(fixture([draftOnlyRu]), validReservations([]), validClaims([])), /has a claim/);
assert.throws(() => auditRegistryState(fixture([draftOnlyRu]), validReservations([]), validClaims([{ locale: 'ru', slug: 'ворона', content_id: B }])), /has its owner/);
assert.throws(() => auditRegistryState(fixture([]), validReservations([]), validClaims([{ locale: 'ru', slug: 'ворона', content_id: A }])), /real locale owner/);
assert.doesNotThrow(() => auditRegistryState(fixture([publishedWithDraftRu]), validReservations([{ locale: 'ru', slug: 'ворона', content_id: A, kind: 'active' }]), validClaims([])));
assert.throws(() => auditRegistryState(fixture([draftOnlyRu, { ...publishedRu, content_id: B }]), validReservations([{ locale: 'ru', slug: 'ворона', content_id: B, kind: 'active' }]), validClaims([{ locale: 'ru', slug: 'ворона', content_id: A }])), /does not conflict/);
assert.doesNotThrow(() => claimDraftSlug({ registry: validClaims([]), publishedReservations: validReservations([{ locale: 'ru', slug: 'ворона', content_id: A, kind: 'active' }]), locale: 'ru', slug: 'ворона', content_id: A }));

for (const invalid of [
  { version: 2, reservations: [] }, { version: 1 }, [],
  { version: 1, reservations: [{ locale: 'ru', slug: 'ворона', content_id: A, kind: 'active' }, { locale: 'ru', slug: 'ворона', content_id: B, kind: 'active' }] },
  { version: 1, reservations: [{ locale: 'de', slug: 'word', content_id: A, kind: 'active' }] },
  { version: 1, reservations: [{ locale: 'ru', slug: 'Ворона', content_id: A, kind: 'active' }] },
  { version: 1, reservations: [{ locale: 'en', slug: 'word', content_id: 'bad', kind: 'active' }] },
]) assert.throws(() => validateLocaleSlugReservations(invalid));
for (const invalid of [
  { version: 2, claims: [] }, { version: 1 }, [],
  { version: 1, claims: [{ locale: 'en', slug: 'word', content_id: A }, { locale: 'en', slug: 'word', content_id: B }] },
  { version: 1, claims: [{ locale: 'de', slug: 'word', content_id: A }] },
  { version: 1, claims: [{ locale: 'ru', slug: 'Ворона', content_id: A }] },
  { version: 1, claims: [{ locale: 'en', slug: 'word', content_id: 'bad' }] },
]) assert.throws(() => validateLocaleDraftSlugClaims(invalid));

console.log('LOCALE SLUG REGISTRY STATE PASS');
