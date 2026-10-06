import { createMediaManifestIndex, resolveLogicalAssetReference } from '../../src/lib/content-source/media-manifest-contract.mjs';
import { listLocalizedAssetIds } from '../../src/lib/localized-content-pipeline.mjs';
import { managedImageKeys, postImageKeyFromUrl, validatePostImageKey } from './post-images.ts';

function addKey(keys, value) {
  if (typeof value !== 'string') return;
  const key = postImageKeyFromUrl(value);
  if (key) keys.add(key);
}

function addManifestAssetKey(keys, mediaIndex, assetId) {
  const asset = resolveLogicalAssetReference(mediaIndex, assetId);
  if (asset) addKey(keys, asset.public_url);
}

function addLocalizedPayloadKeys(keys, mediaIndex, payload) {
  if (!payload || typeof payload !== 'object') return;
  for (const key of managedImageKeys(payload.content)) keys.add(key);
  for (const assetId of listLocalizedAssetIds(payload.content ?? '')) addManifestAssetKey(keys, mediaIndex, assetId);
  if (payload.image_alts && typeof payload.image_alts === 'object' && !Array.isArray(payload.image_alts)) {
    for (const assetId of Object.keys(payload.image_alts)) addManifestAssetKey(keys, mediaIndex, assetId);
  }
}

// Asset references are authoritative only when they occur in persisted content
// representations. Manifest membership is inventory, not usage.
export function listPersistedManagedImageKeys({ posts, localeDocuments, mediaManifest }) {
  if (!Array.isArray(posts)) throw new TypeError('Managed asset reference projection requires posts');
  if (!Array.isArray(localeDocuments)) throw new TypeError('Managed asset reference projection requires locale documents');
  const mediaIndex = createMediaManifestIndex(mediaManifest);
  const keys = new Set();
  for (const post of posts) {
    for (const key of managedImageKeys(post?.content)) keys.add(key);
    addKey(keys, post?.cover);
  }
  for (const document of localeDocuments) {
    addLocalizedPayloadKeys(keys, mediaIndex, document?.published);
    addLocalizedPayloadKeys(keys, mediaIndex, document?.draft);
  }
  return Object.freeze([...keys].sort((left, right) => left.localeCompare(right, 'en')));
}

export function partitionManagedImageDeletes(input, keys) {
  const inUse = new Set(listPersistedManagedImageKeys(input));
  const safe = [];
  const retained = [];
  for (const key of new Set(keys)) (inUse.has(validatePostImageKey(key)) ? retained : safe).push(key);
  return Object.freeze({ safe: Object.freeze(safe), retained: Object.freeze(retained) });
}
