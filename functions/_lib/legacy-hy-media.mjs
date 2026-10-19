import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { createMediaManifestIndex, resolveMediaAssetByPublicUrl } from '../../src/lib/content-source/media-manifest-contract.mjs';
import { extractHyImageReferences } from '../../src/lib/content-source/hy-legacy-images.mjs';
import { postImageKeyFromUrl } from './post-images.ts';
import { loadLocaleDraftSnapshot } from './admin-locale-draft-write.mjs';
import { commitMultiFileTransaction, loadSnapshotFiles } from './github-multifile.mjs';

export const MEDIA_MANIFEST_PATH = 'src/data/content/media-manifest.v1.json';

export class LegacyHyMediaError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LegacyHyMediaError';
    this.code = code;
  }
}

function fail(code, message, cause = undefined) { throw new LegacyHyMediaError(code, message, cause); }

function uuidV7() {
  const milliseconds = Date.now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 0xffffffffffff) fail('UUID_GENERATION_FAILURE', 'Clock cannot generate a UUIDv7');
  const timestamp = milliseconds.toString(16).padStart(12, '0');
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const random = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const variant = ((Number.parseInt(random[3], 16) & 0x3) | 0x8).toString(16);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

function manifestFromSnapshot(snapshot) {
  const file = snapshot.files.get(MEDIA_MANIFEST_PATH);
  if (!file) fail('MEDIA_MANIFEST_UNAVAILABLE', 'Managed media manifest is unavailable');
  let manifest;
  try { manifest = JSON.parse(file.content); } catch (error) { fail('MEDIA_MANIFEST_INVALID', 'Managed media manifest is invalid', error); }
  try { return { file, manifest, index: createMediaManifestIndex(manifest) }; }
  catch (error) { fail('MEDIA_MANIFEST_INVALID', error instanceof Error ? error.message : 'Managed media manifest is invalid', error); }
}

function sourceOwnsUrl(hyContent, sourceUrl) {
  return extractHyImageReferences(hyContent).some((reference) => reference.source_url === sourceUrl);
}

// The only mutation is a single, atomically committed manifest record. It
// deliberately never fetches, copies, or deletes the already-existing R2
// object, and the URL must be present in the current HY source snapshot.
export async function registerLegacyHyImage(client, {
  branch,
  contentId,
  locale,
  sourceUrl,
  bucket,
}) {
  if (typeof sourceUrl !== 'string' || !sourceUrl) fail('LEGACY_URL_INVALID', 'Legacy image URL is invalid');
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  const snapshot = await loadSnapshotFiles(client, loaded.snapshot, [MEDIA_MANIFEST_PATH]);
  const { file, manifest, index } = manifestFromSnapshot(snapshot);
  if (!sourceOwnsUrl(loaded.hy.published.content, sourceUrl)) fail('LEGACY_IMAGE_NOT_IN_SOURCE', 'Image is not used by the current HY source');

  const existing = resolveMediaAssetByPublicUrl(index, sourceUrl);
  if (existing) return Object.freeze({ changed: false, asset: existing, transaction: null });

  const key = postImageKeyFromUrl(sourceUrl);
  if (!key) fail('LEGACY_IMAGE_NOT_OWNED', 'Only approved images.erazahan.info/posts/*.webp URLs can be registered');
  if (!bucket || typeof bucket.head !== 'function') fail('R2_UNAVAILABLE', 'R2 image binding is unavailable');
  let object;
  try { object = await bucket.head(key); } catch (error) { fail('R2_LOOKUP_FAILURE', 'R2 image lookup failed', error); }
  if (!object) fail('R2_OBJECT_MISSING', 'The legacy R2 object no longer exists');

  const asset = Object.freeze({
    asset_id: uuidV7(),
    public_url: sourceUrl,
    source_url: sourceUrl,
    mime_type: 'image/webp',
  });
  const next = { schema_version: 1, assets: [...manifest.assets, asset] };
  try { createMediaManifestIndex(next); } catch (error) { fail('MEDIA_MANIFEST_INVALID', error instanceof Error ? error.message : 'Managed media manifest is invalid', error); }
  const transaction = await commitMultiFileTransaction(client, {
    snapshot,
    expectedFileShas: { [MEDIA_MANIFEST_PATH]: file.sha },
    changes: [{ operation: 'update', path: MEDIA_MANIFEST_PATH, content: canonicalJson(next) }],
    message: 'Admin: register existing HY R2 image',
  });
  return Object.freeze({ changed: !transaction.noOp, asset, transaction });
}
