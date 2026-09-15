import { isContentId } from '../../../../src/lib/content-schema/schema.mjs';
import { loadLocaleTranslationEditorState } from '../../../_lib/admin-locale-draft-write.mjs';
import { createGitHubTransactionClient, getGitHubConfig, PostsConfigError, type GitHubPostsEnv } from '../../../_lib/github-posts.ts';

interface Context { request: Request; env: GitHubPostsEnv; }

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function invalidRequest() { return json({ ok: false, code: 'INVALID_REQUEST' }, 400); }
function query(request: Request) {
  const url = new URL(request.url);
  const contentIds = url.searchParams.getAll('content_id');
  const locales = url.searchParams.getAll('locale');
  if (contentIds.length !== 1 || locales.length !== 1 || !isContentId(contentIds[0]) || !['ru', 'en'].includes(locales[0])) return null;
  return { contentId: contentIds[0], locale: locales[0] };
}

export async function onRequestGet(context: Context): Promise<Response> {
  const input = query(context.request);
  if (!input) return invalidRequest();
  try {
    const config = getGitHubConfig(context.env);
    const state = await loadLocaleTranslationEditorState(createGitHubTransactionClient(config), { ...input, branch: config.branch });
    return json({ ok: true, ...state });
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
    if (code === 'CONTENT_NOT_FOUND') return json({ ok: false, code }, 404);
    if (code === 'LOCALE_UNSUPPORTED') return json({ ok: false, code }, 400);
    if (error instanceof PostsConfigError || ['SNAPSHOT_FILE_MISSING', 'INVALID_SNAPSHOT_JSON', 'INVALID_SNAPSHOT_STATE', 'INVALID_HY_SOURCE', 'INVALID_SNAPSHOT'].includes(code ?? '')) return json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, 503);
    if (['REF_LOOKUP_FAILURE', 'COMMIT_LOOKUP_FAILURE', 'SNAPSHOT_FILE_FAILURE'].includes(code ?? '')) return json({ ok: false, code: 'UPSTREAM_FAILURE' }, 502);
    return json({ ok: false, code: 'INTERNAL_ERROR' }, 500);
  }
}

export function onRequest(): Response {
  return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET' });
}
