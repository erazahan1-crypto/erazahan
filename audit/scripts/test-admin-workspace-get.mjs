import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestGet } from '../../functions/api/admin/workspace/[contentId].ts';
import { createGitHubTransactionClient } from '../../functions/_lib/github-posts.ts';
import { loadWorkspaceSnapshot, workspaceStateFromSnapshot } from '../../functions/_lib/admin-workspace-save.mjs';
import { hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import { readWorkspaceResponse, WorkspaceLoadError } from '../../src/lib/admin-workspace-response.mjs';

const id = 'f0438140-c7fb-5fc1-ba23-6daf02f8588f';
const base = hyStorePaths(id);
const paths = ['src/data/posts.json', 'src/data/migrations/content-id-registry.v1.json', base.item, base.hy, 'src/data/content/locale-draft-slug-claims.v1.json', 'src/data/content/locale-slug-reservations.v1.json'];
const env = { GITHUB_TOKEN: 'mock-secret', ADMIN_GITHUB_REPO: 'mock/repo' };
const originalFetch = globalThis.fetch, originalError = console.error;
const logs = [];
console.error = (...args) => logs.push(args.join(' '));

function fixture(locales = []) {
  const files = new Map(paths.map((p) => [p, readFileSync(p, 'utf8')]));
  const item = JSON.parse(files.get(base.item)), hy = JSON.parse(files.get(base.hy));
  for (const locale of locales) files.set(`${base.directory}/${locale}.json`, JSON.stringify({
    schema_version: 1, content_id: id, locale, draft: null,
    published: { ...hy.published, slug: locale === 'ru' ? '\u0442\u0435\u0441\u0442' : 'test', title: 'Mock', alphabet_key: null, based_on_source_revision: item.source_revision, based_on_source_fingerprint: item.source_fingerprint },
  }));
  return files;
}

function install(files, { rejectStage = null, limit = 50 } = {}) {
  const trees = new Map([['root', []]]), blobs = new Map(), calls = [];
  for (const [path, content] of files) {
    const segments = path.split('/'); let parent = 'root';
    for (let i = 0; i < segments.length; i++) {
      const leaf = i === segments.length - 1, sha = segments.slice(0, i + 1).join('/');
      if (!trees.get(parent).some((e) => e.path === segments[i])) trees.get(parent).push({ path: segments[i], type: leaf ? 'blob' : 'tree', sha });
      if (leaf) blobs.set(sha, content); else if (!trees.has(sha)) trees.set(sha, []);
      parent = sha;
    }
  }
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.method ?? 'GET', 'GET', 'workspace load must never execute a mutation');
    const path = decodeURIComponent(new URL(url).pathname.replace('/repos/mock/repo', ''));
    calls.push(path);
    if (calls.length > limit) throw new Error('mock request limit');
    if (rejectStage && path.startsWith(rejectStage)) throw new Error('mock-secret upstream body');
    if (path.startsWith('/git/ref/')) return Response.json({ object: { sha: 'commit' } });
    if (path.startsWith('/git/commits/')) return Response.json({ tree: { sha: 'root' } });
    if (path.startsWith('/git/trees/')) return Response.json({ tree: trees.get(path.slice(11)) });
    if (path.startsWith('/git/blobs/')) return Response.json({ encoding: 'base64', content: Buffer.from(blobs.get(path.slice(11))).toString('base64') });
    throw new Error('Unexpected mock request');
  };
  return calls;
}
async function get(contentId = id, environment = env) {
  const response = await onRequestGet({ params: { contentId }, env: environment });
  return { status: response.status, body: await response.json() };
}
try {
  for (const [index, locales] of [[], ['ru'], ['ru', 'en']].entries()) {
    const files = fixture(locales), calls = install(files);
    const actual = await get();
    assert.equal(actual.status, 200);
    for (const locale of ['ru', 'en']) assert.equal(actual.body[locale].translation_state.publication_state, locales.includes(locale) ? 'PUBLISHED' : 'NOT_CREATED');
    const after = calls.length;
    assert.equal(after, 16 + index);
    assert.ok(after < 25, 'comfortable subrequest headroom');
    // Deliberately discard the transport per file to reproduce the uncached contract.
    const beforeCalls = install(files, { limit: Infinity });
    const config = { token: 'mock-secret', owner: 'mock', repo: 'repo', branch: 'main' };
    const uncached = { ...createGitHubTransactionClient(config), readFileFromTree: (tree, path) => createGitHubTransactionClient(config).readFileFromTree(tree, path) };
    const expected = workspaceStateFromSnapshot(await loadWorkspaceSnapshot(uncached, { branch: 'main', contentId: id }));
    assert.deepEqual(actual.body, { ok: true, ...expected }, 'cached and uncached responses are semantically identical');
    assert.equal(beforeCalls.length, 51 + index);
    console.log(`Scenario ${'ABC'[index]}: ${beforeCalls.length} -> ${after} GitHub requests`);
  }
  for (const corrupt of [
    (f) => { const item = JSON.parse(f.get(base.item)); item.content_id = '00000000-0000-5000-8000-000000000000'; f.set(base.item, JSON.stringify(item)); },
    (f) => f.delete(base.item),
    (f) => f.set(paths[1], '{'),
    (f) => f.set(paths[1], JSON.stringify({ entries: [] })),
  ]) {
    const files = fixture(); corrupt(files); install(files);
    const result = await get(); assert.equal(result.status, 503); assert.equal(result.body.code, 'REPOSITORY_INTEGRITY');
  }
  for (const stage of ['/git/ref/', '/git/commits/', '/git/trees/', '/git/blobs/']) {
    install(fixture(), { rejectStage: stage });
    const result = await get(); assert.equal(result.status, 502); assert.equal(result.body.code, 'UPSTREAM_FAILURE');
    assert.doesNotMatch(JSON.stringify(result), /mock-secret/);
  }
  let calls = install(fixture());
  assert.deepEqual(await get('invalid'), { status: 400, body: { ok: false, code: 'INVALID_REQUEST' } });
  assert.equal(calls.length, 0);
  const missing = await get('00000000-0000-5000-8000-000000000000');
  assert.equal(missing.status, 404); assert.equal(missing.body.code, 'CONTENT_NOT_FOUND');
  const configError = await get(id, {}); assert.equal(configError.status, 503); assert.equal(configError.body.code, 'SERVICE_UNAVAILABLE');
  const originalClone = globalThis.structuredClone;
  install(fixture());
  try { globalThis.structuredClone = () => { throw new Error('mock-secret'); }; const internal = await get(); assert.equal(internal.status, 500); assert.equal(internal.body.code, 'INTERNAL_ERROR'); }
  finally { globalThis.structuredClone = originalClone; }
  assert.doesNotMatch(logs.join('\n'), /mock-secret|Authorization|f0438140|src\/data/);
  assert.ok(logs.some((line) => line.includes('SNAPSHOT_FILE_FAILURE')));
  for (const response of [Response.json({ code: 'UPSTREAM_FAILURE', message: 'mock-secret' }, { status: 502 }), new Response('<html>mock-secret</html>', { status: 502 }), Response.json({ code: 'mock-secret' }, { status: 500 })]) {
    await assert.rejects(() => readWorkspaceResponse(response), (e) => e instanceof WorkspaceLoadError && !e.message.includes('mock-secret') && e.message.includes('HTTP'));
  }
  await assert.rejects(() => readWorkspaceResponse(Response.json({ code: 'REPOSITORY_INTEGRITY' }, { status: 503 })), /Workspace data is inconsistent.*Code: REPOSITORY_INTEGRITY/);
} finally { globalThis.fetch = originalFetch; console.error = originalError; }
console.log('ADMIN WORKSPACE GET PASS');
