import assert from 'node:assert/strict';
import {
  GitHubBranchConflictError,
  GitHubTransactionError,
  commitMultiFileTransaction,
  loadSnapshotFiles,
  loadMultiFileSnapshot,
} from '../../functions/_lib/github-multifile.mjs';

const POSTS = 'src/data/posts.json';
const ITEM = 'src/data/content/dreams/aa/aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa/item.json';
const HY = 'src/data/content/dreams/aa/aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa/hy.json';

function fakeClient({ files = {}, failAt = null } = {}) {
  const currentFiles = new Map(Object.entries({
    [POSTS]: { sha: 'posts-sha', content: '[{"slug":"old"}]' },
    [ITEM]: { sha: 'item-sha', content: '{"item":1}\n' },
    [HY]: { sha: 'hy-sha', content: '{"hy":1}\n' },
    ...files,
  }));
  const calls = {
    ref: [], commitLookup: [], reads: [], blobs: [], trees: [], commits: [], updates: [],
  };
  const fail = (stage) => {
    if (failAt === stage) throw new Error(`${stage} failure`);
  };
  const client = {
    async getBranchRef(branch) {
      calls.ref.push(branch);
      fail('ref');
      return { sha: 'commit-sha' };
    },
    async getCommit(sha) {
      calls.commitLookup.push(sha);
      fail('commitLookup');
      return { treeSha: 'tree-sha' };
    },
    async readFileFromTree(treeSha, filePath) {
      calls.reads.push({ treeSha, filePath });
      fail('read');
      return currentFiles.get(filePath) ?? null;
    },
    async createBlob(content) {
      calls.blobs.push(content);
      fail('blob');
      return { sha: `blob-${calls.blobs.length}` };
    },
    async createTree(value) {
      calls.trees.push(value);
      fail('tree');
      return { sha: 'new-tree-sha' };
    },
    async createCommit(value) {
      calls.commits.push(value);
      fail('commit');
      return { sha: 'new-commit-sha' };
    },
    async updateBranchRef(value) {
      calls.updates.push(value);
      if (failAt === 'refConflict') {
        const error = new Error('branch advanced');
        error.status = 422;
        throw error;
      }
      fail('refUpdate');
      return { sha: value.sha };
    },
  };
  return { client, calls };
}

async function snapshot(fake, paths = [POSTS, ITEM, HY]) {
  return loadMultiFileSnapshot(fake.client, { branch: 'main', paths });
}

function expectCode(code, operation) {
  return assert.rejects(operation, (error) => error instanceof GitHubTransactionError && error.code === code);
}

const initial = fakeClient();
const initialSnapshot = await snapshot(initial);
assert.equal(initialSnapshot.refSha, 'commit-sha');
assert.equal(initialSnapshot.commitSha, 'commit-sha');
assert.equal(initialSnapshot.treeSha, 'tree-sha');
assert.deepEqual(initial.calls.reads.map((call) => call.treeSha), ['tree-sha', 'tree-sha', 'tree-sha']);

const dynamic = fakeClient();
const dynamicInitial = await snapshot(dynamic, [POSTS]);
const dynamicFull = await loadSnapshotFiles(dynamic.client, dynamicInitial, [ITEM, HY]);
assert.equal(dynamic.calls.ref.length, 1, 'dynamic reads do not resolve the branch again');
assert.equal(dynamic.calls.commitLookup.length, 1, 'dynamic reads do not resolve the commit again');
assert.deepEqual(dynamic.calls.reads.map((call) => call.treeSha), ['tree-sha', 'tree-sha', 'tree-sha']);
assert.deepEqual([...dynamicFull.files.keys()], [POSTS, ITEM, HY]);

const missingSnapshotFile = fakeClient({ files: { [HY]: undefined } });
await expectCode('SNAPSHOT_FILE_MISSING', () => snapshot(missingSnapshotFile));

const single = fakeClient();
const singleSnapshot = await snapshot(single, [POSTS]);
const singleResult = await commitMultiFileTransaction(single.client, {
  snapshot: singleSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [{ path: POSTS, content: '[{"slug":"new"}]' }],
  message: 'single file',
});
assert.equal(singleResult.noOp, false);
assert.deepEqual(singleResult.changedPaths, [POSTS]);
assert.equal(single.calls.blobs.length, 1);
assert.equal(single.calls.trees.length, 1);
assert.equal(single.calls.commits.length, 1);
assert.equal(single.calls.updates.length, 1);
assert.equal(single.calls.trees[0].baseTreeSha, 'tree-sha');
assert.deepEqual(single.calls.commits[0].parentCommitSha, 'commit-sha');
assert.equal(single.calls.updates[0].force, false);

const multi = fakeClient();
const multiSnapshot = await snapshot(multi);
const multiResult = await commitMultiFileTransaction(multi.client, {
  snapshot: multiSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [
    { path: POSTS, content: '[{"slug":"new"}]' },
    { path: ITEM, content: '{"item":2}\n' },
    { path: HY, content: '{"hy":2}\n' },
  ],
  message: 'three files',
});
assert.deepEqual(multiResult.changedPaths, [POSTS, ITEM, HY]);
assert.equal(multi.calls.blobs.length, 3);
assert.equal(multi.calls.trees.length, 1);
assert.equal(multi.calls.trees[0].entries.length, 3);
assert.equal(multi.calls.commits.length, 1);
assert.equal(multi.calls.updates.length, 1);

const skip = fakeClient();
const skipSnapshot = await snapshot(skip);
const skipResult = await commitMultiFileTransaction(skip.client, {
  snapshot: skipSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [
    { path: POSTS, content: '[{"slug":"new"}]' },
    { path: ITEM, content: '{"item":1}\n' },
    { path: HY, content: '{"hy":2}\n' },
  ],
  message: 'skip unchanged',
});
assert.deepEqual(skipResult.changedPaths, [POSTS, HY]);
assert.equal(skip.calls.blobs.length, 2);
assert.equal(skip.calls.trees[0].entries.length, 2);

const noOp = fakeClient();
const noOpSnapshot = await snapshot(noOp);
const noOpResult = await commitMultiFileTransaction(noOp.client, {
  snapshot: noOpSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [
    { path: POSTS, content: '[{"slug":"old"}]' },
    { path: ITEM, content: '{"item":1}\n' },
    { path: HY, content: '{"hy":1}\n' },
  ],
  message: 'no op',
});
assert.equal(noOpResult.noOp, true);
assert.equal(noOp.calls.blobs.length, 0);
assert.equal(noOp.calls.trees.length, 0);
assert.equal(noOp.calls.commits.length, 0);
assert.equal(noOp.calls.updates.length, 0);

const duplicate = fakeClient();
const duplicateSnapshot = await snapshot(duplicate);
await expectCode('DUPLICATE_REPOSITORY_PATH', () => commitMultiFileTransaction(duplicate.client, {
  snapshot: duplicateSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [{ path: POSTS, content: 'a' }, { path: POSTS, content: 'b' }],
  message: 'duplicate',
}));
assert.equal(duplicate.calls.blobs.length, 0);

const invalidPath = fakeClient();
const invalidPathSnapshot = await snapshot(invalidPath);
await expectCode('INVALID_REPOSITORY_PATH', () => commitMultiFileTransaction(invalidPath.client, {
  snapshot: invalidPathSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [{ path: '../posts.json', content: 'bad' }],
  message: 'invalid path',
}));

const stale = fakeClient();
const staleSnapshot = await snapshot(stale);
await expectCode('STALE_POSTS_VERSION', () => commitMultiFileTransaction(stale.client, {
  snapshot: staleSnapshot,
  expectedPostsBlobSha: 'stale-sha',
  changes: [{ path: POSTS, content: 'new' }],
  message: 'stale',
}));
assert.equal(stale.calls.blobs.length, 0);

for (const [failAt, code, expected] of [
  ['blob', 'BLOB_CREATION_FAILURE', ['trees', 0, 'commits', 0, 'updates', 0]],
  ['tree', 'TREE_CREATION_FAILURE', ['commits', 0, 'updates', 0]],
  ['commit', 'COMMIT_CREATION_FAILURE', ['updates', 0]],
]) {
  const failed = fakeClient({ failAt });
  const failedSnapshot = await snapshot(failed);
  await expectCode(code, () => commitMultiFileTransaction(failed.client, {
    snapshot: failedSnapshot,
    expectedPostsBlobSha: 'posts-sha',
    changes: [{ path: POSTS, content: 'new' }],
    message: `${failAt} failure`,
  }));
  for (let index = 0; index < expected.length; index += 2) {
    assert.equal(failed.calls[expected[index]].length, expected[index + 1], `${failAt}: no fallback ${expected[index]}`);
  }
}

const conflict = fakeClient({ failAt: 'refConflict' });
const conflictSnapshot = await snapshot(conflict);
await assert.rejects(
  () => commitMultiFileTransaction(conflict.client, {
    snapshot: conflictSnapshot,
    expectedPostsBlobSha: 'posts-sha',
    changes: [{ path: POSTS, content: 'new' }],
    message: 'branch conflict',
  }),
  (error) => error instanceof GitHubBranchConflictError && error.code === 'BRANCH_REF_CONFLICT',
);
assert.equal(conflict.calls.commits.length, 1);
assert.equal(conflict.calls.updates.length, 1);
assert.equal(conflict.calls.trees.length, 1);

const ambiguous = fakeClient({ failAt: 'refUpdate' });
const ambiguousSnapshot = await snapshot(ambiguous);
await expectCode('BRANCH_REF_UPDATE_FAILURE', () => commitMultiFileTransaction(ambiguous.client, {
  snapshot: ambiguousSnapshot,
  expectedPostsBlobSha: 'posts-sha',
  changes: [{ path: POSTS, content: 'new' }],
  message: 'ambiguous ref result',
}));
assert.equal(ambiguous.calls.commits.length, 1, 'ambiguous result does not create a second commit');
assert.equal(ambiguous.calls.updates.length, 1, 'ambiguous result does not retry the ref update');

console.log('GITHUB MULTI-FILE TRANSACTION PASS');
console.log(JSON.stringify({
  snapshot_same_ref_commit_tree: true,
  dynamic_files_from_same_tree: true,
  single_file_backward_compatible_shape: true,
  three_file_single_commit: true,
  unchanged_skipped: true,
  no_op_without_ref_update: true,
  stale_posts_conflict: true,
  branch_ref_conflict: true,
  ambiguous_ref_result_does_not_retry: true,
  no_partial_fallback: true,
  mocked_transport_only: true,
}, null, 2));
