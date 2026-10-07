import assert from 'node:assert/strict';
import { createGitHubTransactionClient } from '../../functions/_lib/github-posts.ts';
import { loadMultiFileSnapshot, loadSnapshotFiles } from '../../functions/_lib/github-multifile.mjs';

const config = { token: 'mock-secret', owner: 'mock', repo: 'mock', branch: 'main' };
const original = globalThis.fetch;
const calls = [];
let failure = null;
globalThis.fetch = async (url, init = {}) => {
  assert.equal(init.method ?? 'GET', 'GET');
  const path = new URL(url).pathname;
  calls.push(path);
  if (path.includes('/git/ref/')) return Response.json({ object: { sha: `head-${calls.length}` } });
  if (path.includes('/git/commits/')) return Response.json({ tree: { sha: 'root' } });
  if (path.includes('/git/trees/')) {
    if (failure === 'reject') throw new Error('mock-secret');
    if (failure === '404') return new Response('mock-secret', { status: 404 });
    if (failure === 'json') return new Response('{');
    if (failure === 'shape') return Response.json({ tree: [{ path: 'file', type: 'blob', sha: null }] });
    if (failure === 'truncated') return Response.json({ tree: [], truncated: true });
    return Response.json({ tree: [{ path: 'file', type: 'blob', sha: 'blob' }] });
  }
  if (path.endsWith('/git/blobs/blob')) return Response.json({ encoding: 'base64', content: Buffer.from('exact bytes\n').toString('base64') });
  throw new Error('Unexpected request');
};
const count = (sha) => calls.filter((p) => p.endsWith(`/git/trees/${sha}`)).length;
try {
  const a = createGitHubTransactionClient(config);
  const values = await Promise.all([a.readFileFromTree('root', 'file'), a.readFileFromTree('root', 'file')]);
  assert.equal(count('root'), 1, 'concurrent reads reuse the same immutable tree');
  assert.deepEqual(values, [{ sha: 'blob', content: 'exact bytes\n' }, { sha: 'blob', content: 'exact bytes\n' }]);
  assert.equal(await a.readFileFromTree('root', 'absent'), null);
  assert.equal(count('root'), 1);
  await a.readFileFromTree('other-root', 'file');
  assert.equal(count('other-root'), 1, 'different immutable SHAs are distinct');
  const b = createGitHubTransactionClient(config);
  await b.readFileFromTree('root', 'file');
  assert.equal(count('root'), 2, 'cache cannot cross clients');
  const refs = await Promise.all([a.getBranchRef('main'), a.getBranchRef('main'), b.getBranchRef('main')]);
  assert.equal(new Set(refs.map((r) => r.sha)).size, 3, 'even the same client never caches branch refs');
  const pinned = await loadMultiFileSnapshot(a, { branch: 'main', paths: ['file'] });
  const start = calls.length;
  await loadSnapshotFiles(a, pinned, ['absent']);
  assert.equal(calls.length, start, 'additional reads use the pinned tree without ref or commit re-resolution');
  for (const kind of ['reject', '404', 'json', 'shape', 'truncated']) {
    const client = createGitHubTransactionClient(config);
    const before = count('root');
    failure = kind;
    await assert.rejects(() => loadMultiFileSnapshot(client, { branch: 'main', paths: ['file'] }), (e) => e.code === 'SNAPSHOT_FILE_FAILURE');
    failure = null;
    assert.deepEqual(await client.readFileFromTree('root', 'file'), values[0]);
    assert.equal(count('root'), before + 2, `${kind} failure is not cached as success or absence`);
  }
} finally { globalThis.fetch = original; }
console.log('GITHUB TREE CACHE PASS');
