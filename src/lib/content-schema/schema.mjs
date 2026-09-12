import { FINGERPRINT_SPEC_VERSION } from './fingerprint.mjs';

export const CONTENT_SCHEMA_VERSION = 1;
export const CONTENT_TYPE = 'dream_dictionary';
export const SOURCE_LOCALE = 'hy';
export const CONTENT_LOCALES = Object.freeze(['hy', 'ru', 'en']);

const CONTENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RFC3339_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class ContentSchemaValidationError extends Error {}

function fail(message) {
  throw new ContentSchemaValidationError(message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
}

function requireKeys(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed in schema v1`);
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} must be a non-empty string`);
}

function isValidInstant(value) {
  return typeof value === 'string'
    && RFC3339_INSTANT_RE.test(value)
    && Number.isFinite(Date.parse(value));
}

function isValidPublishedAt(value) {
  if (typeof value !== 'string') return false;
  if (ISO_DATE_RE.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }
  return isValidInstant(value);
}

export function isContentId(value) {
  return typeof value === 'string' && CONTENT_ID_RE.test(value);
}

export function isSourceFingerprint(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function validateGenerationMetadata(value, label) {
  requireObject(value, label);
  requireKeys(
    value,
    ['kind'],
    ['provider', 'model', 'prompt_version', 'generated_at'],
    label,
  );
  if (!['human', 'ai'].includes(value.kind)) fail(`${label}.kind must be human or ai`);
  for (const key of ['provider', 'model', 'prompt_version']) {
    if (Object.hasOwn(value, key)) requireNonEmptyString(value[key], `${label}.${key}`);
  }
  if (Object.hasOwn(value, 'generated_at') && !isValidInstant(value.generated_at)) {
    fail(`${label}.generated_at must be an RFC 3339 instant`);
  }
}

const LOCALIZED_REQUIRED_KEYS = [
  'slug',
  'title',
  'description',
  'content',
  'image_alts',
  'tags',
  'alphabet_key',
  'based_on_source_revision',
  'based_on_source_fingerprint',
];
const LOCALIZED_OPTIONAL_KEYS = ['updated_at', 'generation'];

function validateLocalizedFields(value, locale, label, published) {
  requireObject(value, label);
  requireKeys(
    value,
    published ? [...LOCALIZED_REQUIRED_KEYS, 'version', 'published_at'] : LOCALIZED_REQUIRED_KEYS,
    LOCALIZED_OPTIONAL_KEYS,
    label,
  );
  requireNonEmptyString(value.slug, `${label}.slug`);
  requireNonEmptyString(value.title, `${label}.title`);
  if (value.description !== null && typeof value.description !== 'string') {
    fail(`${label}.description must be a string or null`);
  }
  requireNonEmptyString(value.content, `${label}.content`);

  requireObject(value.image_alts, `${label}.image_alts`);
  for (const [assetReference, alt] of Object.entries(value.image_alts)) {
    requireNonEmptyString(assetReference, `${label}.image_alts key`);
    if (typeof alt !== 'string') fail(`${label}.image_alts.${assetReference} must be a string`);
  }
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string' || tag.trim().length === 0)) {
    fail(`${label}.tags must be an array of non-empty strings`);
  }
  if (value.alphabet_key !== null) requireNonEmptyString(value.alphabet_key, `${label}.alphabet_key`);

  if (locale === SOURCE_LOCALE) {
    if (value.based_on_source_revision !== null || value.based_on_source_fingerprint !== null) {
      fail(`${label} HY source payload must not be based on itself`);
    }
  } else {
    if (!Number.isInteger(value.based_on_source_revision) || value.based_on_source_revision < 1) {
      fail(`${label}.based_on_source_revision must be an integer >= 1`);
    }
    if (!isSourceFingerprint(value.based_on_source_fingerprint)) {
      fail(`${label}.based_on_source_fingerprint must be a lower-case SHA-256`);
    }
  }

  if (Object.hasOwn(value, 'updated_at') && !isValidInstant(value.updated_at)) {
    fail(`${label}.updated_at must be an RFC 3339 instant`);
  }
  if (Object.hasOwn(value, 'generation')) validateGenerationMetadata(value.generation, `${label}.generation`);

  if (published) {
    if (!Number.isInteger(value.version) || value.version < 1) fail(`${label}.version must be an integer >= 1`);
    if (!isValidPublishedAt(value.published_at)) {
      fail(`${label}.published_at must be an ISO date or RFC 3339 instant`);
    }
  }
  return value;
}

export function validateLocalizedPayload(value, locale = SOURCE_LOCALE) {
  if (!CONTENT_LOCALES.includes(locale)) fail(`Unknown locale: ${locale}`);
  return validateLocalizedFields(value, locale, 'payload', false);
}

export function validatePublishedPayload(value, locale = SOURCE_LOCALE) {
  if (!CONTENT_LOCALES.includes(locale)) fail(`Unknown locale: ${locale}`);
  return validateLocalizedFields(value, locale, 'published', true);
}

export function validateContentItem(value) {
  requireObject(value, 'item');
  requireKeys(
    value,
    [
      'schema_version',
      'content_id',
      'type',
      'source_locale',
      'source_revision',
      'source_fingerprint',
      'fingerprint_spec_version',
    ],
    [],
    'item',
  );
  if (value.schema_version !== CONTENT_SCHEMA_VERSION) fail('item.schema_version must be 1');
  if (!isContentId(value.content_id)) fail('item.content_id must be a valid UUIDv5 or UUIDv7');
  if (value.type !== CONTENT_TYPE) fail(`item.type must be ${CONTENT_TYPE}`);
  if (value.source_locale !== SOURCE_LOCALE) fail(`item.source_locale must be ${SOURCE_LOCALE}`);
  if (!Number.isInteger(value.source_revision) || value.source_revision < 0) {
    fail('item.source_revision must be an integer >= 0');
  }
  if (value.source_revision === 0 && value.source_fingerprint !== null) {
    fail('item.source_fingerprint must be null when source_revision is 0');
  }
  if (value.source_revision > 0 && !isSourceFingerprint(value.source_fingerprint)) {
    fail('item.source_fingerprint must be a lower-case SHA-256 when source_revision is positive');
  }
  if (value.fingerprint_spec_version !== FINGERPRINT_SPEC_VERSION) {
    fail(`item.fingerprint_spec_version must be ${FINGERPRINT_SPEC_VERSION}`);
  }
  return value;
}

export function validateLocaleDocument(value) {
  requireObject(value, 'localeDocument');
  requireKeys(
    value,
    ['schema_version', 'content_id', 'locale', 'draft', 'published'],
    [],
    'localeDocument',
  );
  if (value.schema_version !== CONTENT_SCHEMA_VERSION) fail('localeDocument.schema_version must be 1');
  if (!isContentId(value.content_id)) fail('localeDocument.content_id must be a valid UUIDv5 or UUIDv7');
  if (!CONTENT_LOCALES.includes(value.locale)) fail(`Unknown locale: ${value.locale}`);
  if (value.draft !== null) validateLocalizedPayload(value.draft, value.locale);
  if (value.published !== null) validatePublishedPayload(value.published, value.locale);
  return value;
}

export function validateItemLocaleRelation(item, localeDocument) {
  validateContentItem(item);
  validateLocaleDocument(localeDocument);
  if (item.content_id !== localeDocument.content_id) {
    fail('ContentItem and LocaleDocument content_id values must match');
  }
  return true;
}
