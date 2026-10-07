import { isContentId } from '../../../../src/lib/content-schema/schema.mjs';
import { validateEditablePost, createGitHubTransactionClient, getGitHubConfig, PostsConfigError, type GitHubPostsEnv } from '../../../_lib/github-posts.ts';
import { classifyAdminHyWriteError } from '../../../_lib/admin-hy-error-classification.mjs';
import { resolveAdminWriteBranch } from '../../../_lib/admin-write-environment-guard.mjs';
import { resolveAtomicGitHubBranch, resolveHyAdminWriteMode } from '../../../_lib/admin-atomic-hy-write.mjs';
import { loadWorkspaceSnapshot, saveWorkspace, workspaceStateFromSnapshot } from '../../../_lib/admin-workspace-save.mjs';
import { ControlledLocalizedValidationError } from '../../../_lib/admin-locale-draft-write.mjs';

interface Context { request: Request; params: { contentId?: string | string[] }; env: GitHubPostsEnv & Record<string, string | undefined>; }
const BODY_LIMIT = 2_100_000;
const PAYLOAD_KEYS = ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key'];

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }); }
function contentId(context: Context) { const value = Array.isArray(context.params.contentId) ? context.params.contentId[0] : context.params.contentId; return typeof value === 'string' && isContentId(value) ? value : null; }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function validateLocaleRequest(value: unknown) {
  if (!object(value) || !object(value.payload) || !exactKeys(value.payload, PAYLOAD_KEYS)) throw Object.assign(new Error('Invalid localized workspace payload'), { code: 'INVALID_REQUEST' });
  if (value.expectedLocaleAbsent === true && !Object.hasOwn(value, 'expectedLocaleBlobSha')) return { payload: value.payload, expectedLocaleAbsent: true, expectedLocaleBlobSha: undefined };
  if (typeof value.expectedLocaleBlobSha === 'string' && /^[0-9a-f]{40}$/.test(value.expectedLocaleBlobSha) && !Object.hasOwn(value, 'expectedLocaleAbsent')) return { payload: value.payload, expectedLocaleAbsent: undefined, expectedLocaleBlobSha: value.expectedLocaleBlobSha };
  throw Object.assign(new Error('Invalid locale concurrency state'), { code: 'INVALID_REQUEST' });
}
function errorResponse(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  if (error instanceof ControlledLocalizedValidationError || ['INVALID_REQUEST', 'DRAFT_INVALID', 'SLUG_INVALID', 'NO_DRAFT'].includes(code ?? '')) return json({ ok: false, code: code ?? 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Invalid workspace data' }, 400);
  if (['STALE_EDITOR', 'STALE_FILE_VERSION', 'STALE_POSTS_VERSION', 'BRANCH_REF_CONFLICT', 'SOURCE_CHANGED', 'SLUG_RESERVED', 'SLUG_CLAIMED', 'SLUG_PERMANENTLY_RESERVED', 'PUBLISHED_SLUG_LOCKED'].includes(code ?? '')) return json({ ok: false, code, message: 'The workspace changed elsewhere. Reload and reconcile before saving again.' }, 409);
  if (code === 'BRANCH_REF_UPDATE_FAILURE') return json({ ok: false, code, message: 'Save outcome is uncertain. Reload the post before retrying.' }, 502);
  if (error instanceof PostsConfigError || ['INVALID_WRITE_MODE', 'INVALID_ATOMIC_BRANCH_CONFIRMATION', 'INVALID_WRITE_ENVIRONMENT', 'INVALID_SNAPSHOT', 'INVALID_SNAPSHOT_STATE', 'INVALID_HY_SOURCE'].includes(code ?? '')) return json({ ok: false, code: code ?? 'SERVICE_UNAVAILABLE', message: 'Repository integrity validation failed.' }, 503);
  if (['REF_LOOKUP_FAILURE', 'COMMIT_LOOKUP_FAILURE', 'SNAPSHOT_FILE_FAILURE', 'BLOB_CREATION_FAILURE', 'TREE_CREATION_FAILURE', 'COMMIT_CREATION_FAILURE'].includes(code ?? '')) return json({ ok: false, code: 'UPSTREAM_FAILURE', message: 'Save is temporarily unavailable.' }, 502);
  return json({ ok: false, code: 'INTERNAL_ERROR', message: 'Save is temporarily unavailable.' }, 500);
}

function getErrorResponse(error: unknown, identityResolved: boolean) {
  const stage = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  const classification = classifyAdminHyWriteError(error);
  let status = 500;
  let code = 'INTERNAL_ERROR';
  if (stage === 'CONTENT_NOT_FOUND' && !identityResolved) { status = 404; code = 'CONTENT_NOT_FOUND'; }
  else if (error instanceof PostsConfigError || classification?.kind === 'configuration') { status = 503; code = 'SERVICE_UNAVAILABLE'; }
  else if (classification?.kind === 'integrity' || ['CONTENT_NOT_FOUND', 'INVALID_SNAPSHOT_STATE', 'INVALID_HY_SOURCE'].includes(stage ?? '')) { status = 503; code = 'REPOSITORY_INTEGRITY'; }
  else if (classification?.kind === 'upstream') { status = 502; code = 'UPSTREAM_FAILURE'; }
  // Follow the existing fixed-message logging convention; never log error/cause or identity.
  const safeStage = ['REF_LOOKUP_FAILURE', 'COMMIT_LOOKUP_FAILURE', 'SNAPSHOT_FILE_FAILURE'].includes(stage ?? '') ? stage : code;
  console.error('admin workspace: GET failed', code, safeStage);
  return json({ ok: false, code, message: code === 'REPOSITORY_INTEGRITY' ? 'Workspace data is inconsistent.' : 'Workspace could not be loaded.' }, status);
}

export async function onRequestGet(context: Context) {
  const id = contentId(context); if (!id) return json({ ok: false, code: 'INVALID_REQUEST' }, 400);
  let identityResolved = false;
  try {
    const config = getGitHubConfig(context.env);
    const loaded = await loadWorkspaceSnapshot(createGitHubTransactionClient(config), { branch: config.branch, contentId: id });
    identityResolved = true;
    return json({ ok: true, ...workspaceStateFromSnapshot(loaded) });
  } catch (error) { return getErrorResponse(error, identityResolved); }
}

export async function onRequestPost(context: Context) {
  const id = contentId(context); if (!id) return json({ ok: false, code: 'INVALID_REQUEST' }, 400);
  try {
    if (context.request.headers.get('origin') !== new URL(context.request.url).origin) return json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, 403);
    if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    const text = await context.request.text(); if (!text || new TextEncoder().encode(text).byteLength > BODY_LIMIT) return json({ ok: false, code: text ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' }, text ? 413 : 400);
    const body: unknown = JSON.parse(text); if (!object(body) || !object(body.changed)) throw Object.assign(new Error('Invalid workspace request'), { code: 'INVALID_REQUEST' });
    const changed = body.changed;
    const hy = changed.hy === undefined ? null : (() => {
      if (!object(changed.hy) || typeof changed.hy.expectedPostsBlobSha !== 'string' || typeof changed.hy.originalSlug !== 'string') throw Object.assign(new Error('Invalid HY workspace payload'), { code: 'INVALID_REQUEST' });
      return { expectedPostsBlobSha: changed.hy.expectedPostsBlobSha, originalSlug: changed.hy.originalSlug, post: validateEditablePost(changed.hy.post) };
    })();
    const locales: Record<string, unknown> = {};
    for (const locale of ['ru', 'en']) if (changed[locale] !== undefined) locales[locale] = validateLocaleRequest(changed[locale]);
    if (!hy && !locales.ru && !locales.en) return json({ ok: true, code: 'NO_CHANGES', saved: { hy: false, ru: false, en: false } });
    const config = getGitHubConfig(context.env);
    const client = createGitHubTransactionClient(config);
    const localeBranch = resolveAdminWriteBranch(context.env, 'ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH');
    if (hy) { resolveHyAdminWriteMode(context.env); if (resolveAtomicGitHubBranch(context.env) !== localeBranch) throw Object.assign(new Error('Atomic branch mismatch'), { code: 'INVALID_ATOMIC_BRANCH_CONFIRMATION' }); }
    const result = await saveWorkspace(client, { branch: localeBranch, contentId: id, hy, locales });
    return json({ ok: true, code: result.transaction.noOp ? 'NO_CHANGES' : null, saved: result.saved, changed_paths: result.transaction.changedPaths, state: result.state });
  } catch (error) { return errorResponse(error); }
}

export function onRequest() { return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405); }
