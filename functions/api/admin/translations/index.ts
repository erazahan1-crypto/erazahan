import { isContentId, isSourceFingerprint } from '../../../../src/lib/content-schema/schema.mjs';
import { beginLocaleEditWrite, createLocaleDraftWrite, discardLocaleDraftWrite, loadLocaleTranslationEditorState, rebaseLocaleDraftWrite, updateLocaleDraftWrite } from '../../../_lib/admin-locale-draft-write.mjs';
import { createGitHubTransactionClient, getGitHubConfig, PostsConfigError, type GitHubPostsEnv } from '../../../_lib/github-posts.ts';

interface Context { request: Request; env: GitHubPostsEnv & { ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH?: string }; }

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function invalidRequest() { return json({ ok: false, code: 'INVALID_REQUEST' }, 400); }
const BODY_LIMIT = 2_100_000;
const PAYLOAD_KEYS = ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key'];
function plainObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function writerGuard(env: GitHubPostsEnv & { ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH?: string }) {
  const branch = env.ADMIN_GITHUB_BRANCH; const confirmation = env.ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH;
  if (typeof branch !== 'string' || !branch.trim() || typeof confirmation !== 'string' || !confirmation.trim() || branch.trim() !== confirmation.trim()) {
    throw Object.assign(new Error('Locale atomic branch confirmation is invalid'), { code: 'INVALID_ATOMIC_BRANCH_CONFIRMATION' });
  }
  return branch.trim();
}
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

function postInput(body: unknown) {
  if (!plainObject(body) || typeof body.action !== 'string') throw Object.assign(new Error(), { code: 'INVALID_REQUEST' });
  if (!['create_draft', 'update_draft', 'begin_edit', 'rebase', 'discard'].includes(body.action)) throw Object.assign(new Error(), { code: 'INVALID_ACTION' });
  const identity = typeof body.content_id === 'string' && isContentId(body.content_id) && (body.locale === 'ru' || body.locale === 'en');
  if (!identity) throw Object.assign(new Error(), { code: 'INVALID_REQUEST' });
  const payload = body.payload;
  if (body.action === 'create_draft') {
    if (!exactKeys(body, ['action', 'content_id', 'locale', 'expected_locale_absent', 'expected_source_revision', 'expected_source_fingerprint', 'payload'])
      || body.expected_locale_absent !== true || !Number.isInteger(body.expected_source_revision) || body.expected_source_revision < 1
      || !isSourceFingerprint(body.expected_source_fingerprint) || !plainObject(payload) || !exactKeys(payload, PAYLOAD_KEYS)) throw Object.assign(new Error(), { code: 'INVALID_REQUEST' });
    return { action: body.action, contentId: body.content_id, locale: body.locale, payload, expectedLocaleAbsent: true, expectedSourceRevision: body.expected_source_revision, expectedSourceFingerprint: body.expected_source_fingerprint };
  }
  if (!exactKeys(body, body.action === 'update_draft'
    ? ['action', 'content_id', 'locale', 'expected_locale_blob_sha', 'payload']
    : ['action', 'content_id', 'locale', 'expected_locale_blob_sha'])
    || typeof body.expected_locale_blob_sha !== 'string' || !/^[0-9a-f]{40}$/.test(body.expected_locale_blob_sha)
    || (body.action === 'update_draft' && (!plainObject(payload) || !exactKeys(payload, PAYLOAD_KEYS)))) throw Object.assign(new Error(), { code: 'INVALID_REQUEST' });
  return { action: body.action, contentId: body.content_id, locale: body.locale, expectedLocaleBlobSha: body.expected_locale_blob_sha, ...(body.action === 'update_draft' ? { payload } : {}) };
}

function writeError(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  if (code === 'INVALID_ACTION') return json({ ok: false, code }, 400);
  if (code === 'CONTENT_NOT_FOUND') return json({ ok: false, code }, 404);
  if (['LOCALE_UNSUPPORTED', 'DRAFT_INVALID', 'NO_DRAFT', 'SLUG_INVALID', 'INVALID_REQUEST'].includes(code ?? '')) return json({ ok: false, code: code ?? 'INVALID_REQUEST' }, 400);
  if (['SLUG_RESERVED', 'SLUG_CLAIMED', 'SLUG_PERMANENTLY_RESERVED', 'PUBLISHED_SLUG_LOCKED', 'SOURCE_CHANGED', 'STALE_EDITOR', 'STALE_FILE_VERSION', 'BRANCH_REF_CONFLICT'].includes(code ?? '')) return json({ ok: false, code }, 409);
  if (error instanceof PostsConfigError || ['INVALID_ATOMIC_BRANCH_CONFIRMATION', 'SNAPSHOT_FILE_MISSING', 'INVALID_SNAPSHOT_JSON', 'INVALID_SNAPSHOT_STATE', 'INVALID_HY_SOURCE', 'INVALID_SNAPSHOT', 'INVALID_DRAFT_CLAIM_TRANSITION', 'LOCALE_BLOB_SHA_MISSING'].includes(code ?? '')) return json({ ok: false, code: code ?? 'SERVICE_UNAVAILABLE' }, 503);
  if (['REF_LOOKUP_FAILURE', 'COMMIT_LOOKUP_FAILURE', 'SNAPSHOT_FILE_FAILURE', 'BLOB_CREATION_FAILURE', 'TREE_CREATION_FAILURE', 'COMMIT_CREATION_FAILURE', 'BRANCH_REF_UPDATE_FAILURE'].includes(code ?? '')) return json({ ok: false, code: 'UPSTREAM_FAILURE' }, 502);
  return json({ ok: false, code: 'INTERNAL_ERROR' }, 500);
}

export async function onRequestPost(context: Context): Promise<Response> {
  try {
    if (context.request.headers.get('origin') !== new URL(context.request.url).origin) return json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, 403);
    if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    const declared = Number(context.request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > BODY_LIMIT) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const text = await context.request.text();
    if (!text || new TextEncoder().encode(text).byteLength > BODY_LIMIT) return json({ ok: false, code: text ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' }, text ? 413 : 400);
    let body: unknown; try { body = JSON.parse(text); } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400); }
    const input = postInput(body);
    const branch = writerGuard(context.env);
    const config = getGitHubConfig(context.env); const client = createGitHubTransactionClient(config);
    let result;
    if (input.action === 'create_draft') result = await createLocaleDraftWrite(client, { ...input, branch });
    else if (input.action === 'update_draft') result = await updateLocaleDraftWrite(client, { ...input, branch });
    else if (input.action === 'begin_edit') result = await beginLocaleEditWrite(client, { ...input, branch });
    else if (input.action === 'rebase') result = await rebaseLocaleDraftWrite(client, { ...input, branch });
    else if (input.action === 'discard') result = await discardLocaleDraftWrite(client, { ...input, branch });
    else throw Object.assign(new Error(), { code: 'INVALID_ACTION' });
    return json({ ok: true, changed: result.changed, ...(result.code ? { code: result.code } : {}), content_id: input.contentId, locale: input.locale, locale_document: result.localeDocument, locale_blob_sha: result.localeBlobSha });
  } catch (error) { return writeError(error); }
}

export function onRequest(): Response {
  return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' });
}
