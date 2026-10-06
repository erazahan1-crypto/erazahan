import assert from 'node:assert/strict';
import { generateUuidV7, prepareAtomicHyCreate } from '../../functions/_lib/admin-atomic-hy-write.mjs';
import { projectExistingHyPostUpdate, projectNativeHyPostCreate, validateHyRegistryEntries } from '../../src/lib/content-write/project-hy-post.mjs';
import { listOccupiedNativeHySlugs } from '../../src/lib/content-schema/hy-public-route-reservations.mjs';

const contentId = generateUuidV7(1_700_000_000_000, (bytes) => bytes.fill(1));
assert.match(contentId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const posts = [{ slug: 'old', title: 'Old', date: '2026-01-01', letter: 'A', categories: ['old'], content: 'old', sourceUrl: 'https://erazahan.info/old/', comments: [] }];
const registry = { entries: [{ content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', legacy: { original_array_index: 0, original_hy_slug: 'old', original_source_url: posts[0].sourceUrl } }] };
const files = new Map([
  ['src/data/posts.json', { sha: 'posts-sha', content: JSON.stringify(posts) }],
  ['src/data/migrations/content-id-registry.v1.json', { sha: 'registry-sha', content: JSON.stringify(registry) }],
]);
const snapshot = { branch: 'main', refSha: 'ref', commitSha: 'commit', treeSha: 'tree', files };
const description = 'Native description';
let reads = 0;
const prepared = await prepareAtomicHyCreate({
  snapshot,
  editedPost: { slug: 'erazahan-fixture', title: 'New', description, date: '2026-02-03', letter: 'N', categories: ['test'], content: 'native content', sourceUrl: 'ignored' },
  contentId,
  createdAt: '2026-02-03T04:05:06.000Z',
  loadSnapshotFiles: async (base, paths) => { reads += 1; return { ...base, files: new Map([...base.files, ...paths.map((path) => [path, null])]) }; },
});
assert.equal(reads, 1);
assert.equal(prepared.postIndex, 1);
assert.equal(prepared.updatedPosts.length, 2);
assert.deepEqual(prepared.projection.registryEntry.native, { post_index: 1, source_url: 'https://erazahan.info/erazahan-fixture/', slug: 'erazahan-fixture', created_at: '2026-02-03T04:05:06.000Z' });
assert.equal(prepared.projection.item.source_revision, 1);
assert.equal(prepared.projection.hy.published.version, 1);
assert.equal(prepared.projection.post.description, description);
assert.equal(prepared.updatedPosts[1].description, description);
assert.equal(prepared.projection.hy.published.description, description);
assert.equal(JSON.parse(prepared.projection.serialized.hy).published.description, description);
assert.equal(prepared.changes.filter((change) => change.operation === 'create').length, 2);

const omittedDescription = projectNativeHyPostCreate({
  contentId: generateUuidV7(1_700_000_000_001, (bytes) => bytes.fill(2)),
  postIndex: 1,
  editedPost: { slug: 'without-description', title: 'No description', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content', sourceUrl: 'ignored' },
  sourceUrl: 'https://erazahan.info/without-description/',
  createdAt: '2026-02-03T04:05:06.000Z',
});
assert.equal(Object.hasOwn(omittedDescription.post, 'description'), false);
assert.equal(omittedDescription.hy.published.description, null);

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
assert.throws(() => projectExistingHyPostUpdate({
  postIndex: prepared.postIndex,
  currentPost: prepared.projection.post,
  editedPost: { ...prepared.projection.post, slug: 'renamed-hy' },
  registryEntries: [...registry.entries, prepared.projection.registryEntry],
  currentItem: prepared.projection.item,
  currentHy: prepared.projection.hy,
  itemPath: `src/data/content/dreams/${contentId.slice(0, 2)}/${contentId}/item.json`,
  hyPath: `src/data/content/dreams/${contentId.slice(0, 2)}/${contentId}/hy.json`,
}), { code: 'SLUG_IMMUTABLE' });

const occupied = listOccupiedNativeHySlugs(posts);
for (const slug of ['search', 'ru', 'en', 'chgtnvac-erazner', 'baxtagushakutyun']) assert.ok(occupied.includes(slug), `${slug} is an occupied public path`);
async function expectRouteCollision(slug, expectedCode = 'PUBLIC_ROUTE_COLLISION', targetSnapshot = snapshot) {
  let collisionReads = 0;
  const filesBefore = targetSnapshot.files.size;
  await assert.rejects(() => prepareAtomicHyCreate({
    snapshot: targetSnapshot,
    editedPost: { slug, title: 'New', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' },
    contentId: generateUuidV7(1_700_000_000_100 + slug.length, (bytes) => bytes.fill(slug.length)),
    createdAt: '2026-02-03T04:05:06.000Z',
    loadSnapshotFiles: async () => { collisionReads += 1; return targetSnapshot; },
  }), { code: expectedCode });
  assert.equal(collisionReads, 0, `${slug}: rejection occurs before content-file reads`);
  assert.equal(targetSnapshot.files.size, filesBefore, `${slug}: rejection leaves the snapshot unchanged`);
}
for (const slug of ['search', 'ru', 'en', 'chgtnvac-erazner', 'baxtagushakutyun']) await expectRouteCollision(slug);
const namedPosts = [{ ...posts[0], title: 'Արամ անվան նշանակությունը', categories: ['Արական Անունների Նշանակությունը'] }];
const namedSnapshot = { ...snapshot, files: new Map([...snapshot.files, [
  'src/data/posts.json', { sha: 'named-posts-sha', content: JSON.stringify(namedPosts) },
]]) };
const dynamicNamePath = 'արական-անուններ-սկսվող-ա-տառով';
assert.ok(listOccupiedNativeHySlugs(namedPosts).includes(dynamicNamePath), 'generated name route is reserved');
await expectRouteCollision(dynamicNamePath, 'PUBLIC_ROUTE_COLLISION', namedSnapshot);
await expectRouteCollision('old', 'SLUG_COLLISION');
for (const slug of ['ru-example', 'en-example', 'search-example']) {
  let allowedReads = 0;
  const allowed = await prepareAtomicHyCreate({
    snapshot,
    editedPost: { slug, title: 'Allowed', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' },
    contentId: generateUuidV7(1_700_000_000_200 + slug.length, (bytes) => bytes.fill(slug.length + 1)),
    createdAt: '2026-02-03T04:05:06.000Z',
    loadSnapshotFiles: async (base, paths) => { allowedReads += 1; return { ...base, files: new Map([...base.files, ...paths.map((path) => [path, null])]) }; },
  });
  assert.equal(allowed.postIndex, 1, `${slug}: non-colliding prefix remains allowed`);
  assert.equal(allowedReads, 1, `${slug}: normal transaction preparation remains available`);
}

await assert.rejects(() => prepareAtomicHyCreate({ snapshot, editedPost: { slug: 'old', title: 'New', date: '2026-02-03', letter: null, categories: ['test'], content: 'native content' }, contentId: registry.entries[0].content_id, createdAt: '2026-02-03T04:05:06.000Z', loadSnapshotFiles: async () => snapshot }), { code: 'CONTENT_ID_COLLISION' });
for (const [invalidEntry, code] of [
  [{ content_id: contentId }, 'INVALID_REGISTRY_VARIANT'],
  [{ content_id: contentId, legacy: registry.entries[0].legacy, native: prepared.projection.registryEntry.native }, 'INVALID_REGISTRY_VARIANT'],
  [{ content_id: contentId, native: { post_index: 1, source_url: 'not a URL', slug: 'erazahan-fixture', created_at: 'bad' } }, 'INVALID_REGISTRY'],
]) assert.throws(() => validateHyRegistryEntries([invalidEntry]), { code });

console.log('ADMIN NATIVE HY CREATE PASS');
