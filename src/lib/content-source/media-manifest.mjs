import { readFileSync } from 'node:fs';
import { createMediaManifestIndex } from './media-manifest-contract.mjs';
export { MEDIA_MANIFEST_SCHEMA_VERSION, createMediaManifestIndex, resolveLogicalAssetReference } from './media-manifest-contract.mjs';
export const DEFAULT_MEDIA_MANIFEST_PATH = new URL('../../data/content/media-manifest.v1.json', import.meta.url);

function fail(message) {
  throw new TypeError(`Media manifest: ${message}`);
}


export function loadMediaManifest(file = DEFAULT_MEDIA_MANIFEST_PATH) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    fail(`cannot read manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  return createMediaManifestIndex(manifest);
}
