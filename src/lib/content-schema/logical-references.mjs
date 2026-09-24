import { isContentId } from './schema.mjs';
import { assertSupportedLocale } from './multilingual-contract.mjs';

const CONTENT_SCHEME = 'content://';
const ASSET_SCHEME = 'asset://';

function fail(message) {
  throw new TypeError(`Logical reference contract: ${message}`);
}

function isReservedSchemeAttempt(value, kind) {
  return typeof value === 'string' && value.toLowerCase().startsWith(`${kind}:`);
}

// Assets deliberately have a narrower identity contract than content. This
// builds on the canonical content UUID validator without redefining UUID syntax.
export function isAssetId(value) {
  return isContentId(value) && value === value.toLowerCase() && value[14] === '7';
}

export function assertAssetId(value) {
  if (!isAssetId(value)) fail('asset_id must be a canonical lowercase UUIDv7');
  return value;
}

function parseIdentifier(value, scheme, kind, assertIdentifier) {
  if (typeof value !== 'string') fail(`${kind} reference must be a string`);
  if (!isReservedSchemeAttempt(value, kind)) return null;
  if (!value.startsWith(scheme)) fail(`${kind} reference must use canonical ${scheme}<identifier> form`);
  const identifier = value.slice(scheme.length);
  assertIdentifier(identifier);
  return identifier;
}

// A logical content destination is an immutable content_id, never a slug or URL.
export function parseLogicalContentReference(destination) {
  const content_id = parseIdentifier(destination, CONTENT_SCHEME, 'content', (value) => {
    if (!isContentId(value)) fail('content reference identifier must be a valid immutable UUIDv5 or UUIDv7');
  });
  return content_id === null ? null : Object.freeze({ content_id });
}

// The Markdown image alt is deliberately not an authority for asset:// images.
// Callers pass the parsed Markdown alt text here; localeSnapshot.image_alts owns it.
export function parseLogicalAssetReference(destination, markdownAlt = '') {
  const asset_id = parseIdentifier(destination, ASSET_SCHEME, 'asset', assertAssetId);
  if (asset_id === null) return null;
  if (typeof markdownAlt !== 'string') fail('asset Markdown alt must be a string');
  if (markdownAlt !== '') fail('asset:// Markdown images must use an empty alt slot');
  return Object.freeze({ asset_id });
}

export function resolveLogicalContentReference(index, contentId, locale) {
  if (!isContentId(contentId)) fail('content_id is invalid');
  assertSupportedLocale(locale);
  if (!index || !(index.knownContentIds instanceof Set) || !(index.pathsByContentId instanceof Map)) {
    fail('content link index is invalid');
  }
  if (!index.knownContentIds.has(contentId)) return Object.freeze({ status: 'missing_content', path: null });
  const path = index.pathsByContentId.get(contentId)?.get(locale) ?? null;
  return Object.freeze(path
    ? { status: 'published', path }
    : { status: 'unpublished_locale', path: null });
}

export function imageAltState(imageAlts, assetId) {
  assertAssetId(assetId);
  if (!imageAlts || typeof imageAlts !== 'object' || Array.isArray(imageAlts)) fail('image_alts must be an object');
  if (!Object.hasOwn(imageAlts, assetId)) return Object.freeze({ supplied: false, decorative: false, alt: null });
  const alt = imageAlts[assetId];
  if (typeof alt !== 'string') fail('image_alts values must be strings');
  return Object.freeze({ supplied: true, decorative: alt === '', alt });
}
