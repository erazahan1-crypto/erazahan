import { validateContentItem } from '../content-schema/schema.mjs';
import { applyPublishedSlugReservation, validateLocaleDocumentStorage } from '../content-schema/multilingual-contract.mjs';
import { validateStoredAlphabetKey } from '../content-schema/locale-alphabet.mjs';
import { canonicalJsonEqual } from './canonical-json.mjs';
import { assertDraftSlugClaimOwner, claimDraftSlug, releaseDraftSlug } from './locale-draft-slug-claims.mjs';

export class LocaleWriterDomainError extends Error { constructor(code, message) { super(message); this.code = code; } }
function fail(code, message) { throw new LocaleWriterDomainError(code, message); }
function localeOnly(locale) { if (locale !== 'ru' && locale !== 'en') fail('LOCALE_UNSUPPORTED', 'Locale writer supports only ru and en'); }
function validItem(item) { try { validateContentItem(item); } catch (error) { fail('CONTENT_NOT_FOUND', error instanceof Error ? error.message : String(error)); } if (item.source_revision < 1 || !item.source_fingerprint) fail('CONTENT_NOT_FOUND', 'Current HY source is unavailable'); }
function documentFor(item, locale, draft, published) { return { schema_version: 1, content_id: item.content_id, locale, draft, published }; }
function validate(item, locale, document, code) { try { validateLocaleDocumentStorage({ item, filename: `${locale}.json`, localeDocument: document }); } catch (error) { fail(code, error instanceof Error ? error.message : String(error)); } }
function validateExisting(item, locale, document) { validate(item, locale, document, 'DRAFT_INVALID'); }
function editable(payload, item, provenance) {
  const fields = ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key', 'updated_at', 'generation'];
  const result = Object.fromEntries(fields.filter((field) => Object.hasOwn(payload ?? {}, field)).map((field) => [field, structuredClone(payload[field])]));
  return { ...result, based_on_source_revision: provenance.revision, based_on_source_fingerprint: provenance.fingerprint };
}
function currentProvenance(item) { return { revision: item.source_revision, fingerprint: item.source_fingerprint }; }
function draftProvenance(draft) { return { revision: draft.based_on_source_revision, fingerprint: draft.based_on_source_fingerprint }; }
function withoutPublishedMeta(published) { const { version: _version, published_at: _publishedAt, ...draft } = published; return structuredClone(draft); }
function sameProvenance(left, right) { return left.based_on_source_revision === right.based_on_source_revision && left.based_on_source_fingerprint === right.based_on_source_fingerprint; }
function claimError(operation) { try { return operation(); } catch (error) { if (error?.code) fail(error.code, error.message); throw error; } }
function assertDraftOnlyClaim(localeDocument, draftClaims, locale, item) {
  if (!localeDocument.published) claimError(() => assertDraftSlugClaimOwner(draftClaims, { locale, slug: localeDocument.draft.slug, content_id: item.content_id }));
}

export function createLocaleDraft({ item, locale, localeDocument: existingLocaleDocument = null, payload, draftClaims, publishedReservations }) {
  localeOnly(locale); validItem(item);
  if (existingLocaleDocument !== null) fail('DRAFT_INVALID', 'Locale document already exists');
  const draft = editable(payload, item, currentProvenance(item));
  try { validateStoredAlphabetKey(locale, draft.title, draft.alphabet_key); } catch (error) { fail('DRAFT_INVALID', error.message); }
  const localeDocument = documentFor(item, locale, draft, null); validate(item, locale, localeDocument, 'DRAFT_INVALID');
  const nextClaims = claimError(() => claimDraftSlug({ registry: draftClaims, publishedReservations, locale, slug: draft.slug, content_id: item.content_id }));
  return Object.freeze({ localeDocument: structuredClone(localeDocument), draftClaims: nextClaims, publishedReservations });
}

export function updateLocaleDraft({ item, locale, localeDocument, payload, draftClaims, publishedReservations }) {
  localeOnly(locale); validItem(item); if (!localeDocument?.draft) fail('NO_DRAFT', 'No locale draft exists'); validateExisting(item, locale, localeDocument);
  assertDraftOnlyClaim(localeDocument, draftClaims, locale, item);
  const published = localeDocument.published;
  const draft = editable(payload, item, draftProvenance(localeDocument.draft));
  try { validateStoredAlphabetKey(locale, draft.title, draft.alphabet_key); } catch (error) { fail('DRAFT_INVALID', error.message); }
  if (published && draft.slug !== published.slug) fail('PUBLISHED_SLUG_LOCKED', 'Published locale slug is locked');
  const nextDocument = documentFor(item, locale, draft, published ? structuredClone(published) : null); validate(item, locale, nextDocument, 'DRAFT_INVALID');
  let nextClaims = draftClaims;
  if (!published && draft.slug !== localeDocument.draft.slug) {
    nextClaims = claimError(() => claimDraftSlug({ registry: nextClaims, publishedReservations, locale, slug: draft.slug, content_id: item.content_id }));
    nextClaims = claimError(() => releaseDraftSlug({ registry: nextClaims, locale, slug: localeDocument.draft.slug, content_id: item.content_id }));
  }
  return Object.freeze({ localeDocument: structuredClone(nextDocument), draftClaims: nextClaims, publishedReservations });
}

export function beginLocaleEdit({ item, locale, localeDocument, draftClaims, publishedReservations }) {
  localeOnly(locale); validItem(item); if (!localeDocument?.published || localeDocument.draft) fail('NO_DRAFT', 'Locale must be published without a draft'); validateExisting(item, locale, localeDocument);
  const nextDocument = documentFor(item, locale, withoutPublishedMeta(localeDocument.published), structuredClone(localeDocument.published)); validate(item, locale, nextDocument, 'DRAFT_INVALID');
  return Object.freeze({ localeDocument: structuredClone(nextDocument), draftClaims, publishedReservations });
}

export function rebaseLocaleDraftToCurrentSource({ item, locale, localeDocument, draftClaims, publishedReservations }) {
  localeOnly(locale); validItem(item); if (!localeDocument?.draft) fail('NO_DRAFT', 'No locale draft exists'); validateExisting(item, locale, localeDocument);
  assertDraftOnlyClaim(localeDocument, draftClaims, locale, item);
  if (sameProvenance(localeDocument.draft, { based_on_source_revision: item.source_revision, based_on_source_fingerprint: item.source_fingerprint })) fail('NO_CHANGES', 'Draft already matches current source');
  const draft = { ...structuredClone(localeDocument.draft), based_on_source_revision: item.source_revision, based_on_source_fingerprint: item.source_fingerprint };
  const nextDocument = documentFor(item, locale, draft, localeDocument.published ? structuredClone(localeDocument.published) : null); validate(item, locale, nextDocument, 'DRAFT_INVALID');
  return Object.freeze({ localeDocument: structuredClone(nextDocument), draftClaims, publishedReservations });
}

export function discardLocaleDraft({ item, locale, localeDocument, draftClaims, publishedReservations }) {
  localeOnly(locale); validItem(item); if (!localeDocument?.draft) fail('NO_DRAFT', 'No locale draft exists'); validateExisting(item, locale, localeDocument);
  assertDraftOnlyClaim(localeDocument, draftClaims, locale, item);
  if (!localeDocument.published) return Object.freeze({ localeDocument: null, draftClaims: claimError(() => releaseDraftSlug({ registry: draftClaims, locale, slug: localeDocument.draft.slug, content_id: item.content_id })), publishedReservations });
  return Object.freeze({ localeDocument: documentFor(item, locale, null, structuredClone(localeDocument.published)), draftClaims, publishedReservations });
}

export function publishLocaleDraft({ item, locale, localeDocument, draftClaims, publishedReservations, publishedAt }) {
  localeOnly(locale); validItem(item); if (!localeDocument?.draft) fail('NO_DRAFT', 'No locale draft exists'); validateExisting(item, locale, localeDocument);
  assertDraftOnlyClaim(localeDocument, draftClaims, locale, item);
  const { draft, published } = localeDocument;
  if (!sameProvenance(draft, { based_on_source_revision: item.source_revision, based_on_source_fingerprint: item.source_fingerprint })) fail('SOURCE_OUTDATED', 'Draft must be explicitly reviewed against the current HY source');
  if (published && draft.slug !== published.slug) fail('PUBLISHED_SLUG_LOCKED', 'Published locale slug is locked');
  if (published && canonicalJsonEqual(draft, withoutPublishedMeta(published))) fail('NO_CHANGES', 'Draft has no publishable changes');
  const nextPublished = { ...structuredClone(draft), version: published ? published.version + 1 : 1, published_at: publishedAt };
  const nextDocument = documentFor(item, locale, null, nextPublished); validate(item, locale, nextDocument, 'PUBLISH_INVALID');
  const nextReservations = (() => { try { return applyPublishedSlugReservation(publishedReservations, { locale, content_id: item.content_id, slug: draft.slug }); } catch (error) { fail('SLUG_PERMANENTLY_RESERVED', error instanceof Error ? error.message : String(error)); } })();
  const nextClaims = published ? draftClaims : claimError(() => releaseDraftSlug({ registry: draftClaims, locale, slug: draft.slug, content_id: item.content_id }));
  return Object.freeze({ localeDocument: structuredClone(nextDocument), draftClaims: nextClaims, publishedReservations: nextReservations });
}
