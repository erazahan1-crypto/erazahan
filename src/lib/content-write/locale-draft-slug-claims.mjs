import { isContentId } from '../content-schema/schema.mjs';
import { assertLocalePublicSlug, validateLocaleSlugReservations } from '../content-schema/multilingual-contract.mjs';

export const DRAFT_SLUG_CLAIMS_VERSION = 1;

export class LocaleDraftSlugClaimError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function fail(code, message) { throw new LocaleDraftSlugClaimError(code, message); }
function assertLocale(locale) {
  if (locale !== 'ru' && locale !== 'en') fail('LOCALE_UNSUPPORTED', 'Locale writer supports only ru and en');
}
function assertSlug(locale, slug) {
  try { assertLocalePublicSlug(locale, slug); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message.includes('reserved') ? 'SLUG_RESERVED' : 'SLUG_INVALID', message);
  }
}
function assertContentId(contentId) { if (!isContentId(contentId)) fail('CONTENT_NOT_FOUND', 'content_id is invalid'); }
function sorted(claims) { return [...claims].sort((a, b) => a.locale.localeCompare(b.locale) || a.slug.localeCompare(b.slug) || a.content_id.localeCompare(b.content_id)); }

export function validateLocaleDraftSlugClaims(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) || registry.version !== DRAFT_SLUG_CLAIMS_VERSION || !Array.isArray(registry.claims) || Object.keys(registry).length !== 2) {
    fail('DRAFT_INVALID', 'Draft slug claim registry must contain version 1 and claims');
  }
  const seen = new Set();
  for (const claim of registry.claims) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) || JSON.stringify(Object.keys(claim).sort()) !== JSON.stringify(['content_id', 'locale', 'slug'])) fail('DRAFT_INVALID', 'Draft slug claim shape is invalid');
    assertLocale(claim.locale); assertSlug(claim.locale, claim.slug); assertContentId(claim.content_id);
    const key = `${claim.locale}\u0000${claim.slug}`;
    if (seen.has(key)) fail('DRAFT_INVALID', `Duplicate draft claim ${claim.locale}/${claim.slug}`);
    seen.add(key);
  }
  return Object.freeze({ version: DRAFT_SLUG_CLAIMS_VERSION, claims: Object.freeze(sorted(registry.claims).map((claim) => Object.freeze({ ...claim }))) });
}

export function getDraftSlugOwner(registry, { locale, slug }) {
  const valid = validateLocaleDraftSlugClaims(registry); assertLocale(locale); assertSlug(locale, slug);
  return valid.claims.find((claim) => claim.locale === locale && claim.slug === slug)?.content_id ?? null;
}

export function assertDraftSlugClaimOwner(registry, { locale, slug, content_id: contentId }) {
  const owner = getDraftSlugOwner(registry, { locale, slug });
  assertContentId(contentId);
  if (!owner) fail('DRAFT_INVALID', `Draft slug ${locale}/${slug} has no required claim`);
  if (owner !== contentId) fail('SLUG_CLAIMED', `Draft slug ${locale}/${slug} is owned by another draft`);
  return true;
}

function assertPermanentOwner(publishedReservations, locale, slug, contentId) {
  validateLocaleSlugReservations(publishedReservations);
  const owner = publishedReservations.reservations.find((entry) => entry.locale === locale && entry.slug === slug)?.content_id;
  if (owner && owner !== contentId) fail('SLUG_PERMANENTLY_RESERVED', `Slug ${locale}/${slug} is permanently reserved`);
}

export function claimDraftSlug({ registry, publishedReservations, locale, slug, content_id: contentId }) {
  const valid = validateLocaleDraftSlugClaims(registry); assertLocale(locale); assertSlug(locale, slug); assertContentId(contentId);
  assertPermanentOwner(publishedReservations, locale, slug, contentId);
  const owner = getDraftSlugOwner(valid, { locale, slug });
  if (owner && owner !== contentId) fail('SLUG_CLAIMED', `Slug ${locale}/${slug} is claimed by another draft`);
  if (owner === contentId) return valid;
  return validateLocaleDraftSlugClaims({ version: DRAFT_SLUG_CLAIMS_VERSION, claims: [...valid.claims, { locale, slug, content_id: contentId }] });
}

export function releaseDraftSlug({ registry, locale, slug, content_id: contentId }) {
  const valid = validateLocaleDraftSlugClaims(registry); assertLocale(locale); assertSlug(locale, slug); assertContentId(contentId);
  const owner = getDraftSlugOwner(valid, { locale, slug });
  if (!owner) return valid;
  if (owner !== contentId) fail('SLUG_CLAIMED', `Slug ${locale}/${slug} is owned by another draft`);
  return validateLocaleDraftSlugClaims({ version: DRAFT_SLUG_CLAIMS_VERSION, claims: valid.claims.filter((claim) => !(claim.locale === locale && claim.slug === slug)) });
}
