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
const NEW_A = 'src/data/content/dreams/aa/aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa/ru.json';
const NEW_B = 'src/data/content/dreams/aa/aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa/en.json';

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
const missingSnapshot = await snapshot(missingSnapshotFile);
assert.equal(missingSnapshot.files.has(HY), true);
assert.equal(missingSnapshot.files.get(HY), null);

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

const explicitUpdate = fakeClient();
const explicitUpdateSnapshot = await snapshot(explicitUpdate, [POSTS]);
assert.deepEqual((await commitMultiFileTransaction(explicitUpdate.client, {
  snapshot: explicitUpdateSnapshot,
  changes: [{ operation: 'update', path: POSTS, content: '[{"slug":"explicit"}]' }],
  message: 'explicit update',
})).changedPaths, [POSTS]);

const createOne = fakeClient();
const createOneSnapshot = await snapshot(createOne, [POSTS, NEW_A]);
const createOneResult = await commitMultiFileTransaction(createOne.client, {
  snapshot: createOneSnapshot,
  changes: [{ operation: 'create', path: NEW_A, content: '' }],
  message: 'create empty',
});
assert.deepEqual(createOneResult.changedPaths, [NEW_A]);
assert.deepEqual(createOne.calls.blobs, ['']);
assert.deepEqual(createOne.calls.trees[0].entries, [{ path: NEW_A, mode: '100644', type: 'blob', sha: 'blob-1' }]);
assert.equal(createOne.calls.commits.length, 1);
assert.deepEqual(createOne.calls.updates, [{ branch: 'main', sha: 'new-commit-sha', force: false }]);

const createMany = fakeClient();
const createManySnapshot = await snapshot(createMany, [POSTS, NEW_A, NEW_B]);
const createManyResult = await commitMultiFileTransaction(createMany.client, {
  snapshot: createManySnapshot,
  changes: [
    { operation: 'create', path: NEW_A, content: 'ru' },
    { operation: 'create', path: NEW_B, content: 'en' },
    { operation: 'update', path: POSTS, content: '[{"slug":"created"}]' },
  ],
  message: 'create and update',
});
assert.deepEqual(createManyResult.changedPaths, [NEW_A, NEW_B, POSTS]);
assert.equal(createMany.calls.trees.length, 1);
assert.equal(createMany.calls.commits.length, 1);
assert.equal(createMany.calls.updates.length, 1);

const createExisting = fakeClient();
const createExistingSnapshot = await snapshot(createExisting, [POSTS]);
await expectCode('CREATE_TARGET_EXISTS', () => commitMultiFileTransaction(createExisting.client, {
  snapshot: createExistingSnapshot, changes: [{ operation: 'create', path: POSTS, content: 'bad' }], message: 'existing create',
}));

const missingCreate = fakeClient();
const missingCreateSnapshot = await snapshot(missingCreate, [POSTS]);
await expectCode('SNAPSHOT_FILE_UNREPRESENTED', () => commitMultiFileTransaction(missingCreate.client, {
  snapshot: missingCreateSnapshot, changes: [{ operation: 'create', path: NEW_A, content: 'bad' }], message: 'unrepresented create',
}));
await expectCode('UPDATE_TARGET_MISSING', () => commitMultiFileTransaction(missingCreate.client, {
  snapshot: { ...missingCreateSnapshot, files: new Map([...missingCreateSnapshot.files, [NEW_A, null]]) },
  changes: [{ operation: 'update', path: NEW_A, content: 'bad' }], message: 'missing update',
}));

for (const changes of [
  [{ operation: 'create', path: NEW_A, content: 'a' }, { operation: 'create', path: NEW_A, content: 'b' }],
  [{ operation: 'create', path: NEW_A, content: 'a' }, { operation: 'update', path: NEW_A, content: 'b' }],
  [{ operation: 'create', path: NEW_A, content: 'a' }, { operation: 'delete', path: NEW_A }],
  [{ operation: 'delete', path: ITEM }, { operation: 'delete', path: ITEM }],
]) {
  await expectCode('DUPLICATE_REPOSITORY_PATH', () => commitMultiFileTransaction(missingCreate.client, {
    snapshot: { ...missingCreateSnapshot, files: new Map([...missingCreateSnapshot.files, [NEW_A, null]]) }, changes, message: 'duplicate operation path',
  }));
}

const deleteOne = fakeClient();
const deleteOneSnapshot = await snapshot(deleteOne, [POSTS, ITEM]);
const deleteOneResult = await commitMultiFileTransaction(deleteOne.client, {
  snapshot: deleteOneSnapshot,
  changes: [{ operation: 'delete', path: ITEM }, { operation: 'update', path: POSTS, content: '[{"slug":"deleted"}]' }],
  message: 'delete and update',
});
assert.deepEqual(deleteOneResult.changedPaths, [ITEM, POSTS]);
assert.equal(deleteOne.calls.blobs.length, 1);
assert.deepEqual(deleteOne.calls.trees[0].entries[0], { path: ITEM, sha: null });

const deleteMixed = fakeClient();
const deleteMixedSnapshot = await snapshot(deleteMixed, [POSTS, ITEM, NEW_A]);
await commitMultiFileTransaction(deleteMixed.client, {
  snapshot: deleteMixedSnapshot,
  changes: [{ operation: 'delete', path: ITEM }, { operation: 'create', path: NEW_A, content: 'new' }],
  message: 'delete and create',
});
assert.equal(deleteMixed.calls.trees.length, 1);
assert.equal(deleteMixed.calls.commits.length, 1);
assert.equal(deleteMixed.calls.updates.length, 1);

const deleteMissing = fakeClient();
const deleteMissingSnapshot = await snapshot(deleteMissing, [POSTS, NEW_A]);
await expectCode('DELETE_TARGET_MISSING', () => commitMultiFileTransaction(deleteMissing.client, {
  snapshot: deleteMissingSnapshot, changes: [{ operation: 'delete', path: NEW_A }], message: 'missing delete',
}));
await expectCode('SNAPSHOT_FILE_UNREPRESENTED', () => commitMultiFileTransaction(deleteMissing.client, {
  snapshot: deleteMissingSnapshot, changes: [{ operation: 'delete', path: ITEM }], message: 'unrepresented delete',
}));
await expectCode('INVALID_CHANGE_CONTENT', () => commitMultiFileTransaction(deleteMissing.client, {
  snapshot: deleteMissingSnapshot, changes: [{ operation: 'delete', path: NEW_A, content: '' }], message: 'delete content',
}));
await expectCode('INVALID_CHANGE_OPERATION', () => commitMultiFileTransaction(deleteMissing.client, {
  snapshot: deleteMissingSnapshot, changes: [{ operation: 'rename', path: NEW_A, content: '' }], message: 'unknown operation',
}));

for (const [operation, path] of [['create', NEW_A], ['delete', ITEM]]) {
  const raced = fakeClient({ failAt: 'refConflict' });
  const racedSnapshot = await snapshot(raced, operation === 'create' ? [POSTS, NEW_A] : [POSTS, ITEM]);
  await assert.rejects(() => commitMultiFileTransaction(raced.client, {
    snapshot: racedSnapshot, changes: [operation === 'create'
      ? { operation, path, content: 'raced' }
      : { operation, path }], message: `${operation} race`,
  }), (error) => error instanceof GitHubBranchConflictError && error.code === 'BRANCH_REF_CONFLICT');
  assert.equal(raced.calls.updates[0].force, false);
}

const guarded = fakeClient();
const guardedSnapshot = await snapshot(guarded, [ITEM]);
await commitMultiFileTransaction(guarded.client, {
  snapshot: guardedSnapshot,
  expectedFileShas: { [ITEM]: 'item-sha' },
  changes: [{ operation: 'update', path: ITEM, content: '{"item":2}\n' }], message: 'generic guard',
});
await expectCode('STALE_FILE_VERSION', () => commitMultiFileTransaction(guarded.client, {
  snapshot: guardedSnapshot, expectedFileShas: { [ITEM]: 'other-sha' },
  changes: [{ operation: 'update', path: ITEM, content: '{"item":2}\n' }], message: 'stale generic guard',
}));
const postsGuardSnapshot = await snapshot(guarded, [POSTS]);
await expectCode('EXPECTED_FILE_SHA_CONFLICT', () => commitMultiFileTransaction(guarded.client, {
  snapshot: postsGuardSnapshot, expectedPostsBlobSha: 'posts-sha', expectedFileShas: { [POSTS]: 'other-sha' },
  changes: [{ path: POSTS, content: 'new' }], message: 'guard conflict',
}));

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
  explicit_create_delete_operations: true,
  snapshot_absence_explicitly_represented: true,
  generic_expected_file_guard: true,
}, null, 2));
