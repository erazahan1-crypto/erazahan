import { sourceFingerprintV1 } from './fingerprint.mjs';
import {
  SOURCE_LOCALE,
  isSourceFingerprint,
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
  validatePublishedPayload,
} from './schema.mjs';

export const PUBLICATION_STATES = Object.freeze([
  'NOT_CREATED',
  'DRAFT',
  'PUBLISHED',
  'PUBLISHED_WITH_DRAFT',
]);
export const SYNCHRONIZATION_STATES = Object.freeze([
  'NOT_CREATED',
  'CURRENT',
  'OUTDATED',
]);

function synchronizationState(snapshot, sourceItem) {
  if (!snapshot) return 'NOT_CREATED';
  return snapshot.based_on_source_revision === sourceItem.source_revision
    && snapshot.based_on_source_fingerprint === sourceItem.source_fingerprint
    ? 'CURRENT'
    : 'OUTDATED';
}

export function deriveNextSourceStateOnPublish(item, nextPublishedHyPayload) {
  validateContentItem(item);
  if (item.source_locale !== SOURCE_LOCALE) throw new TypeError('Source revision helper requires the HY source locale');
  validatePublishedPayload(nextPublishedHyPayload, SOURCE_LOCALE);
  const nextFingerprint = sourceFingerprintV1(nextPublishedHyPayload);
  const changed = item.source_fingerprint !== nextFingerprint;
  return {
    source_revision: changed ? item.source_revision + 1 : item.source_revision,
    source_fingerprint: nextFingerprint,
    changed,
  };
}

export function deriveTranslationState(localeDocument, sourceItem) {
  validateItemLocaleRelation(sourceItem, localeDocument);
  if (localeDocument.locale === SOURCE_LOCALE) {
    throw new TypeError('Translation state applies only to RU and EN locale documents');
  }
  if (sourceItem.source_revision < 1 || !isSourceFingerprint(sourceItem.source_fingerprint)) {
    throw new TypeError('Translation state requires a published HY source revision');
  }

  const hasDraft = localeDocument.draft !== null;
  const hasPublished = localeDocument.published !== null;
  const publication_state = hasPublished
    ? (hasDraft ? 'PUBLISHED_WITH_DRAFT' : 'PUBLISHED')
    : (hasDraft ? 'DRAFT' : 'NOT_CREATED');
  const draft_synchronization = synchronizationState(localeDocument.draft, sourceItem);
  const published_synchronization = synchronizationState(localeDocument.published, sourceItem);
  const state = !hasPublished
    ? (hasDraft ? 'DRAFT' : 'NOT_CREATED')
    : published_synchronization;

  return {
    state,
    publication_state,
    draft_synchronization,
    published_synchronization,
  };
}

export function selectPublishedLocale(localeDocument) {
  validateLocaleDocument(localeDocument);
  return localeDocument.published;
}
