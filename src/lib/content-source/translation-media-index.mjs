import { createMediaManifestIndex, loadMediaManifest } from './media-manifest.mjs';

const PICKER_KEYS = ['asset_id', 'public_url', 'mime_type', 'width', 'height'];

// This intentionally projects only immutable identity plus public display
// metadata. It does not invent a relationship between media and HY content.
export function projectTranslationMediaIndex(manifestOrIndex) {
  const mediaIndex = manifestOrIndex?.assetsById instanceof Map
    ? manifestOrIndex
    : createMediaManifestIndex(manifestOrIndex);
  if (!mediaIndex?.assetsById || !(mediaIndex.assetsById instanceof Map)) {
    throw new TypeError('Translation media index requires a validated media manifest');
  }
  return Object.freeze([...mediaIndex.assetsById.values()]
    .map((asset) => Object.freeze(Object.fromEntries(PICKER_KEYS
      .filter((key) => Object.hasOwn(asset, key))
      .map((key) => [key, asset[key]]))))
    .sort((left, right) => left.asset_id.localeCompare(right.asset_id, 'en')));
}

export function loadTranslationMediaIndex() {
  return projectTranslationMediaIndex(loadMediaManifest());
}
