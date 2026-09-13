import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { HyWriteProjectionError, hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import {
  AdminAtomicHyWriteError,
  POSTS_PATH,
  REGISTRY_PATH,
  assertAtomicSourceUrl,
  loadAtomicHyWriteSnapshot,
  prepareAtomicHyWrite,
  resolveAtomicGitHubBranch,
  resolveHyAdminWriteMode,
} from '../../functions/_lib/admin-atomic-hy-write.mjs';
import {
  commitMultiFileTransaction,
  loadMultiFileSnapshot,
  loadSnapshotFiles,
} from '../../functions/_lib/github-multifile.mjs';

const CONTENT_ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const PATHS = hyStorePaths(CONTENT_ID);
const POSTS_SHA = 'a'.repeat(40);

function fixture({ drift = false, content = '<p>Example content</p>' } = {}) {
  const published = {
    slug: 'example-dream', title: 'Example dream', description: 'Preserved description', content,
    image_alts: { 'asset:one': 'Preserved alt' }, tags: ['One', 'Two'], alphabet_key: 'A',
    based_on_source_revision: null, based_on_source_fingerprint: null, updated_at: '2026-09-12T20:00:00Z',
    generation: { kind: 'human', generated_at: '2026-09-12T20:00:00Z' }, version: 3, published_at: '2026-09-12',
  };
  const post = {
    slug: published.slug, title: published.title, date: published.published_at, letter: published.alphabet_key,
    categories: [...published.tags], content: published.content, sourceUrl: 'https://erazahan.info/example-dream/',
    comments: [{ id: 'comment-1', content: 'Preserved comment' }],
  };
  const item = {
    schema_version: 1, content_id: CONTENT_ID, type: 'dream_dictionary', source_locale: 'hy', source_revision: 7,
    source_fingerprint: drift ? 'a'.repeat(64) : sourceFingerprintV1(published), fingerprint_spec_version: 1,
  };
  const hy = { schema_version: 1, content_id: CONTENT_ID, locale: 'hy', draft: null, published };
  const registry = { entries: [{
    content_id: CONTENT_ID,
    legacy: { original_array_index: 0, original_hy_slug: post.slug, original_source_url: post.sourceUrl },
    migration: { version: 1 },
  }] };
  return { post, item, hy, registry };
}

function fakeTransport({ drift = false, failAt = null, content } = {}) {
  const data = fixture({ drift, content });
  const files = new Map([
    [POSTS_PATH, { sha: POSTS_SHA, content: JSON.stringify([data.post]) }],
    [REGISTRY_PATH, { sha: 'registry-sha', content: JSON.stringify(data.registry) }],
    [PATHS.item, { sha: 'item-sha', content: canonicalJson(data.item) }],
    [PATHS.hy, { sha: 'hy-sha', content: canonicalJson(data.hy) }],
  ]);
  const calls = { ref: 0, commitLookup: 0, reads: [], blobs: [], trees: [], commits: [], updates: [], r2Deletes: [] };
  const fail = (stage) => { if (failAt === stage) throw new Error(`${stage} failure`); };
  const client = {
    async getBranchRef() { calls.ref += 1; return { sha: 'commit-sha' }; },
    async getCommit() { calls.commitLookup += 1; return { treeSha: 'tree-sha' }; },
    async readFileFromTree(treeSha, filePath) { calls.reads.push({ treeSha, filePath }); return files.get(filePath) || null; },
    async createBlob(content) { calls.blobs.push(content); fail('blob'); return { sha: `blob-${calls.blobs.length}` }; },
    async createTree(value) { calls.trees.push(value); fail('tree'); return { sha: 'new-tree' }; },
    async createCommit(value) { calls.commits.push(value); fail('commit'); return { sha: 'new-commit' }; },
    async updateBranchRef(value) {
      calls.updates.push(value);
      if (failAt === 'branch') { const error = new Error('branch advanced'); error.status = 422; throw error; }
      fail('ref');
      return { sha: value.sha };
    },
  };
  return { calls, client };
}

function edit(post, changes = {}) {
  return { slug: post.slug, title: post.title, date: post.date, letter: post.letter, categories: [...post.categories], content: post.content, sourceUrl: post.sourceUrl, ...changes };
}

// This mirrors the endpoint's injected atomic branch. Repository and R2 operations stay mocked.
function atomicEnv(branch = 'migration/hy-atomic-drill') {
  return {
    ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic',
    ADMIN_GITHUB_BRANCH: branch,
    ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: branch,
  };
}

function assertNoGitCalls(calls) {
  assert.equal(calls.ref, 0);
  assert.equal(calls.commitLookup, 0);
  assert.equal(calls.reads.length, 0);
  assert.equal(calls.blobs.length, 0);
  assert.equal(calls.trees.length, 0);
  assert.equal(calls.commits.length, 0);
  assert.equal(calls.updates.length, 0);
}

async function mockedEndpoint({ transport, mode, env, changes = {}, expectedVersion = POSTS_SHA, deleteAfterSuccess = false }) {
  try {
    const selectedEnv = env ?? (mode === undefined ? {} : { ERAZAHAN_HY_ADMIN_WRITE_MODE: mode });
    const selected = resolveHyAdminWriteMode(selectedEnv);
    if (selected === 'legacy') return { status: 200, route: 'legacy', noOp: false };
    const branch = resolveAtomicGitHubBranch(selectedEnv);
    const initial = await loadAtomicHyWriteSnapshot((paths) => loadMultiFileSnapshot(transport.client, { branch, paths }));
    if (initial.blobSha !== expectedVersion) return { status: 409, route: 'atomic', noOp: false };
    const current = initial.posts[0];
    const prepared = await prepareAtomicHyWrite({
      snapshot: initial.snapshot,
      postIndex: 0,
      currentPost: current,
      editedPost: edit(current, changes),
      loadSnapshotFiles: (snapshot, paths) => loadSnapshotFiles(transport.client, snapshot, paths),
    });
    const result = await commitMultiFileTransaction(transport.client, {
      snapshot: prepared.snapshot, expectedPostsBlobSha: expectedVersion, changes: prepared.changes,
      message: 'Admin: update dream dictionary article',
    });
    if (deleteAfterSuccess && !result.noOp) transport.calls.r2Deletes.push('posts/example.webp');
    return { status: 200, route: 'atomic', ...result };
  } catch (error) {
    if (error instanceof AdminAtomicHyWriteError) {
      return { status: ['INVALID_WRITE_MODE', 'INVALID_ATOMIC_BRANCH_CONFIRMATION'].includes(error.code) ? 503 : 400, error };
    }
    if (error instanceof HyWriteProjectionError) return { status: 400, error };
    if (error?.code === 'STALE_POSTS_VERSION' || error?.code === 'BRANCH_REF_CONFLICT') return { status: 409, error };
    return { status: 502, error };
  }
}

const endpointSource = readFileSync('functions/api/admin/posts/[id].ts', 'utf8');
for (const required of ['resolveHyAdminWriteMode', 'resolveAtomicGitHubBranch', 'loadAtomicHyWriteSnapshot', 'prepareAtomicHyWrite', 'commitMultiFileTransaction', 'loadSnapshotFiles']) {
  assert.match(endpointSource, new RegExp(required), `endpoint imports and uses ${required}`);
}
assert.equal(endpointSource.includes('process.env'), false, 'endpoint selector comes only from Worker bindings');
assert.ok(
  endpointSource.lastIndexOf('resolveAtomicGitHubBranch(context.env)') < endpointSource.lastIndexOf('getGitHubConfig(context.env)'),
  'atomic branch confirmation precedes GitHub configuration and repository access',
);
assert.ok(
  endpointSource.indexOf('const deletedKeys') > endpointSource.indexOf('commitMultiFileTransaction'),
  'post-commit R2 cleanup remains after the atomic transaction',
);

const defaultLegacy = fakeTransport();
assert.deepEqual(await mockedEndpoint({ transport: defaultLegacy }), { status: 200, route: 'legacy', noOp: false });
assert.equal(defaultLegacy.calls.ref, 0, 'unset selector does not activate Git atomic path');
const explicitLegacy = fakeTransport();
assert.equal((await mockedEndpoint({ transport: explicitLegacy, mode: 'legacy' })).route, 'legacy');
assert.equal(explicitLegacy.calls.ref, 0);

const atomic = fakeTransport();
const atomicResult = await mockedEndpoint({ transport: atomic, env: atomicEnv(), changes: { title: 'Changed title' } });
assert.equal(atomicResult.status, 200);
assert.deepEqual(atomicResult.changedPaths, [POSTS_PATH, PATHS.item, PATHS.hy]);
assert.equal(atomic.calls.ref, 1);
assert.equal(atomic.calls.commitLookup, 1);
assert.equal(atomic.calls.reads.every((call) => call.treeSha === 'tree-sha'), true);
assert.equal(atomic.calls.commits.length, 1);
assert.deepEqual(atomic.calls.updates, [{ branch: 'migration/hy-atomic-drill', sha: 'new-commit', force: false }]);

const slugOnly = fakeTransport();
assert.deepEqual((await mockedEndpoint({ transport: slugOnly, env: atomicEnv(), changes: { slug: 'changed-slug' } })).changedPaths, [POSTS_PATH, PATHS.hy]);
const noOp = fakeTransport();
const noOpResult = await mockedEndpoint({ transport: noOp, env: atomicEnv() });
assert.equal(noOpResult.status, 200);
assert.equal(noOpResult.noOp, true);
assert.equal(noOp.calls.blobs.length + noOp.calls.trees.length + noOp.calls.commits.length + noOp.calls.updates.length, 0);
const crlfNoOp = fakeTransport({ content: 'a\r\nb' });
const crlfNoOpResult = await mockedEndpoint({ transport: crlfNoOp, env: atomicEnv(), changes: { content: 'a\nb' } });
assert.equal(crlfNoOpResult.noOp, true, 'CRLF transport normalization must not create an atomic commit');
assert.equal(crlfNoOp.calls.blobs.length + crlfNoOp.calls.trees.length + crlfNoOp.calls.commits.length + crlfNoOp.calls.updates.length, 0);
const crlfEdit = fakeTransport({ content: 'a\r\nb' });
const crlfEditResult = await mockedEndpoint({ transport: crlfEdit, env: atomicEnv(), changes: { content: 'a\nB' } });
assert.deepEqual(crlfEditResult.changedPaths, [POSTS_PATH, PATHS.item, PATHS.hy]);
assert.ok(crlfEdit.calls.blobs.some((content) => content.includes('a\\r\\nB')), 'CRLF edit persists CRLF bytes');

const invalid = fakeTransport();
assert.equal((await mockedEndpoint({ transport: invalid, mode: 'unexpected' })).status, 503);
assertNoGitCalls(invalid.calls);
for (const env of [
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: '' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: '   ' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: '' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: '   ' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'main', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'migration/hy-atomic-drill' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'typo-branch' },
]) {
  const guarded = fakeTransport();
  assert.equal((await mockedEndpoint({ transport: guarded, env })).status, 503);
  assertNoGitCalls(guarded.calls);
}
assert.equal(resolveAtomicGitHubBranch(atomicEnv('main')), 'main', 'explicit main/main is allowed');
assert.equal(
  resolveAtomicGitHubBranch({ ...atomicEnv(), ADMIN_GITHUB_BRANCH: '  migration/hy-atomic-drill  ', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'migration/hy-atomic-drill ' }),
  'migration/hy-atomic-drill',
  'branch confirmation trims outer whitespace before exact comparison',
);
const sourceChanged = fakeTransport();
assert.equal((await mockedEndpoint({ transport: sourceChanged, env: atomicEnv(), changes: { sourceUrl: 'https://erazahan.info/changed/' } })).status, 400);
assert.equal(sourceChanged.calls.blobs.length, 0);
const stale = fakeTransport();
assert.equal((await mockedEndpoint({ transport: stale, env: atomicEnv(), expectedVersion: 'b'.repeat(40) })).status, 409);
assert.equal(stale.calls.blobs.length, 0);
const drift = fakeTransport({ drift: true });
assert.equal((await mockedEndpoint({ transport: drift, env: atomicEnv(), changes: { title: 'Drift' } })).status, 400);
assert.equal(drift.calls.blobs.length, 0);
const conflict = fakeTransport({ failAt: 'branch' });
assert.equal((await mockedEndpoint({ transport: conflict, env: atomicEnv(), changes: { title: 'Conflict' } })).status, 409);
assert.equal(conflict.calls.commits.length, 1);
assert.equal(conflict.calls.updates.length, 1);
for (const failAt of ['blob', 'tree', 'commit']) {
  const failed = fakeTransport({ failAt });
  assert.equal((await mockedEndpoint({ transport: failed, env: atomicEnv(), changes: { title: `Failed ${failAt}` } })).status, 502);
  assert.equal(failed.calls.updates.length, 0, `${failAt}: no posts-only fallback`);
}
const r2Success = fakeTransport();
assert.equal((await mockedEndpoint({ transport: r2Success, env: atomicEnv(), changes: { title: 'Delete after commit' }, deleteAfterSuccess: true })).status, 200);
assert.deepEqual(r2Success.calls.r2Deletes, ['posts/example.webp']);
const r2Failure = fakeTransport({ failAt: 'branch' });
assert.equal((await mockedEndpoint({ transport: r2Failure, env: atomicEnv(), changes: { title: 'No delete' }, deleteAfterSuccess: true })).status, 409);
assert.deepEqual(r2Failure.calls.r2Deletes, []);

console.log('ADMIN ATOMIC HY WRITE PASS');
console.log(JSON.stringify({
  selector_default_and_legacy: true, atomic_mode: true, explicit_atomic_branch_confirmation: true, invalid_fails_closed: true,
  semantic_posts_item_hy: true, slug_posts_hy_only: true, no_op_without_commit: true,
  source_url_immutable: true, stale_client_conflict: true, store_drift_rejected: true,
  branch_conflict: true, git_failures_no_fallback: true, same_snapshot_tree: true,
  exactly_one_non_force_ref_update: true, r2_cleanup_only_after_success: true, mocked_only: true,
}, null, 2));
