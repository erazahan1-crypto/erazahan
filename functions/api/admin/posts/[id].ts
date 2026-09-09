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

interface Context {
  request: Request;
  env: GitHubPostsEnv;
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
  try {
    const requestUrl = new URL(context.request.url);
    if (context.request.headers.get('origin') !== requestUrl.origin) {
      return json({ ok: false, error: 'Запрос отклонён.' }, 403);
    }
    if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ ok: false, error: 'Ожидается JSON-запрос.' }, 415);
    }
    const contentLength = Number(context.request.headers.get('content-length') || '0');
    if (contentLength > 2_100_000) return json({ ok: false, error: 'Запрос слишком велик.' }, 413);
    const id = parsePostId(context.params.id);
    let body: Record<string, unknown>;
    try {
      body = await context.request.json() as Record<string, unknown>;
    } catch {
      throw new PostsValidationError('Некорректный JSON-запрос.');
    }
    const expectedVersion = typeof body.version === 'string' ? body.version : '';
    const originalSlug = typeof body.originalSlug === 'string' ? body.originalSlug : '';
    if (!/^[0-9a-f]{40}$/.test(expectedVersion) || !originalSlug) {
      throw new PostsValidationError('Отсутствует версия исходного файла. Перезагрузите статью.');
    }
    const edited = validateEditablePost(body.post);
    const config = getGitHubConfig(context.env);
    const snapshot = await loadPostsSnapshot(config);
    if (snapshot.blobSha !== expectedVersion) throw new PostsConflictError('Статья или набор постов уже изменились. Перезагрузите страницу.');
    const current = snapshot.posts[id];
    if (!current || current.slug !== originalSlug) throw new PostsConflictError('Позиция статьи изменилась. Перезагрузите страницу.');
    const normalizedSlug = edited.slug.normalize('NFKC').toLocaleLowerCase('hy-AM');
    const duplicate = snapshot.posts.some((post, index) => index !== id
      && typeof post.slug === 'string'
      && post.slug.normalize('NFKC').toLocaleLowerCase('hy-AM') === normalizedSlug);
    if (duplicate) throw new PostsValidationError('Такой slug уже используется другой статьёй.');

    snapshot.posts[id] = { ...current, ...edited };
    // Ensure the exact source representation remains valid JSON before creating a Git blob.
    JSON.parse(JSON.stringify(snapshot.posts));
    const result = await commitPosts(config, snapshot, snapshot.posts);
    return json({ ok: true, ...result, url: `/${encodeURIComponent(edited.slug)}/` });
  } catch (error) {
    return handleError(error);
  }
}

function handleError(error: unknown): Response {
  if (error instanceof PostsConfigError) return json({ ok: false, error: error.message, writable: false }, 503);
  if (error instanceof PostsConflictError) return json({ ok: false, error: error.message, conflict: true }, 409);
  if (error instanceof PostsValidationError) return json({ ok: false, error: error.message }, 400);
  console.error('Admin posts API failed', error);
  return json({ ok: false, error: 'Не удалось обработать статью через GitHub.' }, 502);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
