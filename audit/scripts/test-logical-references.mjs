import assert from 'node:assert/strict';
import path from 'node:path';
import {
  imageAltState,
  isAssetId,
  parseLogicalAssetReference,
  parseLogicalContentReference,
  resolveLogicalContentReference,
} from '../../src/lib/content-schema/logical-references.mjs';
import { buildPublishedContentLinkIndex } from '../../src/lib/content-source/published-content.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import {
  createMediaManifestIndex,
  loadMediaManifest,
  resolveLogicalAssetReference,
} from '../../src/lib/content-source/media-manifest.mjs';

const CONTENT_A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const CONTENT_DRAFT = 'cadd4552-097e-5845-b59e-223c36c82488';
const CONTENT_BOTH = '01990c84-9c78-7abc-8def-123456789abc';
const CONTENT_OUTDATED = '11111111-1111-5111-8111-111111111111';
const MISSING = '22222222-2222-5222-8222-222222222222';
const BEXER_ASSET = '019c2a10-4e61-7a32-8c15-2a37bcf94d02';
const BAD_ASSET = '019c2a10-4e61-7b48-9e26-8d51ca0743f9';
const MISSING_ASSET = '019c2a10-4e61-7cd9-8d8e-1148b1f55c07';
const EN_PILOT = '67354341-0eba-5093-9bac-f5bb939cf7bd';

assert.deepEqual(parseLogicalContentReference(`content://${CONTENT_A}`), { content_id: CONTENT_A });
assert.equal(parseLogicalContentReference('/ru/a/'), null);
assert.equal(parseLogicalContentReference(`https://example.test/${CONTENT_A}`), null);
assert.equal(parseLogicalContentReference(`http://example.test/${CONTENT_A}`), null);
for (const invalid of [
  'content://not-a-uuid', 'content://', 'content://javascript:alert(1)',
  `CONTENT://${CONTENT_A}`, `Content://${CONTENT_A}`, `content:${CONTENT_A}`,
  `content://${CONTENT_A}/`, `content://${CONTENT_A}?x=1`, `content://${CONTENT_A}#x`, `content:///${CONTENT_A}`,
]) {
  assert.throws(() => parseLogicalContentReference(invalid), `rejects ${invalid}`);
}
for (const unapproved of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'asset://not-a-uuid']) {
  assert.equal(parseLogicalContentReference(unapproved), null, `${unapproved} is not a content reference`);
}

assert.deepEqual(parseLogicalAssetReference(`asset://${BEXER_ASSET}`), { asset_id: BEXER_ASSET });
assert.equal(parseLogicalAssetReference('https://example.test/image.webp'), null);
assert.equal(isAssetId(BEXER_ASSET), true);
assert.equal(isAssetId(CONTENT_A), false, 'UUIDv5 content IDs are never asset IDs');
assert.equal(isAssetId(BEXER_ASSET.toUpperCase()), false, 'asset IDs are lowercase only');
for (const invalid of [
  'asset://not-a-uuid', `asset://${CONTENT_A}`, `asset://${BEXER_ASSET.toUpperCase()}`,
  `ASSET://${BEXER_ASSET}`, `Asset://${BEXER_ASSET}`, `asset:${BEXER_ASSET}`,
  `asset://${BEXER_ASSET}/`, `asset://${BEXER_ASSET}?x=1`, `asset://${BEXER_ASSET}#x`, `asset:///${BEXER_ASSET}`,
]) assert.throws(() => parseLogicalAssetReference(invalid), `rejects ${invalid}`);
assert.throws(() => parseLogicalAssetReference(`asset://${BEXER_ASSET}`, 'duplicate alt'));
for (const unapproved of ['javascript:alert(1)', 'data:image/png,x', 'file:///tmp/a', `content://${CONTENT_A}`]) {
  assert.equal(parseLogicalAssetReference(unapproved), null, `${unapproved} is not an asset reference`);
}

// Fixture mirrors the existing published-only projection. Draft-only has no
// path; PUBLISHED_WITH_DRAFT and OUTDATED retain their published snapshot path.
const contentIndex = {
  knownContentIds: new Set([CONTENT_A, CONTENT_DRAFT, CONTENT_BOTH, CONTENT_OUTDATED]),
  pathsByContentId: new Map([
    [CONTENT_A, new Map([['hy', '/hy-source/'], ['ru', '/ru/old-ru-slug/']])],
    [CONTENT_BOTH, new Map([['ru', '/ru/published-not-draft/']])],
    [CONTENT_OUTDATED, new Map([['ru', '/ru/outdated-published/']])],
  ]),
};
assert.deepEqual(resolveLogicalContentReference(contentIndex, CONTENT_A, 'ru'), { status: 'published', path: '/ru/old-ru-slug/' });
assert.deepEqual(resolveLogicalContentReference(contentIndex, CONTENT_A, 'en'), { status: 'unpublished_locale', path: null }, 'no HY fallback');
assert.deepEqual(resolveLogicalContentReference(contentIndex, CONTENT_DRAFT, 'ru'), { status: 'unpublished_locale', path: null }, 'draft-only has no path');
assert.deepEqual(resolveLogicalContentReference(contentIndex, CONTENT_BOTH, 'ru'), { status: 'published', path: '/ru/published-not-draft/' });
assert.deepEqual(resolveLogicalContentReference(contentIndex, CONTENT_OUTDATED, 'ru'), { status: 'published', path: '/ru/outdated-published/' });
assert.deepEqual(resolveLogicalContentReference(contentIndex, MISSING, 'ru'), { status: 'missing_content', path: null });
assert.throws(() => resolveLogicalContentReference(contentIndex, 'not-a-uuid', 'ru'));
assert.equal(resolveLogicalContentReference(contentIndex, CONTENT_A, 'ru').path, '/ru/old-ru-slug/', 'slug is a resolved value, not identity');

const repository = scanContentStore(path.resolve('src/data/content/dreams'));
const publishedIndex = buildPublishedContentLinkIndex(repository);
assert.equal(publishedIndex.pathsByContentId.get(EN_PILOT)?.get('en'), '/en/tar-musical-instrument-dream-meaning/');
assert.equal(publishedIndex.pathsByContentId.get(EN_PILOT)?.get('ru') ?? null, null, 'actual published projection has no RU fallback');

const mediaIndex = loadMediaManifest();
const bexer = resolveLogicalAssetReference(mediaIndex, BEXER_ASSET);
assert.equal(bexer.public_url, 'https://images.erazahan.info/posts/erazahan-bexer-2.webp');
assert.equal(resolveLogicalAssetReference(mediaIndex, BAD_ASSET)?.public_url, 'https://images.erazahan.info/posts/erazahan-bad.webp');
assert.equal(resolveLogicalAssetReference(mediaIndex, MISSING_ASSET), null);
assert.throws(() => resolveLogicalAssetReference(mediaIndex, 'not-a-uuid'));
assert.throws(() => resolveLogicalAssetReference(mediaIndex, CONTENT_A));
assert.throws(() => resolveLogicalAssetReference(mediaIndex, BEXER_ASSET.toUpperCase()));

const movableAsset = {
  schema_version: 1,
  assets: [{ asset_id: BEXER_ASSET, public_url: 'https://old.example.test/image.webp' }],
};
const movedAsset = structuredClone(movableAsset);
movedAsset.assets[0].public_url = 'https://new.example.test/image.webp';
assert.equal(resolveLogicalAssetReference(createMediaManifestIndex(movedAsset), BEXER_ASSET).public_url, 'https://new.example.test/image.webp');
assert.equal(parseLogicalAssetReference(`asset://${BEXER_ASSET}`).asset_id, BEXER_ASSET, 'URL movement does not change body identity');

for (const invalid of [
  { schema_version: 1, assets: [{ asset_id: BEXER_ASSET, public_url: 'http://example.test/a.webp' }] },
  { schema_version: 1, assets: [{ asset_id: CONTENT_A, public_url: 'https://example.test/a.webp' }] },
  { schema_version: 1, assets: [{ asset_id: BEXER_ASSET.toUpperCase(), public_url: 'https://example.test/a.webp' }] },
  { schema_version: 1, assets: [{ asset_id: BEXER_ASSET, public_url: 'https://example.test/a.webp', image_alts: {} }] },
  { schema_version: 1, assets: [movableAsset.assets[0], movableAsset.assets[0]] },
  { schema_version: 1, assets: [movableAsset.assets[0], { ...movableAsset.assets[0], asset_id: BEXER_ASSET.toUpperCase() }] },
]) assert.throws(() => createMediaManifestIndex(invalid));

assert.deepEqual(imageAltState({ [BEXER_ASSET]: '' }, BEXER_ASSET), { supplied: true, decorative: true, alt: '' });
assert.deepEqual(imageAltState({ [BEXER_ASSET]: 'Localized descriptive alt' }, BEXER_ASSET), { supplied: true, decorative: false, alt: 'Localized descriptive alt' });
assert.deepEqual(imageAltState({}, BEXER_ASSET), { supplied: false, decorative: false, alt: null });

console.log('LOGICAL CONTENT AND MEDIA REFERENCE CONTRACTS PASS');
