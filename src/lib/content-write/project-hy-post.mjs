import { sourceFingerprintV1 } from '../content-schema/fingerprint.mjs';
import {
  isContentId,
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../content-schema/schema.mjs';
import { deriveNextSourceStateOnPublish } from '../content-schema/state.mjs';
import { canonicalJson, canonicalJsonEqual } from './canonical-json.mjs';

const STORE_PREFIX = 'src/data/content/dreams';

export class HyWriteProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HyWriteProjectionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new HyWriteProjectionError(code, message);
}

function requireObject(value, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object`);
  }
}

function requireNonEmptyString(value, code, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${label} must be a non-empty string`);
  }
}

function editableFields(editedPost) {
  requireObject(editedPost, 'INVALID_EDIT', 'editedPost');
  for (const field of ['slug', 'title', 'date', 'content', 'sourceUrl']) {
    requireNonEmptyString(editedPost[field], 'INVALID_EDIT', `editedPost.${field}`);
  }
  if (editedPost.letter !== null && (typeof editedPost.letter !== 'string' || !editedPost.letter.trim())) {
    fail('INVALID_EDIT', 'editedPost.letter must be a non-empty string or null');
  }
  if (!Array.isArray(editedPost.categories)
    || editedPost.categories.some((category) => typeof category !== 'string' || !category.trim())) {
    fail('INVALID_EDIT', 'editedPost.categories must contain non-empty strings');
  }
  return {
    slug: editedPost.slug,
    title: editedPost.title,
    date: editedPost.date,
    letter: editedPost.letter,
    categories: [...editedPost.categories],
    content: editedPost.content,
    sourceUrl: editedPost.sourceUrl,
  };
}

export function hyStorePaths(contentId) {
  if (!isContentId(contentId)) fail('INVALID_CONTENT_ID', 'registry content_id is invalid');
  const shard = contentId.slice(0, 2).toLowerCase();
  const directory = `${STORE_PREFIX}/${shard}/${contentId}`;
  return {
    shard,
    directory,
    item: `${directory}/item.json`,
    hy: `${directory}/hy.json`,
  };
}

export function resolveExistingHyIdentity({
  postIndex,
  currentPost,
  editedPost,
  registryEntries,
  currentItem,
  currentHy,
  itemPath,
  hyPath,
}) {
  if (!Number.isInteger(postIndex) || postIndex < 0) {
    fail('INVALID_POST_INDEX', 'postIndex must be a non-negative integer');
  }
  requireObject(currentPost, 'INVALID_CURRENT_POST', 'currentPost');
  const edit = editableFields(editedPost);
  if (!Array.isArray(registryEntries)) fail('INVALID_REGISTRY', 'registryEntries must be an array');

  const matches = registryEntries.filter((entry) => entry?.legacy?.original_array_index === postIndex || entry?.native?.post_index === postIndex);
  if (matches.length === 0) fail('REGISTRY_IDENTITY_MISSING', `registry entry is missing for post index ${postIndex}`);
  if (matches.length !== 1) fail('REGISTRY_IDENTITY_AMBIGUOUS', `registry identity is ambiguous for post index ${postIndex}`);
  const registryEntry = matches[0];

  const immutableSourceUrl = registryEntry.legacy?.original_source_url ?? registryEntry.native?.source_url;
  if (currentPost.sourceUrl !== immutableSourceUrl) {
    fail('CURRENT_SOURCE_URL_MISMATCH', 'current post sourceUrl differs from immutable registry provenance');
  }
  if (edit.sourceUrl !== currentPost.sourceUrl) {
    fail('SOURCE_URL_IMMUTABLE', 'sourceUrl is immutable for an existing HY dictionary post');
  }
  if (registryEntry.native && edit.slug !== registryEntry.native.slug) {
    fail('SLUG_IMMUTABLE', 'slug is immutable for a native HY dictionary post');
  }

  const paths = hyStorePaths(registryEntry.content_id);
  if (itemPath !== paths.item || hyPath !== paths.hy) {
    fail('STORE_PATH_MISMATCH', `store files must use ${paths.directory}`);
  }

  if (currentItem?.content_id !== registryEntry.content_id || currentHy?.content_id !== registryEntry.content_id) {
    fail('CONTENT_ID_MISMATCH', 'registry, item, and HY content_id values must match');
  }
  if (currentHy?.locale !== 'hy' || currentHy?.published === null || currentHy?.draft !== null) {
    fail('UNSUPPORTED_HY_STATE', 'existing HY update requires locale hy, a published payload, and no draft');
  }

  try {
    validateContentItem(currentItem);
    validateLocaleDocument(currentHy);
    validateItemLocaleRelation(currentItem, currentHy);
  } catch (error) {
    fail('INVALID_CURRENT_STORE', error instanceof Error ? error.message : String(error));
  }

  return {
    contentId: registryEntry.content_id,
    registryEntry,
    paths,
    edit,
  };
}

export function projectNativeHyPostCreate({ contentId, postIndex, editedPost, sourceUrl, createdAt }) {
  if (!isContentId(contentId) || contentId[14] !== '7') fail('INVALID_CONTENT_ID', 'native content_id must be a UUIDv7');
  if (!Number.isInteger(postIndex) || postIndex < 0) fail('INVALID_POST_INDEX', 'postIndex must be a non-negative integer');
  const edit = editableFields({ ...editedPost, sourceUrl });
  if (edit.sourceUrl !== sourceUrl) fail('SOURCE_URL_IMMUTABLE', 'native sourceUrl must be derived server-side');
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) fail('INVALID_CREATED_AT', 'native created_at is invalid');

  const published = {
    slug: edit.slug,
    title: edit.title,
    description: null,
    content: edit.content,
    image_alts: {},
    tags: [...edit.categories],
    alphabet_key: edit.letter,
    based_on_source_revision: null,
    based_on_source_fingerprint: null,
    version: 1,
    published_at: edit.date,
  };
  const item = {
    schema_version: 1,
    content_id: contentId,
    type: 'dream_dictionary',
    source_locale: 'hy',
    source_revision: 1,
    source_fingerprint: sourceFingerprintV1(published),
    fingerprint_spec_version: 1,
  };
  const hy = { schema_version: 1, content_id: contentId, locale: 'hy', draft: null, published };
  const post = { ...edit, comments: [] };
  try {
    validateContentItem(item);
    validateLocaleDocument(hy);
    validateItemLocaleRelation(item, hy);
  } catch (error) {
    fail('INVALID_PROJECTED_STORE', error instanceof Error ? error.message : String(error));
  }
  return {
    post,
    registryEntry: { content_id: contentId, native: { post_index: postIndex, source_url: sourceUrl, slug: edit.slug, created_at: createdAt } },
    item,
    hy,
    serialized: { item: canonicalJson(item), hy: canonicalJson(hy) },
  };
}

export function validateHyRegistryEntries(entries) {
  if (!Array.isArray(entries)) fail('INVALID_REGISTRY', 'registryEntries must be an array');
  const contentIds = new Set();
  const postIndexes = new Set();
  for (const entry of entries) {
    requireObject(entry, 'INVALID_REGISTRY', 'registry entry');
    if (!isContentId(entry.content_id)) fail('INVALID_REGISTRY', 'registry content_id is invalid');
    const hasLegacy = entry.legacy !== undefined;
    const hasNative = entry.native !== undefined;
    if (hasLegacy === hasNative) fail('INVALID_REGISTRY_VARIANT', 'registry entry must contain exactly one identity variant');
    const identity = hasLegacy ? entry.legacy : entry.native;
    requireObject(identity, 'INVALID_REGISTRY', 'registry identity');
    const postIndex = hasLegacy ? identity.original_array_index : identity.post_index;
    if (!Number.isInteger(postIndex) || postIndex < 0) fail('INVALID_REGISTRY', 'registry post index is invalid');
    if (hasLegacy) {
      for (const key of ['original_hy_slug', 'original_source_url']) requireNonEmptyString(identity[key], 'INVALID_REGISTRY', `registry legacy.${key}`);
    } else {
      for (const key of ['source_url', 'slug', 'created_at']) requireNonEmptyString(identity[key], 'INVALID_REGISTRY', `registry native.${key}`);
      try { new URL(identity.source_url); } catch { fail('INVALID_REGISTRY', 'registry native.source_url is invalid'); }
      if (!Number.isFinite(Date.parse(identity.created_at))) fail('INVALID_REGISTRY', 'registry native.created_at is invalid');
    }
    if (contentIds.has(entry.content_id) || postIndexes.has(postIndex)) fail('INVALID_REGISTRY', 'registry content_id or post index is duplicated');
    contentIds.add(entry.content_id);
    postIndexes.add(postIndex);
  }
  return entries;
}

function assertCurrentProjection(currentPost, currentItem, currentHy) {
  const published = currentHy.published;
  const sharedFieldsMatch = currentPost.slug === published.slug
    && currentPost.title === published.title
    && currentPost.date === published.published_at
    && currentPost.letter === published.alphabet_key
    && canonicalJsonEqual(currentPost.categories, published.tags)
    && currentPost.content === published.content;
  if (!sharedFieldsMatch) {
    fail('CURRENT_PROJECTION_DRIFT', 'current posts.json fields differ from the current HY store projection');
  }
  const computedFingerprint = sourceFingerprintV1(published);
  if (currentItem.source_fingerprint !== computedFingerprint) {
    fail('CURRENT_FINGERPRINT_DRIFT', 'current item source_fingerprint differs from the current HY payload');
  }
}

function newlineStyle(value) {
  const hasCrlf = /\r\n/.test(value);
  const hasLf = /(^|[^\r])\n/.test(value);
  const hasCr = /\r(?!\n)/.test(value);
  if (!hasCrlf && !hasLf && !hasCr) return 'none';
  if (hasCrlf && !hasLf && !hasCr) return 'crlf';
  if (hasLf && !hasCrlf && !hasCr) return 'lf';
  fail('UNSUPPORTED_NEWLINE_STYLE', 'existing post content has mixed or CR-only newline style');
}

function restoreEstablishedNewlineStyle(currentContent, submittedContent) {
  const style = newlineStyle(currentContent);
  const logicalLf = submittedContent.replace(/\r\n?|\n/g, '\n');
  return style === 'crlf' ? logicalLf.replace(/\n/g, '\r\n') : logicalLf;
}

function publishedPayloadWithoutVersion(published) {
  const { version: _version, ...payload } = published;
  return payload;
}

export function projectExistingHyPostUpdate(input) {
  const identity = resolveExistingHyIdentity(input);
  const { currentPost, currentItem, currentHy } = input;
  const edit = {
    ...identity.edit,
    content: restoreEstablishedNewlineStyle(currentPost.content, identity.edit.content),
  };
  assertCurrentProjection(currentPost, currentItem, currentHy);

  const updatedPost = { ...currentPost, ...edit };
  const currentPublished = currentHy.published;
  const proposedPayload = {
    ...publishedPayloadWithoutVersion(currentPublished),
    slug: edit.slug,
    title: edit.title,
    published_at: edit.date,
    alphabet_key: edit.letter,
    tags: [...edit.categories],
    content: edit.content,
  };
  const publishedPayloadChanged = !canonicalJsonEqual(
    publishedPayloadWithoutVersion(currentPublished),
    proposedPayload,
  );
  const proposedPublished = {
    ...proposedPayload,
    version: publishedPayloadChanged ? currentPublished.version + 1 : currentPublished.version,
  };
  const nextSourceState = deriveNextSourceStateOnPublish(currentItem, proposedPublished);
  const updatedItem = {
    ...currentItem,
    source_revision: nextSourceState.source_revision,
    source_fingerprint: nextSourceState.source_fingerprint,
  };
  const updatedHy = { ...currentHy, published: proposedPublished };

  try {
    validateContentItem(updatedItem);
    validateLocaleDocument(updatedHy);
    validateItemLocaleRelation(updatedItem, updatedHy);
  } catch (error) {
    fail('INVALID_PROJECTED_STORE', error instanceof Error ? error.message : String(error));
  }
  if (sourceFingerprintV1(updatedHy.published) !== updatedItem.source_fingerprint) {
    fail('PROJECTED_FINGERPRINT_MISMATCH', 'projected item fingerprint differs from projected HY payload');
  }

  const changes = {
    legacyPostChanged: !canonicalJsonEqual(currentPost, updatedPost),
    itemChanged: !canonicalJsonEqual(currentItem, updatedItem),
    hyChanged: !canonicalJsonEqual(currentHy, updatedHy),
    semanticFingerprintChanged: nextSourceState.changed,
    publishedPayloadChanged,
  };
  changes.noOp = !changes.legacyPostChanged && !changes.itemChanged && !changes.hyChanged;

  return {
    identity,
    updatedPost,
    updatedItem,
    updatedHy,
    changes,
    serialized: {
      item: canonicalJson(updatedItem),
      hy: canonicalJson(updatedHy),
    },
  };
}
