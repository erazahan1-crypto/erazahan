import {
  CONTENT_LOCALES,
  SOURCE_LOCALE,
  isContentId,
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from './schema.mjs';
import { selectPublishedLocale } from './state.mjs';

export const LOCALE_RESERVATION_VERSION = 1;
export const LOCALE_RESERVATION_KINDS = Object.freeze(['active', 'redirect']);
const LOCALE_DOCUMENT_FILENAMES = Object.freeze(
  Object.fromEntries(CONTENT_LOCALES.map((locale) => [`${locale}.json`, locale])),
);

function fail(message) {
  throw new TypeError(`Multilingual content contract: ${message}`);
}

export function assertSupportedLocale(locale) {
  if (!CONTENT_LOCALES.includes(locale)) fail(`unsupported locale ${JSON.stringify(locale)}`);
  return locale;
}

export function translationSourceLocale(locale) {
  assertSupportedLocale(locale);
  if (locale === SOURCE_LOCALE) fail('HY is the source locale and is not translated from another locale');
  return SOURCE_LOCALE;
}

export function assertPublicSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim() || slug !== slug.trim()) fail('slug must be a trimmed non-empty string');
  if (/[\\/\\?#%\u0000-\u001f\u007f\s]/.test(slug) || slug === '.' || slug === '..') fail('slug is not a safe URL segment');
  if (isContentId(slug)) fail('content_id must not be used as a public URL segment');
  return slug;
}

export function publicPathFor(locale, slug) {
  assertSupportedLocale(locale);
  assertPublicSlug(slug);
  return locale === SOURCE_LOCALE ? `/${slug}/` : `/${locale}/${slug}/`;
}

export function localeDocumentFilename(locale) {
  assertSupportedLocale(locale);
  return `${locale}.json`;
}

export function localeFromDocumentFilename(filename) {
  if (typeof filename !== 'string') fail('locale document filename must be a string');
  const locale = LOCALE_DOCUMENT_FILENAMES[filename];
  if (!locale) fail(`unsupported locale document filename ${JSON.stringify(filename)}`);
  return locale;
}

export function validateLocaleDocumentStorage({ item, filename, localeDocument }) {
  const locale = localeFromDocumentFilename(filename);
  validateContentItem(item);
  validateLocaleDocument(localeDocument);
  validateItemLocaleRelation(item, localeDocument);
  if (localeDocument.locale !== locale) fail(`${filename} must contain locale=${locale}`);
  return localeDocument;
}

// Public consumers must use this predicate rather than inspecting draft state.
export function selectPublicLocaleDocument(localeDocument) {
  return selectPublishedLocale(localeDocument);
}

function reservationKey(locale, slug) {
  return `${locale}\u0000${slug}`;
}

function validateReservation(reservation) {
  if (!reservation || typeof reservation !== 'object' || Array.isArray(reservation)) fail('reservation must be an object');
  const keys = Object.keys(reservation).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['content_id', 'kind', 'locale', 'slug'])) {
    fail('reservation must contain only locale, slug, content_id, and kind');
  }
  assertSupportedLocale(reservation.locale);
  assertPublicSlug(reservation.slug);
  if (!isContentId(reservation.content_id)) fail('reservation content_id is invalid');
  if (!LOCALE_RESERVATION_KINDS.includes(reservation.kind)) fail('reservation kind must be active or redirect');
  return reservation;
}

export function validateLocaleSlugReservations(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('reservation registry must be an object');
  if (registry.version !== LOCALE_RESERVATION_VERSION || !Array.isArray(registry.reservations)
    || Object.keys(registry).length !== 2) {
    fail('reservation registry must contain version 1 and reservations');
  }
  const seen = new Set();
  const activeByContentLocale = new Set();
  for (const reservation of registry.reservations) {
    validateReservation(reservation);
    const key = reservationKey(reservation.locale, reservation.slug);
    if (seen.has(key)) fail(`duplicate reservation for ${reservation.locale}/${reservation.slug}`);
    seen.add(key);
    if (reservation.kind === 'active') {
      const activeKey = reservationKey(reservation.locale, reservation.content_id);
      if (activeByContentLocale.has(activeKey)) fail(`multiple active slugs for ${reservation.locale}/${reservation.content_id}`);
      activeByContentLocale.add(activeKey);
    }
  }
  for (const reservation of registry.reservations.filter((entry) => entry.kind === 'redirect')) {
    const hasTarget = registry.reservations.some((entry) => entry.kind === 'active'
      && entry.locale === reservation.locale && entry.content_id === reservation.content_id);
    if (!hasTarget) fail(`redirect ${reservation.locale}/${reservation.slug} has no same-locale active target`);
  }
  return registry;
}

export function applyPublishedSlugReservation(registry, { locale, content_id: contentId, slug }) {
  validateLocaleSlugReservations(registry);
  assertSupportedLocale(locale);
  assertPublicSlug(slug);
  if (!isContentId(contentId)) fail('content_id is invalid');

  const existing = registry.reservations.find((entry) => entry.locale === locale && entry.slug === slug);
  if (existing && existing.content_id !== contentId) fail(`slug ${locale}/${slug} is permanently reserved to another content_id`);

  const retained = registry.reservations.map((entry) => (
    entry.kind === 'active' && entry.locale === locale && entry.content_id === contentId && entry.slug !== slug
      ? { ...entry, kind: 'redirect' }
      : entry
  ));
  const next = existing
    ? retained.map((entry) => entry === existing ? { ...entry, kind: 'active' } : entry)
    : [...retained, { locale, slug, content_id: contentId, kind: 'active' }];
  const result = { version: LOCALE_RESERVATION_VERSION, reservations: next };
  return validateLocaleSlugReservations(result);
}

export function assertDraftSlugAvailable({ registry, activeDrafts = [], locale, content_id: contentId, slug }) {
  validateLocaleSlugReservations(registry);
  assertSupportedLocale(locale);
  assertPublicSlug(slug);
  if (!isContentId(contentId)) fail('content_id is invalid');
  const permanent = registry.reservations.find((entry) => entry.locale === locale && entry.slug === slug);
  if (permanent && permanent.content_id !== contentId) fail(`draft slug ${locale}/${slug} is permanently reserved to another content_id`);
  for (const draft of activeDrafts) {
    if (!draft || typeof draft !== 'object') fail('draft claim must be an object');
    assertSupportedLocale(draft.locale);
    assertPublicSlug(draft.slug);
    if (!isContentId(draft.content_id)) fail('draft claim content_id is invalid');
    if (draft.locale === locale && draft.slug === slug && draft.content_id !== contentId) {
      fail(`draft slug ${locale}/${slug} is claimed by another content_id`);
    }
  }
  return true;
}

export function resolveReservedSlug(registry, locale, slug) {
  validateLocaleSlugReservations(registry);
  assertSupportedLocale(locale);
  assertPublicSlug(slug);
  const reservation = registry.reservations.find((entry) => entry.locale === locale && entry.slug === slug);
  if (!reservation) return null;
  if (reservation.kind === 'active') return { kind: 'active', content_id: reservation.content_id, path: publicPathFor(locale, slug) };
  const target = registry.reservations.find((entry) => entry.kind === 'active'
    && entry.locale === locale && entry.content_id === reservation.content_id);
  if (!target) fail(`redirect ${locale}/${slug} has no active target`);
  if (target.slug === slug) fail(`redirect ${locale}/${slug} loops to itself`);
  return { kind: 'redirect', content_id: reservation.content_id, path: publicPathFor(locale, target.slug) };
}

export function resolvePublishedContentLink(localeDocuments, contentId, locale) {
  if (!isContentId(contentId)) fail('content_id is invalid');
  assertSupportedLocale(locale);
  if (!Array.isArray(localeDocuments)) fail('localeDocuments must be an array');
  const document = localeDocuments.find((entry) => entry?.content_id === contentId && entry.locale === locale);
  if (!document) return null;
  const published = selectPublicLocaleDocument(document);
  return published ? publicPathFor(locale, published.slug) : null;
}
