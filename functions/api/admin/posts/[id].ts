import {
  commitMultiFileTransaction,
  getGitHubConfig,
  loadMultiFileSnapshot,
  loadSnapshotFiles,
  parsePostId,
  PostsConfigError,
  PostsConflictError,
  PostsValidationError,
  validateEditablePost,
  type GitHubPostsEnv,
} from '../../../_lib/github-posts';
import {
  assertAtomicSourceUrl,
  loadAtomicHyWriteSnapshot,
  prepareAtomicHyWrite,
  resolveAtomicGitHubBranch,
  resolveHyAdminWriteMode,
} from '../../../_lib/admin-atomic-hy-write.mjs';
import { classifyAdminHyWriteError } from '../../../_lib/admin-hy-error-classification.mjs';
import {
  cleanupPostImageUploads,
  contentReferencesImageKey,
  MAX_PENDING_IMAGES,
  pendingTokensInContent,
  PostImageValidationError,
  putWebpWithAvailableKey,
  replacePendingImages,
  validateDeleteKeys,
  validateImageToken,
  validateImageDeletionPlan,
  validateManagedImageAlts,
  validateProcessedWebp,
  type PostImagesBucket,
} from '../../../_lib/post-images';
import { isContentId } from '../../../../src/lib/content-schema/schema.mjs';
import { committedImageDeletionPlan, deleteCommittedImageKeys, uploadedImageCleanupKeys } from '../../../_lib/media-lifecycle.mjs';
import { loadPersistedLocaleDocuments } from '../../../_lib/github-posts';

const MEDIA_MANIFEST_PATH = 'src/data/content/media-manifest.v1.json';

interface Context {
  request: Request;
  env: GitHubPostsEnv & { POST_IMAGES?: PostImagesBucket };
  params: { id?: string | string[] };
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const id = parsePostId(context.params.id);
    const config = getGitHubConfig(context.env);
    const snapshot = await loadAtomicHyWriteSnapshot((paths) => loadMultiFileSnapshot(config, paths));
    const post = snapshot.posts[id];
    if (!post) return json({ ok: false, error: 'Статья не найдена.' }, 404);
    const matches = snapshot.registryEntries.filter((entry) => entry?.legacy?.original_array_index === id || entry?.native?.post_index === id);
    if (matches.length !== 1 || !isContentId(matches[0]?.content_id)) {
      throw new PostsConfigError('Translation identity is unavailable for this article.');
    }
    return json({ ok: true, post, version: snapshot.blobSha, writable: true, content_id: matches[0].content_id });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPut(context: Context): Promise<Response> {
  const uploadedKeys: string[] = [];
  let commitOutcome: 'not_committed' | 'committed' | 'unknown' = 'not_committed';
  try {
    const requestUrl = new URL(context.request.url);
    if (context.request.headers.get('origin') !== requestUrl.origin) {
      return json({ ok: false, error: 'Запрос отклонён.' }, 403);
    }
    const requestType = context.request.headers.get('content-type')?.toLowerCase() || '';
    if (!requestType.startsWith('application/json') && !requestType.startsWith('multipart/form-data')) {
      return json({ ok: false, error: 'Ожидается JSON или multipart/form-data запрос.' }, 415);
    }
    const contentLength = Number(context.request.headers.get('content-length') || '0');
    const maxRequestBytes = requestType.startsWith('multipart/form-data') ? 26_000_000 : 2_100_000;
    if (contentLength > maxRequestBytes) return json({ ok: false, error: 'Запрос слишком велик.' }, 413);

    const id = parsePostId(context.params.id);
    const { body, files } = await parseSaveRequest(context.request, requestType);
    const expectedVersion = typeof body.version === 'string' ? body.version : '';
    const originalSlug = typeof body.originalSlug === 'string' ? body.originalSlug : '';
    if (!/^[0-9a-f]{40}$/.test(expectedVersion) || !originalSlug) {
      throw new PostsValidationError('Отсутствует версия исходного файла. Перезагрузите статью.');
    }

    let edited = validateEditablePost(body.post);
    resolveHyAdminWriteMode(context.env);
    // Validate the explicit atomic target before any GitHub or R2 operation.
    resolveAtomicGitHubBranch(context.env);
    const config = getGitHubConfig(context.env);
    const atomicSnapshot = await loadAtomicHyWriteSnapshot((paths) => loadMultiFileSnapshot(config, paths));
    const snapshot = { posts: atomicSnapshot.posts, blobSha: atomicSnapshot.blobSha };
    if (snapshot.blobSha !== expectedVersion) {
      throw new PostsConflictError('Статья или набор постов уже изменились. Перезагрузите страницу.');
    }
    const current = snapshot.posts[id];
    if (!current || current.slug !== originalSlug) {
      throw new PostsConflictError('Позиция статьи изменилась. Перезагрузите страницу.');
    }
    assertAtomicSourceUrl(current, edited);
    const nativeIdentity = atomicSnapshot.registryEntries.find((entry) => entry?.native?.post_index === id)?.native;
    if (nativeIdentity && edited.slug !== nativeIdentity.slug) {
      throw new PostsValidationError('Slug is immutable for a native HY dictionary post.');
    }
    const normalizedSlug = edited.slug.normalize('NFKC').toLocaleLowerCase('hy-AM');
    const duplicate = snapshot.posts.some((post, index) => index !== id
      && typeof post.slug === 'string'
      && post.slug.normalize('NFKC').toLocaleLowerCase('hy-AM') === normalizedSlug);
    if (duplicate) throw new PostsValidationError('Такой slug уже используется другой статьёй.');

    const pendingTokens = pendingTokensInContent(edited.content);
    if (edited.content.includes('pending-image:') && !pendingTokens.length) {
      throw new PostImageValidationError('Некорректная pending-разметка изображения.');
    }
    if (pendingTokens.length > MAX_PENDING_IMAGES) {
      throw new PostImageValidationError('Слишком много новых изображений за одно сохранение.');
    }
    if (pendingTokens.length !== files.size || pendingTokens.some((token) => !files.has(token))) {
      throw new PostImageValidationError('Набор pending-изображений не совпадает с переданными WebP-файлами.');
    }
    const deleteKeys = validateDeleteKeys(body.deleteImageKeys);
    const replaceCleanupKeys = validateDeleteKeys(body.replaceImageKeys);
    if ((pendingTokens.length || deleteKeys.length || replaceCleanupKeys.length) && !context.env.POST_IMAGES) {
      throw new PostsConfigError('R2 binding POST_IMAGES не настроен.');
    }

    for (const key of replaceCleanupKeys) {
      if (!contentReferencesImageKey(current.content, key)) {
        throw new PostImageValidationError('Удалять из R2 можно только изображение текущей статьи.');
      }
      if (contentReferencesImageKey(edited.content, key)) {
        throw new PostImageValidationError('Перед удалением из R2 уберите изображение из content.');
      }
    }
    validateImageDeletionPlan(snapshot.posts, id, current.content, edited.content, deleteKeys);

    let persistedAssetContext: { localeDocuments: unknown[]; mediaManifest: unknown } | null = null;
    if (deleteKeys.length || replaceCleanupKeys.length) {
      const manifestSnapshot = await loadSnapshotFiles(config, atomicSnapshot.snapshot, [MEDIA_MANIFEST_PATH]);
      const manifestFile = manifestSnapshot.files.get(MEDIA_MANIFEST_PATH);
      if (!manifestFile) throw new PostsConfigError('Managed media manifest is unavailable.');
      let mediaManifest: unknown;
      try { mediaManifest = JSON.parse(manifestFile.content); } catch { throw new PostsConfigError('Managed media manifest is invalid.'); }
      persistedAssetContext = {
        mediaManifest,
        localeDocuments: await loadPersistedLocaleDocuments(config, atomicSnapshot.snapshot),
      };
    }

    const uploaded = new Map<string, { key: string; width: number; height: number }>();
    for (const token of pendingTokens) {
      const image = await validateProcessedWebp(files.get(token)!);
      const key = await putWebpWithAvailableKey(context.env.POST_IMAGES!, edited.slug, image);
      uploadedKeys.push(key);
      uploaded.set(token, { key, width: image.width, height: image.height });
    }
    if (uploaded.size) {
      const rawPost = body.post as Record<string, unknown>;
      edited = validateEditablePost({ ...rawPost, content: replacePendingImages(edited.content, uploaded) });
    }
    if (edited.content.includes('pending-image:')) throw new PostImageValidationError('Не все pending-изображения обработаны.');
    validateManagedImageAlts(edited.content);

    let result: { commitSha: string | null; blobSha: string; noOp?: boolean };
    let savedPosts: Array<Record<string, unknown>>;
    try {
      const prepared = await prepareAtomicHyWrite({
        snapshot: atomicSnapshot.snapshot,
        postIndex: id,
        currentPost: current,
        editedPost: edited,
        loadSnapshotFiles: (baseSnapshot, paths) => loadSnapshotFiles(config, baseSnapshot, paths),
      });
      const transaction = await commitMultiFileTransaction(
        config,
        prepared.snapshot,
        snapshot.blobSha,
        prepared.changes,
        'Admin: update dream dictionary article',
      );
      result = {
        commitSha: transaction.commitSha,
        blobSha: transaction.blobShas.get('src/data/posts.json') || snapshot.blobSha,
        noOp: transaction.noOp,
      };
      savedPosts = prepared.updatedPosts;
      commitOutcome = 'committed';
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'BRANCH_REF_UPDATE_FAILURE') {
        commitOutcome = 'unknown';
      }
      if (error && typeof error === 'object' && (
        (error as { code?: unknown }).code === 'STALE_POSTS_VERSION'
        || (error as { code?: unknown }).code === 'BRANCH_REF_CONFLICT'
      )) {
        throw new PostsConflictError('Article or branch changed during save. Reload the page.');
      }
      throw error;
    }

    const deletedKeys: string[] = [];
    const warnings: string[] = [];
    const requestedDeletes = [...new Set([...deleteKeys, ...replaceCleanupKeys])];
    const deletionPlan = persistedAssetContext
      ? committedImageDeletionPlan(commitOutcome, { posts: savedPosts, ...persistedAssetContext }, requestedDeletes)
      : { safe: [], retained: [] };
    if (deletionPlan.retained.length) warnings.push('One or more R2 objects remain referenced by persisted content.');
    const completedDeletes = await deleteCommittedImageKeys(context.env.POST_IMAGES!, deletionPlan.safe);
    deletedKeys.push(...completedDeletes.deleted);
    for (const key of completedDeletes.failed) warnings.push(`Ссылка удалена, но файл ${key} не удалось удалить из R2.`);
    return json({
      ok: true,
      ...result,
      post: savedPosts[id],
      uploadedKeys,
      deletedKeys,
      warnings,
      url: `/${encodeURIComponent(edited.slug)}/`,
    });
  } catch (error) {
    const cleanupKeys = uploadedImageCleanupKeys(commitOutcome, uploadedKeys);
    if (cleanupKeys.length && context.env.POST_IMAGES) {
      await cleanupPostImageUploads(context.env.POST_IMAGES, cleanupKeys);
    }
    return handleError(error);
  }
}

async function parseSaveRequest(request: Request, contentType: string): Promise<{
  body: Record<string, unknown>;
  files: Map<string, File>;
}> {
  if (contentType.startsWith('application/json')) {
    try {
      return { body: await request.json() as Record<string, unknown>, files: new Map() };
    } catch {
      throw new PostsValidationError('Некорректный JSON-запрос.');
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new PostsValidationError('Некорректный multipart-запрос.');
  }
  const payload = form.get('payload');
  if (typeof payload !== 'string' || payload.length > 2_100_000) {
    throw new PostsValidationError('Некорректный payload статьи.');
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    throw new PostsValidationError('Некорректный JSON payload статьи.');
  }
  const files = new Map<string, File>();
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('image:')) continue;
    if (!(value instanceof File)) throw new PostImageValidationError('Некорректный файл изображения.');
    const token = validateImageToken(name.slice('image:'.length));
    if (files.has(token)) throw new PostImageValidationError('Изображение передано повторно.');
    files.set(token, value);
  }
  if (files.size > MAX_PENDING_IMAGES) throw new PostImageValidationError('Слишком много изображений за одно сохранение.');
  return { body, files };
}

function handleError(error: unknown): Response {
  const classification = classifyAdminHyWriteError(error);
  if (classification?.kind === 'commit_outcome_unknown') {
    return json({ ok: false, error: 'Save outcome is unknown. Reload the article before retrying.' }, 502);
  }
  if (classification?.kind === 'configuration') {
    return json({ ok: false, code: classification.code, error: 'Admin writing is unavailable.', writable: false }, 503);
  }
  if (classification?.kind === 'integrity') {
    return json({ ok: false, code: classification.code, error: 'Repository integrity validation failed.', writable: false }, 503);
  }
  if (classification?.kind === 'upstream') {
    return json({ ok: false, code: classification.code, error: 'GitHub is temporarily unavailable.' }, 502);
  }
  if (classification?.kind === 'conflict') {
    return json({ ok: false, error: 'Article or branch changed during save. Reload the page.', conflict: true }, 409);
  }
  if (error instanceof PostsConfigError) return json({ ok: false, error: error.message, writable: false }, 503);
  if (error instanceof PostsConflictError) return json({ ok: false, error: error.message, conflict: true }, 409);
  if (error instanceof PostsValidationError || error instanceof PostImageValidationError) {
    return json({ ok: false, error: error.message }, 400);
  }
  console.error('Admin posts API failed', error);
  return json({ ok: false, error: 'Не удалось обработать статью через GitHub.' }, 502);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
