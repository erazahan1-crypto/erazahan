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

function snapshotFileState(snapshot, filePath) {
  if (!snapshot.files.has(filePath)) {
    fail('SNAPSHOT_FILE_UNREPRESENTED', `Snapshot does not represent ${filePath}`);
  }
  const file = snapshot.files.get(filePath);
  if (file === null) return null;
  if (!file || typeof file.sha !== 'string' || !file.sha || typeof file.content !== 'string') {
    fail('INVALID_SNAPSHOT', `Snapshot file state is invalid: ${filePath}`);
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
    if (file === null) {
      files.set(filePath, null);
      continue;
    }
    if (!file || typeof file.sha !== 'string' || !file.sha || typeof file.content !== 'string') {
      fail('INVALID_SNAPSHOT', `GitHub snapshot file is invalid: ${filePath}`);
    }
    files.set(filePath, { sha: file.sha, content: file.content });
  }
  return { branch, refSha: ref.sha, commitSha: ref.sha, treeSha: commit.treeSha, files };
}

// Reads further files from the immutable tree already captured by a snapshot.
// Deliberately does not look up the branch ref or commit again.
export async function loadSnapshotFiles(client, snapshot, paths) {
  if (!client || typeof client !== 'object') fail('INVALID_TRANSPORT', 'GitHub transport is required');
  assertSnapshot(snapshot);
  if (!Array.isArray(paths) || paths.length === 0) fail('INVALID_SNAPSHOT_PATHS', 'At least one repository path is required');
  assertUniquePaths(paths);

  const files = new Map(snapshot.files);
  for (const filePath of paths) {
    const file = await atStage('SNAPSHOT_FILE_FAILURE', () => client.readFileFromTree(snapshot.treeSha, filePath));
    if (file === null) {
      files.set(filePath, null);
      continue;
    }
    if (!file || typeof file.sha !== 'string' || !file.sha || typeof file.content !== 'string') {
      fail('INVALID_SNAPSHOT', `GitHub snapshot file is invalid: ${filePath}`);
    }
    files.set(filePath, { sha: file.sha, content: file.content });
  }
  return { ...snapshot, files };
}

export async function commitMultiFileTransaction(client, {
  snapshot,
  expectedPostsBlobSha,
  expectedFileShas,
  changes,
  message,
}) {
  if (!client || typeof client !== 'object') fail('INVALID_TRANSPORT', 'GitHub transport is required');
  assertSnapshot(snapshot);
  if (typeof message !== 'string' || !message.trim()) fail('INVALID_COMMIT_MESSAGE', 'Commit message is required');
  if (!Array.isArray(changes)) fail('INVALID_CHANGES', 'Changes must be an array');

  const normalizedChanges = changes.map((change) => normalizeChange(change));
  assertUniquePaths(normalizedChanges.map((change) => change.path));
  assertExpectedFileShas(snapshot, expectedFileShas, expectedPostsBlobSha);

  const changed = [];
  for (const change of normalizedChanges) {
    const current = snapshotFileState(snapshot, change.path);
    if (change.operation === 'update') {
      if (current === null) fail('UPDATE_TARGET_MISSING', `Update target is missing: ${change.path}`);
      if (current.content !== change.content) changed.push(change);
    } else if (change.operation === 'create') {
      if (current !== null) fail('CREATE_TARGET_EXISTS', `Create target already exists: ${change.path}`);
      changed.push(change);
    } else {
      if (current === null) fail('DELETE_TARGET_MISSING', `Delete target is missing: ${change.path}`);
      changed.push(change);
    }
  }
  if (changed.length === 0) {
    return { noOp: true, commitSha: null, changedPaths: [], blobShas: new Map() };
  }

  const blobShas = new Map();
  for (const change of changed) {
    if (change.operation === 'delete') continue;
    const blob = await atStage('BLOB_CREATION_FAILURE', () => client.createBlob(change.content));
    if (!blob || typeof blob.sha !== 'string' || !blob.sha) fail('BLOB_CREATION_FAILURE', 'GitHub blob response is invalid');
    blobShas.set(change.path, blob.sha);
  }
  const entries = changed.map((change) => change.operation === 'delete'
    ? { path: change.path, mode: '100644', type: 'blob', sha: null }
    : { path: change.path, mode: '100644', type: 'blob', sha: blobShas.get(change.path) });
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

function normalizeChange(change) {
  if (!change || typeof change !== 'object') fail('INVALID_CHANGE_OPERATION', 'Repository change must be an object');
  const operation = Object.hasOwn(change, 'operation') ? change.operation : 'update';
  if (!['update', 'create', 'delete'].includes(operation)) {
    fail('INVALID_CHANGE_OPERATION', `Repository change operation is invalid: ${change.path ?? 'unknown'}`);
  }
  if (operation === 'delete') {
    if (Object.hasOwn(change, 'content')) {
      fail('INVALID_CHANGE_CONTENT', `Delete change must not include content: ${change.path ?? 'unknown'}`);
    }
    return { operation, path: change.path };
  }
  if (typeof change.content !== 'string') {
    fail('INVALID_CHANGE_CONTENT', `Repository change content must be a string: ${change.path ?? 'unknown'}`);
  }
  return { operation, path: change.path, content: change.content };
}

function assertExpectedFileShas(snapshot, expectedFileShas, expectedPostsBlobSha) {
  if (expectedFileShas !== undefined && (!expectedFileShas || typeof expectedFileShas !== 'object' || Array.isArray(expectedFileShas))) {
    fail('INVALID_EXPECTED_FILE_SHAS', 'Expected file SHAs must be an object');
  }
  if (expectedPostsBlobSha !== undefined && (typeof expectedPostsBlobSha !== 'string' || !expectedPostsBlobSha)) {
    fail('INVALID_EXPECTED_POSTS_VERSION', 'Expected posts.json blob SHA is invalid');
  }
  const expected = new Map();
  for (const [filePath, sha] of Object.entries(expectedFileShas ?? {})) {
    assertRepositoryPath(filePath);
    if (typeof sha !== 'string' || !sha) fail('INVALID_EXPECTED_FILE_SHAS', `Expected file SHA is invalid: ${filePath}`);
    expected.set(filePath, { sha, staleCode: 'STALE_FILE_VERSION' });
  }
  if (expectedPostsBlobSha !== undefined) {
    const current = expected.get(POSTS_PATH);
    if (current && current.sha !== expectedPostsBlobSha) {
      fail('EXPECTED_FILE_SHA_CONFLICT', 'Expected posts.json SHA conflicts with expectedFileShas');
    }
    expected.set(POSTS_PATH, { sha: expectedPostsBlobSha, staleCode: 'STALE_POSTS_VERSION' });
  }
  for (const [filePath, expectation] of expected) {
    const file = snapshotFileState(snapshot, filePath);
    if (file === null || file.sha !== expectation.sha) {
      if (expectation.staleCode === 'STALE_POSTS_VERSION') {
        fail('STALE_POSTS_VERSION', 'Статья или набор постов уже изменились. Перезагрузите статью.');
      }
      fail('STALE_FILE_VERSION', `Repository file changed: ${filePath}`);
    }
  }
}
