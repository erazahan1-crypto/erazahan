import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { GitHubCommitOutcomeUnknownError, commitMultiFileTransaction } from '../../functions/_lib/github-multifile.mjs';
import { committedImageDeletionPlan, deleteCommittedImageKeys, uploadedImageCleanupKeys } from '../../functions/_lib/media-lifecycle.mjs';
import { listPersistedManagedImageKeys, partitionManagedImageDeletes } from '../../functions/_lib/managed-asset-references.mjs';

const BEXER = '019c2a10-4e61-7a32-8c15-2a37bcf94d02';
const BAD = '019c2a10-4e61-7b48-9e26-8d51ca0743f9';
const BEXER_KEY = 'posts/erazahan-bexer-2.webp';
const BAD_KEY = 'posts/erazahan-bad.webp';
const ORPHAN_KEY = 'posts/erazahan-orphan.webp';
const manifest = JSON.parse(readFileSync('src/data/content/media-manifest.v1.json', 'utf8'));
const payload = (content, image_alts = {}) => ({ content, image_alts });
const emptyPosts = [{ content: '', cover: null }];

function plan(localeDocuments, keys = [BEXER_KEY]) {
  return partitionManagedImageDeletes({ posts: emptyPosts, localeDocuments, mediaManifest: manifest }, keys);
}

assert.deepEqual(plan([{ locale: 'en', published: payload(`![](asset://${BEXER})`) }]).retained, [BEXER_KEY], 'published EN reference blocks deletion');
assert.deepEqual(plan([{ locale: 'ru', published: payload(`![](asset://${BEXER})`) }]).safe, [], 'published RU reference has no delete plan');
assert.deepEqual(plan([{ locale: 'ru', published: payload(`![](asset://${BEXER})`) }, { locale: 'en', published: payload(`![](asset://${BEXER})`) }]).retained, [BEXER_KEY], 'RU and EN references block deletion together');
assert.deepEqual(plan([{ draft: payload(`![](asset://${BEXER})`) }]).retained, [BEXER_KEY], 'persisted draft reference blocks deletion');
assert.deepEqual(plan([{ published: payload(`![](asset://${BEXER})`) }], [BAD_KEY]).safe, [BAD_KEY], 'unrelated asset references do not block deletion');
assert.deepEqual(plan([], [ORPHAN_KEY]).safe, [ORPHAN_KEY], 'unreferenced managed object can be deleted');
assert.deepEqual(plan([{ published: payload('', { [BEXER]: 'Stored localized ALT' }) }]).retained, [BEXER_KEY], 'persisted image_alts conservatively protect their managed asset');

const actualPosts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
const repository = scanContentStore('src/data/content/dreams');
const localeDocuments = repository.records.flatMap((record) => [record.locales.ru, record.locales.en].filter(Boolean));
const actualKeys = listPersistedManagedImageKeys({ posts: actualPosts, localeDocuments, mediaManifest: manifest });
assert.ok(actualKeys.includes(BEXER_KEY), 'current Bexer localized reference resolves from asset_id to R2 key');
assert.ok(actualKeys.includes(BAD_KEY), 'current Bad localized references resolve from asset_id to R2 key');

assert.deepEqual(uploadedImageCleanupKeys('not_committed', [ORPHAN_KEY]), [ORPHAN_KEY], 'validation failure or explicit rejection can clean a new upload');
assert.deepEqual(uploadedImageCleanupKeys('committed', [ORPHAN_KEY]), [], 'confirmed commit retains referenced upload');
assert.deepEqual(uploadedImageCleanupKeys('unknown', [ORPHAN_KEY]), [], 'ambiguous branch update retains upload');
assert.deepEqual(committedImageDeletionPlan('unknown', { posts: emptyPosts, localeDocuments: [], mediaManifest: manifest }, [ORPHAN_KEY]).safe, [], 'old deletion never runs before confirmed commit');
assert.deepEqual(committedImageDeletionPlan('committed', { posts: emptyPosts, localeDocuments: [], mediaManifest: manifest }, [ORPHAN_KEY]).safe, [ORPHAN_KEY], 'old deletion runs only after confirmed commit and global reference check');

const deletedFromR2 = [];
const originalConsoleError = console.error;
console.error = () => {};
let deletionResult;
try {
  deletionResult = await deleteCommittedImageKeys({
    delete: async (key) => {
      if (key === BAD_KEY) throw new Error('R2 transient failure');
      deletedFromR2.push(key);
    },
  }, [ORPHAN_KEY, BAD_KEY]);
} finally {
  console.error = originalConsoleError;
}
assert.deepEqual(deletedFromR2, [ORPHAN_KEY], 'post-commit cleanup deletes independently safe keys');
assert.deepEqual(deletionResult.deleted, [ORPHAN_KEY], 'post-commit R2 success is recorded');
assert.deepEqual(deletionResult.failed, [BAD_KEY], 'post-commit R2 failure becomes a warning without rolling back content');

const transactionSnapshot = {
  branch: 'main', refSha: 'old-commit', commitSha: 'old-commit', treeSha: 'old-tree',
  files: new Map([['src/data/posts.json', { sha: 'posts-sha', content: '[]' }]]),
};
const ambiguousClient = {
  createBlob: async () => ({ sha: 'blob-sha' }),
  createTree: async () => ({ sha: 'tree-sha' }),
  createCommit: async () => ({ sha: 'commit-sha' }),
  updateBranchRef: async () => { throw new Error('connection reset after ref update attempt'); },
};
await assert.rejects(
  () => commitMultiFileTransaction(ambiguousClient, {
    snapshot: transactionSnapshot,
    expectedPostsBlobSha: 'posts-sha',
    changes: [{ path: 'src/data/posts.json', content: '[{"slug":"changed"}]' }],
    message: 'ambiguous update',
  }),
  (error) => error instanceof GitHubCommitOutcomeUnknownError && error.code === 'BRANCH_REF_UPDATE_FAILURE',
);

console.log('MANAGED ASSET LIFECYCLE PASS');
