import {
  commitPosts,
  getGitHubConfig,
  loadPostsSnapshot,
  parsePostId,
  PostsConfigError,
  PostsConflictError,
  PostsValidationError,
  validateEditablePost,
  type GitHubPostsEnv,
} from '../../../_lib/github-posts';
import {
  cleanupPostImageUploads,
  contentReferencesImageKey,
  MAX_PENDING_IMAGES,
  pendingTokensInContent,
  PostImageValidationError,
  putWebpWithAvailableKey,
  replacementKeysSafeToDelete,
  replacePendingImages,
  validateDeleteKeys,
  validateImageToken,
  validateImageDeletionPlan,
  validateManagedImageAlts,
  validateProcessedWebp,
  type PostImagesBucket,
} from '../../../_lib/post-images';

interface Context {
  request: Request;
  env: GitHubPostsEnv & { POST_IMAGES?: PostImagesBucket };
  params: { id?: string | string[] };
}

export async function onRequestGet(context: Context): Promise<Response> {
  try {
    const id = parsePostId(context.params.id);
    const snapshot = await loadPostsSnapshot(getGitHubConfig(context.env));
    const post = snapshot.posts[id];
    if (!post) return json({ ok: false, error: 'Статья не найдена.' }, 404);
    return json({ ok: true, post, version: snapshot.blobSha, writable: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestPut(context: Context): Promise<Response> {
  const uploadedKeys: string[] = [];
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
    const config = getGitHubConfig(context.env);
    const snapshot = await loadPostsSnapshot(config);
    if (snapshot.blobSha !== expectedVersion) {
      throw new PostsConflictError('Статья или набор постов уже изменились. Перезагрузите страницу.');
    }
    const current = snapshot.posts[id];
    if (!current || current.slug !== originalSlug) {
      throw new PostsConflictError('Позиция статьи изменилась. Перезагрузите страницу.');
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

    snapshot.posts[id] = { ...current, ...edited };
    JSON.parse(JSON.stringify(snapshot.posts));
    const result = await commitPosts(config, snapshot, snapshot.posts);

    const deletedKeys: string[] = [];
    const warnings: string[] = [];
    const replacementPlan = replacementKeysSafeToDelete(snapshot.posts, id, replaceCleanupKeys);
    for (const key of replacementPlan.shared) warnings.push(`Старый файл ${key} сохранён в R2: он используется другой статьёй.`);
    const safeReplacementDeletes = replacementPlan.safe;
    for (const key of [...new Set([...deleteKeys, ...safeReplacementDeletes])]) {
      try {
        await context.env.POST_IMAGES!.delete(key);
        deletedKeys.push(key);
      } catch (error) {
        console.error('R2 delete after GitHub save failed', key, error);
        warnings.push(`Ссылка удалена, но файл ${key} не удалось удалить из R2.`);
      }
    }
    return json({
      ok: true,
      ...result,
      post: snapshot.posts[id],
      uploadedKeys,
      deletedKeys,
      warnings,
      url: `/${encodeURIComponent(edited.slug)}/`,
    });
  } catch (error) {
    if (uploadedKeys.length && context.env.POST_IMAGES) {
      await cleanupPostImageUploads(context.env.POST_IMAGES, uploadedKeys);
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
