import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
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
    categories: [...published.tags], content: published.content, description: published.description, sourceUrl: 'https://erazahan.info/example-dream/',
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
function atomicEnv(branch = 'migration/hy-atomic-drill', deploymentClass = branch === 'main' ? 'production' : 'preview') {
  return {
    ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic',
    ADMIN_GITHUB_BRANCH: branch,
    ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: branch,
    ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: deploymentClass,
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

function base64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function installAdminPostGetFetch({ posts, registry }) {
  const original = globalThis.fetch;
  const calls = [];
  const tree = (entries) => new Response(JSON.stringify({ tree: entries }), { status: 200 });
  const blob = (content) => new Response(JSON.stringify({ encoding: 'base64', content: base64(content) }), { status: 200 });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, method: init.method ?? 'GET' });
    const path = url.pathname;
    if (path.endsWith('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'commit-sha' } }), { status: 200 });
    if (path.endsWith('/git/commits/commit-sha')) return new Response(JSON.stringify({ tree: { sha: 'root-tree' } }), { status: 200 });
    if (path.endsWith('/git/trees/root-tree')) return tree([{ path: 'src', type: 'tree', sha: 'src-tree' }]);
    if (path.endsWith('/git/trees/src-tree')) return tree([{ path: 'data', type: 'tree', sha: 'data-tree' }]);
    if (path.endsWith('/git/trees/data-tree')) return tree([
      { path: 'posts.json', type: 'blob', sha: 'posts-sha' },
      { path: 'migrations', type: 'tree', sha: 'migrations-tree' },
    ]);
    if (path.endsWith('/git/trees/migrations-tree')) return tree([{ path: 'content-id-registry.v1.json', type: 'blob', sha: 'registry-sha' }]);
    if (path.endsWith('/git/blobs/posts-sha')) return blob(JSON.stringify(posts));
    if (path.endsWith('/git/blobs/registry-sha')) return blob(JSON.stringify(registry));
    return new Response('not found', { status: 404 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function getAdminPost(id, fixture) {
  const mock = installAdminPostGetFetch(fixture);
  try {
    const endpoint = await getAdminPostEndpoint();
    const response = await endpoint.onRequestGet({
      request: new Request(`https://site.test/api/admin/posts/${id}`),
      params: { id },
      env: { GITHUB_TOKEN: 'test-token', ADMIN_GITHUB_REPO: 'test-owner/test-repo', ADMIN_GITHUB_BRANCH: 'main' },
    });
    return { response, body: await response.json(), calls: mock.calls };
  } finally {
    mock.restore();
  }
}

let adminPostEndpointPromise;
async function getAdminPostEndpoint() {
  if (!adminPostEndpointPromise) {
    adminPostEndpointPromise = (async () => {
      const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
      try {
        const endpoint = await server.ssrLoadModule('/functions/api/admin/posts/[id].ts');
        const githubPosts = await server.ssrLoadModule('/functions/_lib/github-posts.ts');
        return { ...endpoint, validateEditablePost: githubPosts.validateEditablePost };
      } finally {
        await server.close();
      }
    })();
  }
  return adminPostEndpointPromise;
}

async function mockedEndpoint({ transport, mode, env, changes = {}, expectedVersion = POSTS_SHA, deleteAfterSuccess = false }) {
  try {
    const selectedEnv = env ?? (mode === undefined ? {} : { ERAZAHAN_HY_ADMIN_WRITE_MODE: mode });
    resolveHyAdminWriteMode(selectedEnv);
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
      return { status: ['INVALID_WRITE_MODE', 'INVALID_ATOMIC_BRANCH_CONFIRMATION', 'INVALID_WRITE_ENVIRONMENT'].includes(error.code) ? 503 : 400, error };
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
assert.equal(endpointSource.includes('commitPosts'), false, 'HY updates cannot use the posts.json-only writer');
assert.equal(endpointSource.includes('loadPostsSnapshot'), false, 'HY updates always load the atomic snapshot');
assert.ok(
  endpointSource.lastIndexOf('resolveAtomicGitHubBranch(context.env)') < endpointSource.lastIndexOf('getGitHubConfig(context.env)'),
  'atomic branch confirmation precedes GitHub configuration and repository access',
);
const { validateEditablePost } = await getAdminPostEndpoint();
const editableBase = { slug: 'description-test', title: 'Description test', date: '2026-09-12', letter: null, categories: ['Test'], content: 'Content', sourceUrl: 'https://erazahan.info/description-test/' };
assert.equal(Object.hasOwn(validateEditablePost(editableBase), 'description'), false, 'omitted description remains omitted');
assert.equal(validateEditablePost({ ...editableBase, description: '' }).description, null, 'blank description explicitly clears');
assert.equal(validateEditablePost({ ...editableBase, description: null }).description, null, 'null description explicitly clears');
assert.equal(validateEditablePost({ ...editableBase, description: 'Exact description' }).description, 'Exact description', 'non-empty description is preserved');

const getPosts = [
  { slug: 'first', title: 'First', date: '2026-09-01', letter: null, categories: [], content: '', sourceUrl: 'https://erazahan.info/first/' },
  { slug: 'second', title: 'Second', date: '2026-09-02', letter: null, categories: [], content: '', sourceUrl: 'https://erazahan.info/second/' },
];
const getRegistry = { entries: [
  { content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', legacy: { original_array_index: 0, original_hy_slug: 'first', original_source_url: getPosts[0].sourceUrl } },
  { content_id: 'cadd4552-097e-5845-b59e-223c36c82488', legacy: { original_array_index: 1, original_hy_slug: 'second', original_source_url: getPosts[1].sourceUrl } },
] };
const getFirst = await getAdminPost('0', { posts: getPosts, registry: getRegistry });
assert.equal(getFirst.response.status, 200);
assert.equal(getFirst.body.ok, true);
assert.deepEqual(getFirst.body.post, getPosts[0]);
assert.equal(getFirst.body.version, 'posts-sha');
assert.equal(getFirst.body.writable, true);
assert.equal(getFirst.body.content_id, getRegistry.entries[0].content_id);
assert.equal(getFirst.calls.every((call) => call.method === 'GET'), true);
const getSecond = await getAdminPost('1', { posts: getPosts, registry: getRegistry });
assert.equal(getSecond.response.status, 200);
assert.equal(getSecond.body.content_id, getRegistry.entries[1].content_id);
assert.notEqual(getSecond.body.content_id, getFirst.body.content_id);
const getWithDescription = await getAdminPost('0', { posts: [{ ...getPosts[0], description: 'Exact description' }, getPosts[1]], registry: getRegistry });
assert.equal(getWithDescription.body.post.description, 'Exact description', 'GET preserves a non-empty description exactly');
const getWithClearedDescription = await getAdminPost('0', { posts: [{ ...getPosts[0], description: null }, getPosts[1]], registry: getRegistry });
assert.equal(getWithClearedDescription.body.post.description, null, 'GET reloads an explicit cleared description as blank');
async function assertRealPutFailsClosed(env, label) {
  const mock = installAdminPostGetFetch({ posts: getPosts, registry: getRegistry }); let r2Mutations = 0; try {
  const endpoint = await getAdminPostEndpoint();
  const response = await endpoint.onRequestPut({
    request: new Request('https://site.test/api/admin/posts/0', {
      method: 'PUT', headers: { origin: 'https://site.test', 'content-type': 'application/json' },
      body: JSON.stringify({ version: POSTS_SHA, originalSlug: getPosts[0].slug, post: getPosts[0] }),
    }),
    params: { id: '0' },
    env: {
      GITHUB_TOKEN: 'test-token', ADMIN_GITHUB_REPO: 'test-owner/test-repo', ADMIN_GITHUB_BRANCH: 'main',
      INTERNAL_ERROR_BODY: 'internal-response-body',
      POST_IMAGES: { delete: async () => { r2Mutations += 1; } },
      ...env,
    },
  });
  assert.equal(response.status, 503, label); const body = await response.json(); assert.equal(body.ok, false, label); assert.equal(body.writable, false, label);
  const serialized = JSON.stringify(body);
  for (const secret of ['test-token', 'test-owner/test-repo', 'internal-response-body']) assert.equal(serialized.includes(secret), false, `${label}: error is redacted`);
  assert.equal(Object.hasOwn(body, 'stack'), false, `${label}: error has no stack trace`);
  assert.equal(mock.calls.length, 0, `${label}: real HY endpoint rejects before GitHub access`); assert.equal(r2Mutations, 0, `${label}: real HY endpoint rejects before R2 mutation`);
} finally { mock.restore(); }
}
await assertRealPutFailsClosed({}, 'missing write mode');
await assertRealPutFailsClosed({ ERAZAHAN_HY_ADMIN_WRITE_MODE: 'legacy' }, 'legacy write mode');
await assertRealPutFailsClosed({ ERAZAHAN_HY_ADMIN_WRITE_MODE: 'unexpected' }, 'unknown write mode');
await assertRealPutFailsClosed({
  ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'main', ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: 'preview',
}, 'preview deployment targeting main');
const invalidGet = await getAdminPost('invalid', { posts: getPosts, registry: getRegistry });
assert.equal(invalidGet.response.status, 400);
assert.equal(invalidGet.body.ok, false);
assert.equal(invalidGet.calls.length, 0);
const missingGet = await getAdminPost('2', { posts: getPosts, registry: getRegistry });
assert.equal(missingGet.response.status, 404);
assert.equal(missingGet.body.ok, false);
assert.equal(missingGet.body.error, 'Статья не найдена.');
const registryBefore = JSON.stringify(getRegistry);
const unresolvedGet = await getAdminPost('1', { posts: getPosts, registry: { entries: [getRegistry.entries[0]] } });
assert.equal(unresolvedGet.response.status, 503);
assert.equal(unresolvedGet.body.ok, false);
assert.equal(Object.hasOwn(unresolvedGet.body, 'content_id'), false);
const ambiguousGet = await getAdminPost('1', { posts: getPosts, registry: { entries: [getRegistry.entries[1], { ...getRegistry.entries[1], content_id: getRegistry.entries[0].content_id }] } });
assert.equal(ambiguousGet.response.status, 503);
assert.equal(ambiguousGet.body.ok, false);
assert.equal(Object.hasOwn(ambiguousGet.body, 'content_id'), false);
const invalidRegistryIdGet = await getAdminPost('1', { posts: getPosts, registry: { entries: [{ ...getRegistry.entries[1], content_id: 'not-a-generated-id' }] } });
assert.equal(invalidRegistryIdGet.response.status, 503);
assert.equal(Object.hasOwn(invalidRegistryIdGet.body, 'content_id'), false);
assert.equal(JSON.stringify(getRegistry), registryBefore);
assert.ok(
  endpointSource.indexOf('const deletedKeys') > endpointSource.indexOf('commitMultiFileTransaction'),
  'post-commit R2 cleanup remains after the atomic transaction',
);

for (const [label, mode] of [['missing', undefined], ['legacy', 'legacy'], ['unknown', 'unexpected']]) {
  const rejected = fakeTransport();
  const result = await mockedEndpoint({ transport: rejected, mode });
  assert.equal(result.status, 503, `${label} mode fails closed`);
  assert.equal(result.error?.code, 'INVALID_WRITE_MODE', `${label} mode reports configuration failure`);
  assertNoGitCalls(rejected.calls);
  assert.deepEqual(rejected.calls.r2Deletes, [], `${label} mode does not mutate R2`);
}

const atomic = fakeTransport();
const atomicResult = await mockedEndpoint({ transport: atomic, env: atomicEnv(), changes: { title: 'Changed title' } });
assert.equal(atomicResult.status, 200);
assert.deepEqual(atomicResult.changedPaths, [POSTS_PATH, PATHS.item, PATHS.hy]);
assert.equal(atomic.calls.ref, 1);
assert.equal(atomic.calls.commitLookup, 1);
assert.equal(atomic.calls.reads.every((call) => call.treeSha === 'tree-sha'), true);
assert.equal(atomic.calls.commits.length, 1);
assert.deepEqual(atomic.calls.updates, [{ branch: 'migration/hy-atomic-drill', sha: 'new-commit', force: false }]);

const legacySlugChanged = fakeTransport();
const legacySlugChangedResult = await mockedEndpoint({ transport: legacySlugChanged, env: atomicEnv(), changes: { slug: 'changed-slug' } });
assert.equal(legacySlugChangedResult.status, 400, 'legacy slug change is rejected');
assert.equal(legacySlugChangedResult.error?.code, 'SLUG_IMMUTABLE');
assert.equal(legacySlugChanged.calls.blobs.length + legacySlugChanged.calls.trees.length + legacySlugChanged.calls.commits.length + legacySlugChanged.calls.updates.length, 0, 'rejected legacy slug change has no GitHub write');
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

for (const env of [
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: '' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: '   ' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: '' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: '   ' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'main', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'migration/hy-atomic-drill' },
  { ERAZAHAN_HY_ADMIN_WRITE_MODE: 'atomic', ADMIN_GITHUB_BRANCH: 'migration/hy-atomic-drill', ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH: 'typo-branch' },
  { ...atomicEnv('migration/hy-atomic-drill', 'production') },
  { ...atomicEnv('main', 'preview') },
  (() => { const env = atomicEnv('main'); delete env.ERAZAHAN_ADMIN_DEPLOYMENT_CLASS; return env; })(),
  { ...atomicEnv('main', 'unknown') },
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
  atomic_mode_only: true, missing_unknown_and_legacy_fail_closed: true, explicit_atomic_branch_confirmation: true, invalid_fails_closed: true,
  semantic_posts_item_hy: true, existing_slug_immutable: true, description_contract: true, no_op_without_commit: true,
  source_url_immutable: true, stale_client_conflict: true, store_drift_rejected: true,
  branch_conflict: true, git_failures_no_fallback: true, same_snapshot_tree: true,
  exactly_one_non_force_ref_update: true, r2_cleanup_only_after_success: true, real_endpoint_rejections: true,
}, null, 2));
