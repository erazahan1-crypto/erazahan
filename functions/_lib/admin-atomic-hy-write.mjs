import {
  hyStorePaths,
  projectExistingHyPostUpdate,
} from '../../src/lib/content-write/project-hy-post.mjs';
import { canonicalJsonEqual } from '../../src/lib/content-write/canonical-json.mjs';

export const HY_ADMIN_WRITE_MODE_ENV = 'ERAZAHAN_HY_ADMIN_WRITE_MODE';
export const HY_ADMIN_ATOMIC_BRANCH_ENV = 'ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH';
export const POSTS_PATH = 'src/data/posts.json';
export const REGISTRY_PATH = 'src/data/migrations/content-id-registry.v1.json';

export class AdminAtomicHyWriteError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AdminAtomicHyWriteError';
    this.code = code;
  }
}

function fail(code, message, cause = undefined) {
  throw new AdminAtomicHyWriteError(code, message, cause);
}

export function resolveHyAdminWriteMode(env) {
  const configured = env?.[HY_ADMIN_WRITE_MODE_ENV];
  if (configured === undefined) return 'legacy';
  if (configured === 'legacy' || configured === 'atomic') return configured;
  fail('INVALID_WRITE_MODE', `${HY_ADMIN_WRITE_MODE_ENV} must be legacy or atomic`);
}

function requiredBranch(env, name) {
  const value = env?.[name];
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', `${name} must be explicitly configured for atomic writes`);
  }
  return value.trim();
}

// Atomic writes deliberately do not inherit the legacy main fallback. Both
// independently configured values must name the same explicit target branch.
export function resolveAtomicGitHubBranch(env) {
  const configuredBranch = requiredBranch(env, 'ADMIN_GITHUB_BRANCH');
  const confirmedBranch = requiredBranch(env, HY_ADMIN_ATOMIC_BRANCH_ENV);
  if (configuredBranch !== confirmedBranch) {
    fail('INVALID_ATOMIC_BRANCH_CONFIRMATION', 'ADMIN_GITHUB_BRANCH must match ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH for atomic writes');
  }
  return configuredBranch;
}

function parseSnapshotJson(snapshot, path, label) {
  const source = snapshot?.files?.get(path)?.content;
  if (typeof source !== 'string') fail('SNAPSHOT_FILE_MISSING', `snapshot is missing ${path}`);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail('INVALID_SNAPSHOT_JSON', `${label} is not valid JSON`, error);
  }
}

function registryEntries(snapshot) {
  const registry = parseSnapshotJson(snapshot, REGISTRY_PATH, 'content ID registry');
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.entries)) {
    fail('INVALID_REGISTRY', 'content ID registry entries are invalid');
  }
  return registry.entries;
}

function postsFromSnapshot(snapshot) {
  const posts = parseSnapshotJson(snapshot, POSTS_PATH, 'posts.json');
  if (!Array.isArray(posts)) fail('INVALID_POSTS', 'posts.json must contain an array');
  return posts;
}

export async function loadAtomicHyWriteSnapshot(loadInitialSnapshot) {
  const snapshot = await loadInitialSnapshot([POSTS_PATH, REGISTRY_PATH]);
  const posts = postsFromSnapshot(snapshot);
  const entries = registryEntries(snapshot);
  const blobSha = snapshot.files.get(POSTS_PATH)?.sha;
  if (typeof blobSha !== 'string' || !blobSha) fail('SNAPSHOT_FILE_MISSING', 'posts.json blob SHA is missing');
  return { snapshot, posts, registryEntries: entries, blobSha };
}

export function assertAtomicSourceUrl(currentPost, editedPost) {
  if (!currentPost || typeof currentPost.sourceUrl !== 'string') {
    fail('INVALID_CURRENT_POST', 'current post sourceUrl is invalid');
  }
  if (!editedPost || editedPost.sourceUrl !== currentPost.sourceUrl) {
    fail('SOURCE_URL_IMMUTABLE', 'sourceUrl is immutable for an existing HY dictionary post');
  }
}

export async function prepareAtomicHyWrite({
  snapshot,
  postIndex,
  currentPost,
  editedPost,
  loadSnapshotFiles,
}) {
  const posts = postsFromSnapshot(snapshot);
  const entries = registryEntries(snapshot);
  if (!Number.isInteger(postIndex) || !posts[postIndex] || !canonicalJsonEqual(posts[postIndex], currentPost)) {
    fail('POST_SNAPSHOT_MISMATCH', 'current post is not from the supplied repository snapshot');
  }
  assertAtomicSourceUrl(currentPost, editedPost);

  const matches = entries.filter((entry) => entry?.legacy?.original_array_index === postIndex);
  if (matches.length !== 1) fail('REGISTRY_IDENTITY_MISSING', 'registry identity is unavailable for this post');
  const paths = hyStorePaths(matches[0].content_id);
  const fullSnapshot = await loadSnapshotFiles(snapshot, [paths.item, paths.hy]);
  const currentItem = parseSnapshotJson(fullSnapshot, paths.item, 'HY item');
  const currentHy = parseSnapshotJson(fullSnapshot, paths.hy, 'HY locale document');
  const projection = projectExistingHyPostUpdate({
    postIndex,
    currentPost,
    editedPost,
    registryEntries: entries,
    currentItem,
    currentHy,
    itemPath: paths.item,
    hyPath: paths.hy,
  });

  const updatedPosts = posts.map((post, index) => index === postIndex ? projection.updatedPost : post);
  const serializedPosts = JSON.stringify(updatedPosts);
  return {
    snapshot: fullSnapshot,
    projection,
    updatedPosts,
    changes: [
      { path: POSTS_PATH, content: serializedPosts },
      { path: paths.item, content: projection.serialized.item },
      { path: paths.hy, content: projection.serialized.hy },
    ],
  };
}
