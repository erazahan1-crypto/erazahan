const POSTS_PATH = 'src/data/posts.json';

export class GitHubTransactionError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GitHubTransactionError';
    this.code = code;
  }
}

export class GitHubBranchConflictError extends GitHubTransactionError {
  constructor(cause = undefined) {
    super('BRANCH_REF_CONFLICT', 'Ветка изменилась во время сохранения. Перезагрузите статью.', cause);
    this.name = 'GitHubBranchConflictError';
  }
}

function fail(code, message, cause = undefined) {
  throw new GitHubTransactionError(code, message, cause);
}

export function assertRepositoryPath(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\\') || filePath.includes('\0')) {
    fail('INVALID_REPOSITORY_PATH', 'Repository path is invalid');
  }
  const segments = filePath.split('/');
  if (filePath.startsWith('/') || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('INVALID_REPOSITORY_PATH', 'Repository path must be a normalized relative path');
  }
  return filePath;
}

function assertUniquePaths(paths) {
  const unique = new Set();
  for (const filePath of paths) {
    assertRepositoryPath(filePath);
    if (unique.has(filePath)) fail('DUPLICATE_REPOSITORY_PATH', `Repository path is duplicated: ${filePath}`);
    unique.add(filePath);
  }
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !(snapshot.files instanceof Map)) {
    fail('INVALID_SNAPSHOT', 'Repository snapshot is invalid');
  }
  for (const field of ['branch', 'refSha', 'commitSha', 'treeSha']) {
    if (typeof snapshot[field] !== 'string' || !snapshot[field]) {
      fail('INVALID_SNAPSHOT', `Repository snapshot ${field} is invalid`);
    }
  }
}

function assertSnapshotFile(snapshot, filePath) {
  const file = snapshot.files.get(filePath);
  if (!file || typeof file.sha !== 'string' || !file.sha || typeof file.content !== 'string') {
    fail('SNAPSHOT_FILE_MISSING', `Snapshot does not contain ${filePath}`);
  }
  return file;
}

function isBranchConflict(error) {
  return error && typeof error === 'object' && (error.status === 409 || error.status === 422);
}

async function atStage(code, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GitHubTransactionError) throw error;
    fail(code, `GitHub ${code.toLowerCase().replaceAll('_', ' ')} failed`, error);
  }
}

export async function loadMultiFileSnapshot(client, { branch, paths }) {
  if (!client || typeof client !== 'object') fail('INVALID_TRANSPORT', 'GitHub transport is required');
  if (typeof branch !== 'string' || !branch) fail('INVALID_BRANCH', 'Branch is required');
  if (!Array.isArray(paths) || paths.length === 0) fail('INVALID_SNAPSHOT_PATHS', 'At least one repository path is required');
  assertUniquePaths(paths);

  const ref = await atStage('REF_LOOKUP_FAILURE', () => client.getBranchRef(branch));
  if (!ref || typeof ref.sha !== 'string' || !ref.sha) fail('INVALID_SNAPSHOT', 'Branch ref is invalid');
  const commit = await atStage('COMMIT_LOOKUP_FAILURE', () => client.getCommit(ref.sha));
  if (!commit || typeof commit.treeSha !== 'string' || !commit.treeSha) fail('INVALID_SNAPSHOT', 'Commit tree is invalid');

  const files = new Map();
  for (const filePath of paths) {
    const file = await atStage('SNAPSHOT_FILE_FAILURE', () => client.readFileFromTree(commit.treeSha, filePath));
    if (!file || typeof file.sha !== 'string' || !file.sha || typeof file.content !== 'string') {
      fail('SNAPSHOT_FILE_MISSING', `GitHub snapshot does not contain ${filePath}`);
    }
    files.set(filePath, { sha: file.sha, content: file.content });
  }
  return { branch, refSha: ref.sha, commitSha: ref.sha, treeSha: commit.treeSha, files };
}

export async function commitMultiFileTransaction(client, {
  snapshot,
  expectedPostsBlobSha,
  changes,
  message,
}) {
  if (!client || typeof client !== 'object') fail('INVALID_TRANSPORT', 'GitHub transport is required');
  assertSnapshot(snapshot);
  if (typeof expectedPostsBlobSha !== 'string' || !expectedPostsBlobSha) {
    fail('INVALID_EXPECTED_POSTS_VERSION', 'Expected posts.json blob SHA is required');
  }
  if (typeof message !== 'string' || !message.trim()) fail('INVALID_COMMIT_MESSAGE', 'Commit message is required');
  if (!Array.isArray(changes)) fail('INVALID_CHANGES', 'Changes must be an array');
  assertUniquePaths(changes.map((change) => change?.path));

  const currentPosts = assertSnapshotFile(snapshot, POSTS_PATH);
  if (currentPosts.sha !== expectedPostsBlobSha) {
    fail('STALE_POSTS_VERSION', 'Статья или набор постов уже изменились. Перезагрузите статью.');
  }

  const changed = [];
  for (const change of changes) {
    if (!change || typeof change.content !== 'string') {
      fail('INVALID_CHANGE_CONTENT', `Repository change content must be a string: ${change?.path ?? 'unknown'}`);
    }
    const current = assertSnapshotFile(snapshot, change.path);
    if (current.content !== change.content) changed.push(change);
  }
  if (changed.length === 0) {
    return { noOp: true, commitSha: null, changedPaths: [], blobShas: new Map() };
  }

  const blobShas = new Map();
  for (const change of changed) {
    const blob = await atStage('BLOB_CREATION_FAILURE', () => client.createBlob(change.content));
    if (!blob || typeof blob.sha !== 'string' || !blob.sha) fail('BLOB_CREATION_FAILURE', 'GitHub blob response is invalid');
    blobShas.set(change.path, blob.sha);
  }
  const entries = changed.map((change) => ({
    path: change.path,
    mode: '100644',
    type: 'blob',
    sha: blobShas.get(change.path),
  }));
  const tree = await atStage('TREE_CREATION_FAILURE', () => client.createTree({
    baseTreeSha: snapshot.treeSha,
    entries,
  }));
  if (!tree || typeof tree.sha !== 'string' || !tree.sha) fail('TREE_CREATION_FAILURE', 'GitHub tree response is invalid');
  const commit = await atStage('COMMIT_CREATION_FAILURE', () => client.createCommit({
    message,
    treeSha: tree.sha,
    parentCommitSha: snapshot.commitSha,
  }));
  if (!commit || typeof commit.sha !== 'string' || !commit.sha) fail('COMMIT_CREATION_FAILURE', 'GitHub commit response is invalid');

  try {
    await client.updateBranchRef({ branch: snapshot.branch, sha: commit.sha, force: false });
  } catch (error) {
    if (isBranchConflict(error)) throw new GitHubBranchConflictError(error);
    fail('BRANCH_REF_UPDATE_FAILURE', 'GitHub branch ref update failed', error);
  }
  return {
    noOp: false,
    commitSha: commit.sha,
    changedPaths: changed.map((change) => change.path),
    blobShas,
  };
}
