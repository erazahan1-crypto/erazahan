import {
  hyStorePaths,
  projectNativeHyPostCreate,
  projectExistingHyPostUpdate,
  validateHyRegistryEntries,
} from '../../src/lib/content-write/project-hy-post.mjs';
import { canonicalJsonEqual } from '../../src/lib/content-write/canonical-json.mjs';
import { resolveAdminWriteBranch } from './admin-write-environment-guard.mjs';

export const HY_ADMIN_WRITE_MODE_ENV = 'ERAZAHAN_HY_ADMIN_WRITE_MODE';
export const HY_ADMIN_ATOMIC_BRANCH_ENV = 'ERAZAHAN_HY_ADMIN_ATOMIC_BRANCH';
export const POSTS_PATH = 'src/data/posts.json';
export const REGISTRY_PATH = 'src/data/migrations/content-id-registry.v1.json';
const RESERVED_HY_SLUGS = new Set(['admin', 'api', 'robots.txt', 'sitemap.xml', '404']);

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

export function resolveAtomicGitHubBranch(env) {
  try {
    return resolveAdminWriteBranch(env, HY_ADMIN_ATOMIC_BRANCH_ENV);
  } catch (error) {
    if (error?.code) fail(error.code, error.message);
    throw error;
  }
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
  return validateHyRegistryEntries(registry.entries);
}

function postsFromSnapshot(snapshot) {
  const posts = parseSnapshotJson(snapshot, POSTS_PATH, 'posts.json');
  if (!Array.isArray(posts)) fail('INVALID_POSTS', 'posts.json must contain an array');
  return posts;
}

function assertPostIndexRegistryConsistency(posts, entries) {
  if (posts.some((post) => !post || typeof post !== 'object')) fail('INVALID_POSTS', 'posts.json must be a dense post array');
  if (entries.length !== posts.length) fail('REGISTRY_POST_COUNT_MISMATCH', 'registry and posts.json must have matching record counts');
  const indexes = new Set(entries.map((entry) => entry.legacy?.original_array_index ?? entry.native?.post_index));
  for (let index = 0; index < posts.length; index += 1) {
    if (!indexes.has(index)) fail('REGISTRY_IDENTITY_MISSING', `registry identity is missing for post index ${index}`);
  }
}

export async function loadAtomicHyWriteSnapshot(loadInitialSnapshot) {
  const snapshot = await loadInitialSnapshot([POSTS_PATH, REGISTRY_PATH]);
  const posts = postsFromSnapshot(snapshot);
  const entries = registryEntries(snapshot);
  assertPostIndexRegistryConsistency(posts, entries);
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
  assertPostIndexRegistryConsistency(posts, entries);
  if (!Number.isInteger(postIndex) || !posts[postIndex] || !canonicalJsonEqual(posts[postIndex], currentPost)) {
    fail('POST_SNAPSHOT_MISMATCH', 'current post is not from the supplied repository snapshot');
  }
  assertAtomicSourceUrl(currentPost, editedPost);

  const matches = entries.filter((entry) => entry?.legacy?.original_array_index === postIndex || entry?.native?.post_index === postIndex);
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

export function generateUuidV7(now = Date.now(), random = crypto.getRandomValues.bind(crypto)) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) fail('INVALID_CREATED_AT', 'native creation timestamp is invalid');
  const bytes = new Uint8Array(16);
  random(bytes);
  bytes[0] = Math.floor(now / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(now / 0x100000000) & 0xff;
  bytes[2] = Math.floor(now / 0x1000000) & 0xff;
  bytes[3] = Math.floor(now / 0x10000) & 0xff;
  bytes[4] = Math.floor(now / 0x100) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) => `${byte.toString(16).padStart(2, '0')}${[3, 5, 7, 9].includes(index) ? '-' : ''}`).join('');
}

export async function prepareAtomicHyCreate({ snapshot, editedPost, contentId, createdAt, loadSnapshotFiles }) {
  const posts = postsFromSnapshot(snapshot);
  const entries = registryEntries(snapshot);
  assertPostIndexRegistryConsistency(posts, entries);
  if (entries.some((entry) => entry?.content_id === contentId)) fail('CONTENT_ID_COLLISION', 'generated content_id already exists');
  const postIndex = posts.length;
  if (entries.some((entry) => entry?.native?.post_index === postIndex || entry?.legacy?.original_array_index === postIndex)) {
    fail('POST_ID_COLLISION', 'next post id is already reserved');
  }
  const normalizedSlug = editedPost?.slug?.normalize('NFKC').toLocaleLowerCase('hy-AM');
  if (RESERVED_HY_SLUGS.has(normalizedSlug)) fail('SLUG_RESERVED', 'slug is reserved by the site');
  if (typeof normalizedSlug !== 'string' || posts.some((post) => typeof post?.slug === 'string' && post.slug.normalize('NFKC').toLocaleLowerCase('hy-AM') === normalizedSlug)) {
    fail('SLUG_COLLISION', 'slug is already used by another HY dictionary post');
  }
  const sourceUrl = `https://erazahan.info/${encodeURIComponent(editedPost.slug)}/`;
  if (posts.some((post) => post?.sourceUrl === sourceUrl)) fail('SOURCE_URL_COLLISION', 'sourceUrl is already reserved');
  const paths = hyStorePaths(contentId);
  const fullSnapshot = await loadSnapshotFiles(snapshot, [paths.item, paths.hy]);
  if (fullSnapshot.files.get(paths.item) !== null || fullSnapshot.files.get(paths.hy) !== null) fail('CONTENT_ID_COLLISION', 'generated content store already exists');
  const projection = projectNativeHyPostCreate({ contentId, postIndex, editedPost, sourceUrl, createdAt });
  const registry = parseSnapshotJson(snapshot, REGISTRY_PATH, 'content ID registry');
  const updatedPosts = [...posts, projection.post];
  const updatedRegistry = { ...registry, entries: [...entries, projection.registryEntry] };
  return {
    snapshot: fullSnapshot,
    projection,
    postIndex,
    updatedPosts,
    changes: [
      { operation: 'update', path: POSTS_PATH, content: JSON.stringify(updatedPosts) },
      { operation: 'update', path: REGISTRY_PATH, content: JSON.stringify(updatedRegistry, null, 2) },
      { operation: 'create', path: paths.item, content: projection.serialized.item },
      { operation: 'create', path: paths.hy, content: projection.serialized.hy },
    ],
  };
}
