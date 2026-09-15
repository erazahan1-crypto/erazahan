import assert from 'node:assert/strict';
import { createGitHubTransactionClient, loadMultiFileSnapshot } from '../../functions/_lib/github-posts.ts';

const POSTS = 'src/data/posts.json';
const MISSING = 'src/data/content/dreams/aa/missing/ru.json';
const config = { token: 'test-token', owner: 'test-owner', repo: 'test-repo', branch: 'main' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFetch({ failDataTree = false } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit-sha' } });
    if (path.endsWith('/git/commits/commit-sha')) return json({ tree: { sha: 'root-tree' } });
    if (path.endsWith('/git/trees/root-tree')) return json({ tree: [{ path: 'src', type: 'tree', sha: 'src-tree' }] });
    if (path.endsWith('/git/trees/src-tree')) return json({ tree: [{ path: 'data', type: 'tree', sha: 'data-tree' }] });
    if (path.endsWith('/git/trees/data-tree')) {
      if (failDataTree) return new Response('transport failure', { status: 500 });
      return json({ tree: [{ path: 'posts.json', type: 'blob', sha: 'posts-sha' }] });
    }
    if (path.endsWith('/git/blobs/posts-sha')) return json({ sha: 'posts-sha', encoding: 'base64', content: 'W10=' });
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  return () => { globalThis.fetch = originalFetch; };
}

let restore = installFetch();
try {
  const client = createGitHubTransactionClient(config);
  for (const method of ['getBranchRef', 'getCommit', 'readFileFromTree', 'createBlob', 'createTree', 'createCommit', 'updateBranchRef']) {
    assert.equal(typeof client[method], 'function', `${method} is available to C2/D1`);
  }
  assert.deepEqual(await client.getBranchRef('main'), { sha: 'commit-sha' });
  assert.deepEqual(await client.getCommit('commit-sha'), { treeSha: 'root-tree' });
  assert.deepEqual(await client.readFileFromTree('root-tree', POSTS), { sha: 'posts-sha', content: '[]' });
  assert.equal(await client.readFileFromTree('root-tree', MISSING), null);
  const snapshot = await loadMultiFileSnapshot(config, [POSTS, MISSING]);
  assert.deepEqual(snapshot.files.get(POSTS), { sha: 'posts-sha', content: '[]' });
  assert.equal(snapshot.files.has(MISSING), true);
  assert.equal(snapshot.files.get(MISSING), null);
} finally {
  restore();
}

restore = installFetch({ failDataTree: true });
try {
  await assert.rejects(
    () => loadMultiFileSnapshot(config, [POSTS]),
    (error) => error?.code === 'SNAPSHOT_FILE_FAILURE',
  );
} finally {
  restore();
}

console.log('GITHUB POSTS SNAPSHOT PASS');
console.log(JSON.stringify({ existing_file_loaded: true, missing_file_is_null: true, transport_failure_throws: true, transaction_client_factory: true }, null, 2));
