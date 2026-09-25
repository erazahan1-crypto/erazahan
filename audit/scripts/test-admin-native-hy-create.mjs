import assert from 'node:assert/strict';
import {
  generateUuidV7,
  prepareAtomicHyCreate,
} from '../../functions/_lib/admin-atomic-hy-write.mjs';
import { projectExistingHyPostUpdate, validateHyRegistryEntries } from '../../src/lib/content-write/project-hy-post.mjs';

const contentId = generateUuidV7(1_700_000_000_000, (bytes) => bytes.fill(1));
assert.match(contentId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const posts = [{ slug: 'old', title: 'Old', date: '2026-01-01', letter: 'Օ', categories: ['old'], content: 'old', sourceUrl: 'https://erazahan.info/old/', comments: [] }];
const registry = { entries: [{ content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', legacy: { original_array_index: 0, original_hy_slug: 'old', original_source_url: posts[0].sourceUrl } }] };
const files = new Map([
  ['src/data/posts.json', { sha: 'posts-sha', content: JSON.stringify(posts) }],
  ['src/data/migrations/content-id-registry.v1.json', { sha: 'registry-sha', content: JSON.stringify(registry) }],
]);
const snapshot = { branch: 'main', refSha: 'ref', commitSha: 'commit', treeSha: 'tree', files };
let reads = 0;
const prepared = await prepareAtomicHyCreate({
  snapshot,
  editedPost: { slug: 'new-hy', title: 'New', date: '2026-02-03', letter: 'Ն', categories: ['test'], content: 'native content', sourceUrl: 'ignored' },
  contentId,
  createdAt: '2026-02-03T04:05:06.000Z',
  loadSnapshotFiles: async (base, paths) => { reads += 1; return { ...base, files: new Map([...base.files, ...paths.map((path) => [path, null])]) }; },
});
assert.equal(reads, 1);
assert.equal(prepared.postIndex, 1);
assert.equal(prepared.updatedPosts.length, 2);
assert.deepEqual(prepared.projection.registryEntry.native, { post_index: 1, source_url: 'https://erazahan.info/new-hy/', slug: 'new-hy', created_at: '2026-02-03T04:05:06.000Z' });
assert.equal(prepared.projection.item.source_revision, 1);
assert.equal(prepared.projection.hy.published.version, 1);
assert.equal(prepared.changes.filter((change) => change.operation === 'create').length, 2);
const nativeUpdate = projectExistingHyPostUpdate({
  postIndex: prepared.postIndex,
  currentPost: prepared.projection.post,
  editedPost: { ...prepared.projection.post, title: 'New title' },
  registryEntries: [...registry.entries, prepared.projection.registryEntry],
  currentItem: prepared.projection.item,
  currentHy: prepared.projection.hy,
  itemPath: `src/data/content/dreams/${contentId.slice(0, 2)}/${contentId}/item.json`,
  hyPath: `src/data/content/dreams/${contentId.slice(0, 2)}/${contentId}/hy.json`,
});
assert.equal(nativeUpdate.updatedHy.published.title, 'New title');
assert.equal(nativeUpdate.updatedHy.published.version, 2);
await assert.rejects(() => prepareAtomicHyCreate({ ...{ snapshot, editedPost: { slug: 'old', title: 'New', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' }, contentId, createdAt: '2026-02-03T04:05:06.000Z', loadSnapshotFiles: async () => snapshot } }), { code: 'SLUG_COLLISION' });
await assert.rejects(() => prepareAtomicHyCreate({ ...{ snapshot, editedPost: { slug: 'admin', title: 'New', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' }, contentId, createdAt: '2026-02-03T04:05:06.000Z', loadSnapshotFiles: async () => snapshot } }), { code: 'SLUG_RESERVED' });
await assert.rejects(() => prepareAtomicHyCreate({ ...{ snapshot, editedPost: { slug: 'new-hy', title: 'New', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' }, contentId: registry.entries[0].content_id, createdAt: '2026-02-03T04:05:06.000Z', loadSnapshotFiles: async () => snapshot } }), { code: 'CONTENT_ID_COLLISION' });
assert.equal(registry.entries[0].legacy.original_array_index, 0);
for (const [invalidEntry, code] of [
  [{ content_id: contentId }, 'INVALID_REGISTRY_VARIANT'],
  [{ content_id: contentId, legacy: registry.entries[0].legacy, native: prepared.projection.registryEntry.native }, 'INVALID_REGISTRY_VARIANT'],
  [{ content_id: contentId, native: { post_index: 1, source_url: 'not a URL', slug: 'new-hy', created_at: 'bad' } }, 'INVALID_REGISTRY'],
]) {
  assert.throws(() => validateHyRegistryEntries([invalidEntry]), { code });
}
console.log('ADMIN NATIVE HY CREATE PASS');
