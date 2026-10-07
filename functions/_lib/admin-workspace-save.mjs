import { hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import { POSTS_PATH, loadAtomicHyWriteSnapshot, prepareAtomicHyWrite } from './admin-atomic-hy-write.mjs';
import { DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH, localeTranslationEditorStateFromSnapshot, prepareLocaleWorkspaceDraftSave } from './admin-locale-draft-write.mjs';
import { commitMultiFileTransaction, loadMultiFileSnapshot } from './github-multifile.mjs';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function applyChanges(snapshot, changes) {
  const files = new Map(snapshot.files);
  for (const change of changes) {
    if (change.operation === 'delete') files.set(change.path, null);
    else files.set(change.path, { ...(files.get(change.path) ?? { sha: '' }), content: change.content });
  }
  return { ...snapshot, files };
}

function mergeChanges(target, changes) {
  for (const change of changes) target.set(change.path, change);
}

export async function loadWorkspaceSnapshot(client, { branch, contentId }) {
  const paths = hyStorePaths(contentId);
  const atomic = await loadAtomicHyWriteSnapshot(
    (initialPaths) => loadMultiFileSnapshot(client, { branch, paths: initialPaths }),
    [paths.item, paths.hy, `${paths.directory}/ru.json`, `${paths.directory}/en.json`, DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH],
  );
  const matches = atomic.registryEntries.filter((entry) => entry.content_id === contentId);
  if (matches.length !== 1) fail('CONTENT_NOT_FOUND', 'Workspace content identity is unavailable');
  const postIndex = matches[0].legacy?.original_array_index ?? matches[0].native?.post_index;
  if (!Number.isInteger(postIndex) || !atomic.posts[postIndex]) fail('CONTENT_NOT_FOUND', 'Workspace HY post is unavailable');
  return { ...atomic, contentId, postIndex, paths };
}

export function workspaceStateFromSnapshot(loaded) {
  return {
    content_id: loaded.contentId,
    hy: { post_index: loaded.postIndex, post: structuredClone(loaded.posts[loaded.postIndex]), posts_blob_sha: loaded.blobSha },
    ru: localeTranslationEditorStateFromSnapshot({ snapshot: loaded.snapshot, contentId: loaded.contentId, locale: 'ru' }),
    en: localeTranslationEditorStateFromSnapshot({ snapshot: loaded.snapshot, contentId: loaded.contentId, locale: 'en' }),
  };
}

export async function saveWorkspace(client, { branch, contentId, hy = null, locales = {} }) {
  const loaded = await loadWorkspaceSnapshot(client, { branch, contentId });
  const originalSnapshot = loaded.snapshot;
  let effectiveSnapshot = originalSnapshot;
  const changes = new Map();
  const expectedFileShas = {};
  const saved = { hy: false, ru: false, en: false };

  if (hy) {
    if (hy.expectedPostsBlobSha !== loaded.blobSha || hy.originalSlug !== loaded.posts[loaded.postIndex].slug) fail('STALE_EDITOR', 'HY source changed; reload the workspace');
    const prepared = await prepareAtomicHyWrite({
      snapshot: effectiveSnapshot,
      postIndex: loaded.postIndex,
      currentPost: loaded.posts[loaded.postIndex],
      editedPost: hy.post,
      loadSnapshotFiles: async (snapshot, paths) => ({ ...snapshot, files: new Map(snapshot.files) }),
    });
    mergeChanges(changes, prepared.changes);
    effectiveSnapshot = applyChanges(effectiveSnapshot, prepared.changes);
    loaded.posts = prepared.updatedPosts;
    saved.hy = prepared.changes.some((change) => originalSnapshot.files.get(change.path)?.content !== change.content);
  }

  for (const locale of ['ru', 'en']) {
    const request = locales[locale];
    if (!request) continue;
    const prepared = prepareLocaleWorkspaceDraftSave({
      snapshot: effectiveSnapshot,
      contentId,
      locale,
      payload: request.payload,
      expectedLocaleAbsent: request.expectedLocaleAbsent,
      expectedLocaleBlobSha: request.expectedLocaleBlobSha,
    });
    mergeChanges(changes, prepared.changes);
    effectiveSnapshot = applyChanges(effectiveSnapshot, prepared.changes);
    const localePath = `${loaded.paths.directory}/${locale}.json`;
    if (originalSnapshot.files.get(localePath)?.sha) expectedFileShas[localePath] = originalSnapshot.files.get(localePath).sha;
    saved[locale] = prepared.changes.some((change) => originalSnapshot.files.get(change.path)?.content !== change.content);
  }

  const transaction = await commitMultiFileTransaction(client, {
    snapshot: originalSnapshot,
    expectedPostsBlobSha: hy ? hy.expectedPostsBlobSha : undefined,
    expectedFileShas,
    changes: [...changes.values()],
    message: 'Admin: save multilingual workspace',
  });
  return { transaction, saved, state: workspaceStateFromSnapshot({ ...loaded, snapshot: effectiveSnapshot }) };
}
