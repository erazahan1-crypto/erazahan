import { isContentId, isSourceFingerprint } from '../../../../src/lib/content-schema/schema.mjs';
import { AdminLocaleBatchPublishError, loadLocaleBatchEditorState, prepareLocaleBatchPublish, publishLocaleBatch } from '../../../_lib/admin-locale-batch-publish.mjs';
import { createGitHubTransactionClient, getGitHubConfig, PostsConfigError, type GitHubPostsEnv } from '../../../_lib/github-posts.ts';
import { resolveAdminWriteBranch } from '../../../_lib/admin-write-environment-guard.mjs';

interface Context {
  request: Request;
  env: GitHubPostsEnv & { ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH?: string; ERAZAHAN_ADMIN_DEPLOYMENT_CLASS?: string };
}

const BODY_LIMIT = 2_100_000;
const PAYLOAD_KEYS = ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key'];
const SHA_RE = /^[0-9a-f]{40}$/;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function invalid() { throw new AdminLocaleBatchPublishError('INVALID_REQUEST', 'Invalid request'); }
function writerGuard(env: Context['env']) { return resolveAdminWriteBranch(env, 'ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH'); }

function payload(value: unknown) {
  if (!plainObject(value) || !exactKeys(value, PAYLOAD_KEYS)) invalid();
  return value;
}
function selection(value: unknown) {
  if (!plainObject(value) || (value.locale !== 'ru' && value.locale !== 'en') || typeof value.mode !== 'string'
    || typeof value.replace_published !== 'boolean' || typeof value.allow_outdated_source !== 'boolean') invalid();
  const common = { locale: value.locale, replacePublished: value.replace_published, allowOutdatedSource: value.allow_outdated_source };
  if (value.mode === 'import') {
    const existing = typeof value.expected_locale_blob_sha === 'string' && SHA_RE.test(value.expected_locale_blob_sha);
    const absent = value.expected_locale_absent === true;
    const expectedKeys = existing
      ? ['locale', 'mode', 'payload', 'expected_locale_blob_sha', 'replace_published', 'allow_outdated_source']
      : ['locale', 'mode', 'payload', 'expected_locale_absent', 'replace_published', 'allow_outdated_source'];
    if (!exactKeys(value, expectedKeys) || !(existing || absent)) invalid();
    return { ...common, mode: 'import', payload: payload(value.payload), ...(existing ? { expectedLocaleBlobSha: value.expected_locale_blob_sha } : { expectedLocaleAbsent: true }) };
  }
  if (value.mode === 'saved_draft') {
    if (!exactKeys(value, ['locale', 'mode', 'expected_locale_blob_sha', 'replace_published', 'allow_outdated_source'])
      || typeof value.expected_locale_blob_sha !== 'string' || !SHA_RE.test(value.expected_locale_blob_sha)) invalid();
    return { ...common, mode: 'saved_draft', expectedLocaleBlobSha: value.expected_locale_blob_sha };
  }
  invalid();
}
function requestBody(value: unknown) {
  if (!plainObject(value) || !exactKeys(value, ['action', 'content_id', 'expected_source_revision', 'expected_source_fingerprint', 'selections'])
    || (value.action !== 'preview_batch' && value.action !== 'publish_batch')
    || typeof value.content_id !== 'string' || !isContentId(value.content_id)
    || !Number.isInteger(value.expected_source_revision) || value.expected_source_revision < 1
    || typeof value.expected_source_fingerprint !== 'string' || !isSourceFingerprint(value.expected_source_fingerprint)
    || !Array.isArray(value.selections) || value.selections.length < 1 || value.selections.length > 2) invalid();
  const selections = value.selections.map(selection);
  if (new Set(selections.map((entry) => entry.locale)).size !== selections.length) invalid();
  return {
    action: value.action,
    contentId: value.content_id,
    expectedSourceRevision: value.expected_source_revision,
    expectedSourceFingerprint: value.expected_source_fingerprint,
    selections,
  };
}
function errorResponse(error: unknown) {
  const code = error && typeof error === 'object' ? (error as { code?: string }).code : undefined;
  const locale = error && typeof error === 'object' && ((error as { locale?: unknown }).locale === 'ru' || (error as { locale?: unknown }).locale === 'en')
    ? (error as { locale: 'ru' | 'en' }).locale
    : undefined;
  if (error instanceof AdminLocaleBatchPublishError) {
    if (['CONTENT_NOT_FOUND'].includes(code ?? '')) return json({ ok: false, code }, 404);
    if (['INVALID_REQUEST', 'LOCALE_UNSUPPORTED', 'DRAFT_INVALID', 'PUBLISH_INVALID', 'NO_DRAFT', 'SLUG_INVALID', 'PUBLISHED_REPLACEMENT_CONFIRMATION_REQUIRED'].includes(code ?? '')) return json({ ok: false, code, ...(locale ? { locale } : {}) }, 400);
    if (['SLUG_RESERVED', 'SLUG_CLAIMED', 'SLUG_PERMANENTLY_RESERVED', 'PUBLISHED_SLUG_LOCKED', 'SOURCE_CHANGED', 'SOURCE_OUTDATED', 'STALE_EDITOR', 'STALE_FILE_VERSION', 'BRANCH_REF_CONFLICT'].includes(code ?? '')) return json({ ok: false, code, ...(locale ? { locale } : {}) }, 409);
  }
  if (error instanceof PostsConfigError || ['INVALID_ATOMIC_BRANCH_CONFIRMATION', 'INVALID_WRITE_ENVIRONMENT', 'SNAPSHOT_FILE_MISSING', 'INVALID_SNAPSHOT_JSON', 'INVALID_SNAPSHOT_STATE', 'INVALID_HY_SOURCE', 'INVALID_SNAPSHOT'].includes(code ?? '')) return json({ ok: false, code: code ?? 'SERVICE_UNAVAILABLE' }, 503);
  if (['REF_LOOKUP_FAILURE', 'COMMIT_LOOKUP_FAILURE', 'SNAPSHOT_FILE_FAILURE', 'BLOB_CREATION_FAILURE', 'TREE_CREATION_FAILURE', 'COMMIT_CREATION_FAILURE', 'BRANCH_REF_UPDATE_FAILURE'].includes(code ?? '')) return json({ ok: false, code: 'UPSTREAM_FAILURE' }, 502);
  return json({ ok: false, code: code ?? 'INTERNAL_ERROR' }, 500);
}

export async function onRequestGet(context: Context): Promise<Response> {
  const url = new URL(context.request.url);
  const contentIds = url.searchParams.getAll('content_id');
  if (contentIds.length !== 1 || !isContentId(contentIds[0])) return json({ ok: false, code: 'INVALID_REQUEST' }, 400);
  try {
    const config = getGitHubConfig(context.env);
    const branch = writerGuard(context.env);
    const state = await loadLocaleBatchEditorState(createGitHubTransactionClient(config), { branch, contentId: contentIds[0] });
    return json({ ok: true, ...state });
  } catch (error) { return errorResponse(error); }
}

export async function onRequestPost(context: Context): Promise<Response> {
  try {
    if (context.request.headers.get('origin') !== new URL(context.request.url).origin) return json({ ok: false, code: 'FORBIDDEN_ORIGIN' }, 403);
    if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
    const length = Number(context.request.headers.get('content-length'));
    if (Number.isFinite(length) && length > BODY_LIMIT) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const text = await context.request.text();
    if (!text || new TextEncoder().encode(text).byteLength > BODY_LIMIT) return json({ ok: false, code: text ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON' }, text ? 413 : 400);
    let parsed: unknown; try { parsed = JSON.parse(text); } catch { return json({ ok: false, code: 'INVALID_JSON' }, 400); }
    const input = requestBody(parsed);
    const branch = writerGuard(context.env);
    const config = getGitHubConfig(context.env);
    const client = createGitHubTransactionClient(config);
    const base = { branch, ...input };
    if (input.action === 'preview_batch') {
      const preview = await prepareLocaleBatchPublish(client, base);
      return json({ ok: true, content_id: input.contentId, source: { revision: preview.loaded.item.source_revision, fingerprint: preview.loaded.item.source_fingerprint }, locales: preview.summary });
    }
    const result = await publishLocaleBatch(client, base);
    return json({ ok: true, changed: result.changed, ...(result.code ? { code: result.code } : {}), content_id: input.contentId, locales: result.summary, commit_sha: result.transaction.commitSha });
  } catch (error) { return errorResponse(error); }
}

export function onRequest(): Response { return json({ ok: false, code: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'GET, POST' }); }
