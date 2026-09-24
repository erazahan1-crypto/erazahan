import { readFileSync } from 'node:fs';
import { assertAssetId } from '../content-schema/logical-references.mjs';

export const MEDIA_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_MEDIA_MANIFEST_PATH = new URL('../../data/content/media-manifest.v1.json', import.meta.url);

const RECORD_KEYS = new Set(['asset_id', 'public_url', 'source_url', 'mime_type', 'width', 'height', 'integrity']);

function fail(message) {
  throw new TypeError(`Media manifest: ${message}`);
}

function assertHttpsUrl(value, label) {
  if (typeof value !== 'string' || !value) fail(`${label} must be a non-empty HTTPS URL`);
  let parsed;
  try { parsed = new URL(value); } catch { fail(`${label} must be a valid HTTPS URL`); }
  if (parsed.protocol !== 'https:') fail(`${label} must be a valid HTTPS URL`);
  return value;
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('asset record must be an object');
  for (const key of Object.keys(record)) {
    if (!RECORD_KEYS.has(key)) fail(`asset record.${key} is not allowed`);
  }
  try { assertAssetId(record.asset_id); } catch (error) {
    fail(error instanceof Error ? error.message : 'asset_id is invalid');
  }
  assertHttpsUrl(record.public_url, 'public_url');
  if (Object.hasOwn(record, 'source_url')) assertHttpsUrl(record.source_url, 'source_url');
  if (Object.hasOwn(record, 'mime_type') && (typeof record.mime_type !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(record.mime_type))) fail('mime_type must be an image MIME type');
  for (const dimension of ['width', 'height']) {
    if (Object.hasOwn(record, dimension) && (!Number.isInteger(record[dimension]) || record[dimension] < 1)) fail(`${dimension} must be a positive integer`);
  }
  if (Object.hasOwn(record, 'integrity') && (typeof record.integrity !== 'string' || !record.integrity)) fail('integrity must be a non-empty string');
  return Object.freeze({ ...record });
}

export function createMediaManifestIndex(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('manifest must be an object');
  if (manifest.schema_version !== MEDIA_MANIFEST_SCHEMA_VERSION || !Array.isArray(manifest.assets)
    || Object.keys(manifest).length !== 2) fail('manifest must contain schema_version 1 and assets');
  const assetsById = new Map();
  for (const candidate of manifest.assets) {
    const asset = validateRecord(candidate);
    if (assetsById.has(asset.asset_id)) fail(`duplicate asset_id ${asset.asset_id}`);
    assetsById.set(asset.asset_id, asset);
  }
  return Object.freeze({ assetsById });
}

export function loadMediaManifest(file = DEFAULT_MEDIA_MANIFEST_PATH) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(file, 'utf8')); } catch (error) {
    fail(`cannot read manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
  return createMediaManifestIndex(manifest);
}

export function resolveLogicalAssetReference(mediaIndex, assetId) {
  try { assertAssetId(assetId); } catch (error) {
    fail(error instanceof Error ? error.message : 'asset_id is invalid');
  }
  if (!mediaIndex || !(mediaIndex.assetsById instanceof Map)) fail('media index is invalid');
  return mediaIndex.assetsById.get(assetId) ?? null;
}
