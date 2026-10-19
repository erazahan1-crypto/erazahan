import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { createMediaManifestIndex } from '../../src/lib/content-source/media-manifest-contract.mjs';
import { extractHyImageReferences, projectHyImageReferences } from '../../src/lib/content-source/hy-legacy-images.mjs';
import { renderLocalizedContent } from '../../src/lib/localized-content-pipeline.mjs';
import { DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH } from '../../functions/_lib/admin-locale-draft-write.mjs';
import { MEDIA_MANIFEST_PATH, registerLegacyHyImage } from '../../functions/_lib/legacy-hy-media.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const OWNED = 'https://images.erazahan.info/posts/erazahan-bad.webp';
const EXTERNAL = 'https://example.test/image.webp';
const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: 'a'.repeat(64), fingerprint_spec_version: 1 };
const hy = (content) => ({ schema_version: 1, content_id: A, locale: 'hy', draft: null, published: { slug: 'hy-source', title: 'HY source', description: null, content, image_alts: {}, tags: [], alphabet_key: null, based_on_source_revision: null, based_on_source_fingerprint: null, version: 1, published_at: '2026-09-15' } });
const pathsFor = (contentId) => {
  const base = `src/data/content/dreams/${contentId.slice(0, 2)}/${contentId}`;
  return { item: `${base}/item.json`, hy: `${base}/hy.json`, en: `${base}/en.json`, ru: `${base}/ru.json` };
};

const extracted = extractHyImageReferences(`<img src="${OWNED}">\n![](${EXTERNAL})\n<img src="${OWNED}">`);
assert.deepEqual(extracted.map((entry) => entry.source_url), [OWNED, EXTERNAL], 'HTML and Markdown are discovered once per source URL');
const projected = projectHyImageReferences(`<img src="${OWNED}">\n![](${EXTERNAL})`, createMediaManifestIndex({ schema_version: 1, assets: [{ asset_id: '019c2a10-4e61-7a32-8c15-2a37bcf94d02', public_url: OWNED, mime_type: 'image/webp' }] }));
assert.deepEqual(projected.map((entry) => [entry.ownership, entry.asset_id !== null]), [['owned_r2', true], ['manual_review', false]], 'only approved R2 URLs become candidates');
assert.throws(() => createMediaManifestIndex({ schema_version: 1, assets: [
  { asset_id: '019c2a10-4e61-7a32-8c15-2a37bcf94d02', public_url: OWNED },
  { asset_id: '019c2a10-4e61-7b48-9e26-8d51ca0743f9', public_url: OWNED },
] }), /duplicate public_url/, 'one R2 public object has only one asset ID');

function fixture({ content = `<img src="${OWNED}">`, manifest = { schema_version: 1, assets: [] }, contentId = A, itemDocument = item, hyDocument = hy(content), ownedUrl = OWNED } = {}) {
  const paths = pathsFor(contentId);
  const files = new Map([
    [paths.item, { sha: 'item-sha', content: canonicalJson(itemDocument) }],
    [paths.hy, { sha: 'hy-sha', content: canonicalJson(hyDocument) }],
    [paths.en, null],
    [paths.ru, null],
    [DRAFT_CLAIMS_PATH, { sha: 'claims-sha', content: canonicalJson({ version: 1, claims: [] }) }],
    [PUBLISHED_RESERVATIONS_PATH, { sha: 'reservations-sha', content: canonicalJson({ version: 1, reservations: [] }) }],
    [MEDIA_MANIFEST_PATH, { sha: 'manifest-sha', content: canonicalJson(manifest) }],
  ]);
  const calls = { heads: 0, puts: 0, deletes: 0, entries: [] };
  const client = {
    async getBranchRef() { return { sha: 'commit-sha' }; }, async getCommit() { return { treeSha: 'tree-sha' }; },
    async readFileFromTree(_tree, path) { return files.get(path) ?? null; }, async createBlob() { return { sha: 'b'.repeat(40) }; },
    async createTree({ entries }) { calls.entries = entries; return { sha: 'tree-next' }; }, async createCommit() { return { sha: 'commit-next' }; }, async updateBranchRef() { return { sha: 'commit-next' }; },
  };
  const expectedKey = new URL(ownedUrl).pathname.slice(1);
  const bucket = { async head(key) { calls.heads += 1; assert.equal(key, expectedKey); return {}; }, async put() { calls.puts += 1; }, async delete() { calls.deletes += 1; } };
  return { client, bucket, calls, files, paths };
}

{ const test = fixture(); const result = await registerLegacyHyImage(test.client, { branch: 'main', contentId: A, locale: 'en', sourceUrl: OWNED, bucket: test.bucket }); assert.equal(result.changed, true); assert.match(result.asset.asset_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); assert.equal(test.calls.heads, 1); assert.equal(test.calls.puts, 0); assert.equal(test.calls.deletes, 0); assert.deepEqual(test.calls.entries.map((entry) => entry.path), [MEDIA_MANIFEST_PATH]); }
{ const asset = { asset_id: '019c2a10-4e61-7a32-8c15-2a37bcf94d02', public_url: OWNED, source_url: OWNED, mime_type: 'image/webp' }; const test = fixture({ manifest: { schema_version: 1, assets: [asset] } }); const result = await registerLegacyHyImage(test.client, { branch: 'main', contentId: A, locale: 'en', sourceUrl: OWNED, bucket: test.bucket }); assert.equal(result.changed, false); assert.equal(result.asset.asset_id, asset.asset_id); assert.equal(test.calls.heads, 0, 'registered assets are never re-imported'); }
{ const test = fixture({ content: `<img src="${EXTERNAL}">` }); await assert.rejects(() => registerLegacyHyImage(test.client, { branch: 'main', contentId: A, locale: 'en', sourceUrl: EXTERNAL, bucket: test.bucket }), (error) => error?.code === 'LEGACY_IMAGE_NOT_OWNED'); assert.equal(test.calls.heads, 0); }

// Regression: this exact image was created through the production HY admin
// pipeline. Registration must use the published snapshot rather than a stale
// local checkout, leave the HY item untouched, and create one reusable asset.
const DUCK_ID = '2973adfc-341e-5cba-a048-c0cb868bac5d';
const DUCK_URL = 'https://images.erazahan.info/posts/erazahan-badi-mis-utel.webp';
const DUCK_BASE = `src/data/content/dreams/${DUCK_ID.slice(0, 2)}/${DUCK_ID}`;
const duckItem = JSON.parse(readFileSync(`${DUCK_BASE}/item.json`, 'utf8'));
const duckHy = JSON.parse(readFileSync(`${DUCK_BASE}/hy.json`, 'utf8'));
const currentManifest = JSON.parse(readFileSync('src/data/content/media-manifest.v1.json', 'utf8'));
const duckReferences = extractHyImageReferences(duckHy.published.content);
assert.equal(duckItem.source_revision, 4, 'regression source is the production Admin revision');
assert.equal(duckHy.published.version, 4, 'regression source is the production published version');
assert.deepEqual(duckReferences.map((reference) => reference.source_url), [DUCK_URL], 'production HY image is discovered from canonical published content');
const registeredDuck = currentManifest.assets.find((asset) => asset.public_url === DUCK_URL);
assert.ok(registeredDuck, 'production HY image is registered once in the current manifest');
{ const test = fixture({ contentId: DUCK_ID, itemDocument: duckItem, hyDocument: duckHy, ownedUrl: DUCK_URL, manifest: currentManifest }); const result = await registerLegacyHyImage(test.client, { branch: 'main', contentId: DUCK_ID, locale: 'ru', sourceUrl: DUCK_URL, bucket: test.bucket }); assert.equal(result.changed, false); assert.equal(result.asset.asset_id, registeredDuck.asset_id); assert.equal(test.calls.heads, 0, 'current manifest reuses the existing asset without an R2 write'); }

{
  const test = fixture({ contentId: DUCK_ID, itemDocument: duckItem, hyDocument: duckHy, ownedUrl: DUCK_URL });
  const hyBefore = test.files.get(test.paths.hy).content;
  const itemBefore = test.files.get(test.paths.item).content;
  const first = await registerLegacyHyImage(test.client, { branch: 'main', contentId: DUCK_ID, locale: 'en', sourceUrl: DUCK_URL, bucket: test.bucket });
  assert.equal(first.changed, true);
  assert.equal(test.calls.heads, 1, 'first registration verifies the existing R2 object once');
  assert.equal(test.files.get(test.paths.hy).content, hyBefore, 'registration never rewrites canonical HY HTML');
  assert.equal(test.files.get(test.paths.item).content, itemBefore, 'registration never changes source revision or fingerprint');
  assert.deepEqual(test.calls.entries.map((entry) => entry.path), [MEDIA_MANIFEST_PATH], 'only the manifest participates in the atomic transaction');

  const second = fixture({ contentId: DUCK_ID, itemDocument: duckItem, hyDocument: duckHy, ownedUrl: DUCK_URL, manifest: { schema_version: 1, assets: [first.asset] } });
  const repeated = await registerLegacyHyImage(second.client, { branch: 'main', contentId: DUCK_ID, locale: 'ru', sourceUrl: DUCK_URL, bucket: second.bucket });
  assert.equal(repeated.changed, false, 'RU reuses the globally registered asset');
  assert.equal(repeated.asset.asset_id, first.asset.asset_id, 'RU and EN resolve one shared asset_id');
  assert.equal(second.calls.heads, 0, 'idempotent registration does not re-check or re-upload R2');

  const mediaIndex = createMediaManifestIndex({ schema_version: 1, assets: [first.asset] });
  const contentLinkIndex = { knownContentIds: new Set([DUCK_ID]), pathsByContentId: new Map() };
  const logicalImage = `![](asset://${first.asset.asset_id})`;
  const renderedEn = renderLocalizedContent({ content: logicalImage, imageAlts: { [first.asset.asset_id]: 'Duck meat dream image' }, locale: 'en', currentContentId: DUCK_ID, contentLinkIndex, mediaIndex });
  const renderedRu = renderLocalizedContent({ content: logicalImage, imageAlts: { [first.asset.asset_id]: 'Изображение сна об утином мясе' }, locale: 'ru', currentContentId: DUCK_ID, contentLinkIndex, mediaIndex });
  assert.match(renderedEn, /alt="Duck meat dream image"/);
  assert.match(renderedRu, /alt="Изображение сна об утином мясе"/);
}

console.log('HY LEGACY IMAGE INTEGRATION PASS');
