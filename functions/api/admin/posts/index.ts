import {
  commitMultiFileTransaction,
  getGitHubConfig,
  loadMultiFileSnapshot,
  loadSnapshotFiles,
  PostsConfigError,
  PostsConflictError,
  PostsValidationError,
  validateEditablePost,
  type GitHubPostsEnv,
} from '../../../_lib/github-posts';
import {
  AdminAtomicHyWriteError,
  generateUuidV7,
  loadAtomicHyWriteSnapshot,
  prepareAtomicHyCreate,
  resolveAtomicGitHubBranch,
  resolveHyAdminWriteMode,
} from '../../../_lib/admin-atomic-hy-write.mjs';
import { HyWriteProjectionError } from '../../../../src/lib/content-write/project-hy-post.mjs';

interface Context { request: Request; env: GitHubPostsEnv }

export async function onRequestPost(context: Context): Promise<Response> {
  try {
    const requestUrl = new URL(context.request.url);
    if (context.request.headers.get('origin') !== requestUrl.origin) return json({ ok: false, error: 'Request rejected.' }, 403);
    if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return json({ ok: false, error: 'Expected JSON request.' }, 415);
    }
    if (Number(context.request.headers.get('content-length') || '0') > 2_100_000) return json({ ok: false, error: 'Request is too large.' }, 413);
    let body: Record<string, unknown>;
    try { body = await context.request.json() as Record<string, unknown>; } catch { throw new PostsValidationError('Invalid JSON request.'); }
    const post = validateEditablePost({ ...(body.post as Record<string, unknown>), sourceUrl: 'https://invalid.example/' });
    const writeMode = resolveHyAdminWriteMode(context.env);
    if (writeMode !== 'atomic') throw new AdminAtomicHyWriteError('INVALID_WRITE_MODE', 'Native HY creation requires atomic writer mode.');
    const branch = resolveAtomicGitHubBranch(context.env);
    const config = getGitHubConfig(context.env);
    if (config.branch !== branch) throw new PostsConfigError('Admin GitHub branch does not match the approved atomic branch.');
    const initial = await loadAtomicHyWriteSnapshot((paths) => loadMultiFileSnapshot(config, paths));
    const createdAt = new Date().toISOString();
    const contentId = generateUuidV7(Date.now());
    const prepared = await prepareAtomicHyCreate({
      snapshot: initial.snapshot,
      editedPost: post,
      contentId,
      createdAt,
      loadSnapshotFiles: (baseSnapshot, paths) => loadSnapshotFiles(config, baseSnapshot, paths),
    });
    const transaction = await commitMultiFileTransaction(config, prepared.snapshot, {
      expectedFileShas: {
        'src/data/posts.json': initial.blobSha,
        'src/data/migrations/content-id-registry.v1.json': initial.snapshot.files.get('src/data/migrations/content-id-registry.v1.json')!.sha,
      },
      changes: prepared.changes,
      message: 'Admin: create dream dictionary article',
    });
    return json({ ok: true, id: String(prepared.postIndex), content_id: contentId, sourceUrl: prepared.projection.post.sourceUrl, commitSha: transaction.commitSha }, 201);
  } catch (error) {
    if (error instanceof AdminAtomicHyWriteError || error instanceof HyWriteProjectionError || error instanceof PostsValidationError) {
      const status = error instanceof AdminAtomicHyWriteError && ['INVALID_WRITE_MODE', 'INVALID_ATOMIC_BRANCH_CONFIRMATION', 'INVALID_WRITE_ENVIRONMENT'].includes(error.code) ? 503 : 400;
      return json({ ok: false, error: error.message }, status);
    }
    if (error instanceof PostsConfigError) return json({ ok: false, error: error.message }, 503);
    if (error instanceof PostsConflictError || (error && typeof error === 'object' && ['BRANCH_REF_CONFLICT', 'STALE_FILE_VERSION'].includes((error as { code?: string }).code || ''))) {
      return json({ ok: false, error: 'Article collection changed during creation. Retry the request.', conflict: true }, 409);
    }
    console.error('Admin native post creation failed', error);
    return json({ ok: false, error: 'Could not create the article through GitHub.' }, 502);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
