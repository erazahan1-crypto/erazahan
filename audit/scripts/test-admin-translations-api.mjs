import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { onRequest, onRequestGet, onRequestPost } from '../../functions/api/admin/translations/index.ts';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const BASE = `src/data/content/dreams/${A.slice(0, 2)}/${A}`;
const FP = 'a'.repeat(64);
const env = { GITHUB_TOKEN: 'test-token', ADMIN_GITHUB_REPO: 'test-owner/test-repo', ADMIN_GITHUB_BRANCH: 'main' };
const payload = (slug, title, provenance) => ({ slug, title, description: null, content: `<p>${title}</p>`, image_alts: {}, tags: [], alphabet_key: null, ...provenance });
const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: FP, fingerprint_spec_version: 1 };
const hy = { schema_version: 1, content_id: A, locale: 'hy', draft: null, published: { ...payload('hy-source', 'HY source', { based_on_source_revision: null, based_on_source_fingerprint: null }), version: 1, published_at: '2026-09-15' } };
const registryPaths = ['src/data/content/locale-draft-slug-claims.v1.json', 'src/data/content/locale-slug-reservations.v1.json'];
const localized = (slug = 'crow', title = 'Crow') => ({ ...payload(slug, title), based_on_source_revision: 1, based_on_source_fingerprint: FP });
const localeDocument = ({ draft = null, published = null } = {}) => ({ schema_version: 1, content_id: A, locale: 'en', draft, published });
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function base64(value) { return btoa(unescape(encodeURIComponent(value))); }
function installFetch({ missing = false, malformed = false, transportFailure = false, allowWrites = false, locale = null, currentItem = item, claims = { version: 1, claims: [] }, reservations = { version: 1, reservations: [] }, branchConflict = false } = {}) {
  const original = globalThis.fetch; const calls = []; const trees = [];
  const files = new Map([
    [`${BASE}/item.json`, canonicalJson(currentItem)], [`${BASE}/hy.json`, canonicalJson(hy)],
    [`${BASE}/ru.json`, null], [`${BASE}/en.json`, locale === null ? null : canonicalJson(locale)],
    [registryPaths[0], malformed ? '{bad' : canonicalJson(claims)],
    [registryPaths[1], canonicalJson(reservations)],
  ]);
  const blobs = new Map(); let index = 0;
  for (const [path, content] of files) if (content !== null) blobs.set((++index).toString(16).padStart(40, 'b'), { path, content });
  const tree = (prefix) => [...blobs].filter(([, value]) => value.path.startsWith(prefix)).map(([sha, value]) => {
    const rest = value.path.slice(prefix.length); const part = rest.split('/')[0];
    if (rest.includes('/')) return { path: part, type: 'tree', sha: `tree-${prefix}${part}/` };
    return { path: part, type: 'blob', sha };
  }).filter((entry, i, entries) => entries.findIndex((other) => other.path === entry.path) === i);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input); const path = url.pathname; calls.push({ path, method: init.method ?? 'GET' });
    if (init.method && init.method !== 'GET') {
      if (!allowWrites) throw new Error('write API called');
      if (path.endsWith('/git/blobs')) return json({ sha: `${(calls.filter((call) => call.path.endsWith('/git/blobs')).length).toString(16).padStart(40, 'a')}` });
      if (path.endsWith('/git/trees')) { trees.push(JSON.parse(init.body)); return json({ sha: 'tree-next' }); }
      if (path.endsWith('/git/commits')) return json({ sha: 'commit-next' });
      if (path.endsWith('/git/refs/heads/main')) return branchConflict ? json({ message: 'advanced' }, 422) : json({ object: { sha: 'commit-next' } });
    }
    if (path.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'commit-sha' } });
    if (path.endsWith('/git/commits/commit-sha')) return json({ tree: { sha: 'tree-' } });
    if (path.includes('/git/trees/')) {
      if (transportFailure) return new Response('private upstream detail', { status: 500 });
      const sha = decodeURIComponent(path.split('/git/trees/')[1]); const prefix = sha.slice('tree-'.length);
      return json({ tree: missing && prefix === `${BASE}/` ? [] : tree(prefix) });
    }
    if (path.includes('/git/blobs/')) {
      const blob = blobs.get(path.split('/git/blobs/')[1]); if (!blob) throw new Error(`missing blob ${path}`);
      return json({ sha: path.split('/').pop(), encoding: 'base64', content: base64(blob.content) });
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  return { calls, trees, restore: () => { globalThis.fetch = original; } };
}
async function response(url, options = {}) { return onRequestGet({ request: new Request(url, options), env: options.env ?? env }); }
async function post(body, options = {}) { return onRequestPost({ request: new Request('https://site.test/api/admin/translations', { method: 'POST', headers: { origin: 'https://site.test', 'content-type': 'application/json', ...(options.headers ?? {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env: options.env ?? env }); }
async function directPost({ body, headers = {}, requestEnv = env } = {}) { return onRequestPost({ request: new Request('https://site.test/api/admin/translations', { method: 'POST', headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }), env: requestEnv }); }
async function expectInvalid(url) { const mock = installFetch(); try { const res = await response(url); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }

for (const locale of ['ru', 'en']) { const mock = installFetch(); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=${locale}`); const body = await res.json(); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(body.ok, true); for (const key of ['content_id', 'locale', 'source', 'locale_document', 'locale_blob_sha', 'translation_state', 'slug_locked', 'alphabet_suggestion']) assert.ok(Object.hasOwn(body, key)); assert.equal(body.source.revision, 1); assert.equal(body.source.fingerprint, FP); assert.equal(body.locale_blob_sha, null); for (const forbidden of ['draftClaims', 'reservations', 'snapshot', 'treeSha', 'commitSha', 'refSha', 'token', 'config']) assert.equal(JSON.stringify(body).includes(forbidden), false); assert.equal(mock.calls.some((call) => call.method !== 'GET'), false); } finally { mock.restore(); } }
for (const suffix of ['', `?locale=ru`, `?content_id=${A}`, '?content_id=&locale=ru', `?content_id=${A}&locale=`, `?content_id=${A}&locale=hy`, `?content_id=${A}&locale=de`, '?content_id=bad&locale=ru', `?content_id=${A}&content_id=${A}&locale=ru`, `?content_id=${A}&locale=ru&locale=en`]) await expectInvalid(`https://site.test/api/admin/translations${suffix}`);
{ const mock = installFetch({ missing: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); assert.equal(res.status, 404); assert.equal((await res.json()).code, 'CONTENT_NOT_FOUND'); } finally { mock.restore(); } }
{ const mock = installFetch({ malformed: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); assert.equal(res.status, 503); assert.equal((await res.json()).code, 'SERVICE_UNAVAILABLE'); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); } finally { mock.restore(); } }
{ const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`, { env: {} }); assert.equal(res.status, 503); }
const postEnv = { ...env, ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH: 'main' };
const createBody = (overrides = {}) => ({ action: 'create_draft', content_id: A, locale: 'en', expected_locale_absent: true, expected_source_revision: 1, expected_source_fingerprint: FP, payload: payload('crow', 'Crow', { }), ...overrides });
{ const mock = installFetch({ allowWrites: true }); try { const res = await post(createBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.changed, true); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); assert.equal(JSON.stringify(body).includes('blobShas'), false); assert.equal(mock.calls.some((call) => call.method === 'POST'), true); } finally { mock.restore(); } }
for (const [headers, expected] of [[{ origin: 'https://evil.test' }, 403], [{ origin: '' }, 403], [{ 'content-type': 'text/plain' }, 415]]) { const mock = installFetch(); try { const res = await post(createBody(), { env: postEnv, headers }); assert.equal(res.status, expected); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const bad of [{ action: '' }, { ...createBody(), extra: true }, { ...createBody(), payload: null }, { ...createBody(), expected_source_revision: '1' }, { ...createBody(), expected_source_fingerprint: 'bad' }, { ...createBody(), locale: 'hy' }]) { const mock = installFetch(); try { const res = await post(bad, { env: postEnv }); assert.equal(res.status, 400); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const guardedEnv of [{ ...env }, { ...env, ADMIN_GITHUB_BRANCH: '' }, { ...env, ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH: '' }, { ...env, ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH: 'other' }]) { const mock = installFetch(); try { const res = await post(createBody(), { env: guardedEnv }); assert.equal(res.status, 503); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
{ const res = await post('{bad', { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_JSON'); }
{ const declared = await post(createBody(), { env: postEnv, headers: { 'content-length': '2100001' } }); assert.equal(declared.status, 413); const unicode = await post(`{"x":"${'я'.repeat(1_050_000)}"}`, { env: postEnv }); assert.equal(unicode.status, 413); }
{ const oversized = `{\"x\":\"${'я'.repeat(1_050_000)}\"}`; const res = await onRequestPost({ request: { url: 'https://site.test/api/admin/translations', headers: new Headers({ origin: 'https://site.test', 'content-type': 'application/json', 'content-length': '1' }), text: async () => oversized }, env: postEnv }); assert.equal(res.status, 413); }
{ const mock = installFetch(); try { const res = await onRequestPost({ request: { url: 'https://site.test/api/admin/translations', headers: new Headers({ origin: 'https://site.test' }), text: async () => JSON.stringify(createBody()) }, env: postEnv }); assert.equal(res.status, 415); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
{ const mock = installFetch({ allowWrites: true }); try { const res = await post(createBody(), { env: postEnv, headers: { 'content-type': 'application/json; charset=utf-8' } }); assert.equal(res.status, 200); } finally { mock.restore(); } }
for (const bad of [[], null, { action: 'unpublish' }, { ...createBody(), payload: [] }, { ...createBody(), content_id: 'bad' }]) { const mock = installFetch(); try { const res = await post(bad, { env: postEnv }); assert.equal(res.status, 400); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const key of ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key']) { const body = createBody(); delete body.payload[key]; const res = await post(body, { env: postEnv }); assert.equal(res.status, 400); }
{ const body = createBody(); body.payload.extra = true; const res = await post(body, { env: postEnv }); assert.equal(res.status, 400); }
const localeSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb3';
const existingDraft = localeDocument({ draft: localized() });
const updateBody = (overrides = {}) => ({ action: 'update_draft', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, payload: payload('crow', 'Edited'), ...overrides });
const rebaseBody = (overrides = {}) => ({ action: 'rebase', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, ...overrides });
const discardBody = (overrides = {}) => ({ action: 'discard', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, ...overrides });
const publishBody = (overrides = {}) => ({ action: 'publish', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, ...overrides });
{ const mock = installFetch({ allowWrites: true, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(updateBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.changed, true); assert.equal(body.locale_document.draft.title, 'Edited'); assert.equal(body.locale_document.published, null); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); assert.notEqual(body.locale_blob_sha, localeSha); } finally { mock.restore(); } }
{ const mock = installFetch({ allowWrites: true, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(updateBody({ payload: payload('crow', 'Crow') }), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.changed, false); assert.equal(body.code, 'NO_CHANGES'); assert.equal(body.locale_blob_sha, localeSha); assert.equal(mock.calls.some((call) => call.method !== 'GET'), false); } finally { mock.restore(); } }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const mock = installFetch({ allowWrites: true, locale: localeDocument({ published }) }); try { const res = await post({ action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha }, { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.changed, true); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); } finally { mock.restore(); } }
{ const currentItem = { ...item, source_revision: 2, source_fingerprint: 'c'.repeat(64) }; const mock = installFetch({ allowWrites: true, currentItem, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(rebaseBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, true); assert.equal(body.locale_document.draft.content, existingDraft.draft.content); assert.equal(body.locale_document.draft.slug, 'crow'); assert.equal(body.locale_document.draft.based_on_source_revision, 2); assert.equal(body.locale_document.draft.based_on_source_fingerprint, 'c'.repeat(64)); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); } finally { mock.restore(); } }
{ const mock = installFetch({ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(rebaseBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, false); assert.equal(body.code, 'NO_CHANGES'); assert.deepEqual(body.locale_document, existingDraft); assert.equal(body.locale_blob_sha, localeSha); assert.equal(mock.calls.some((call) => call.method !== 'GET'), false); } finally { mock.restore(); } }
{ const mock = installFetch({ allowWrites: true, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(discardBody(), { env: postEnv }); const body = await res.json(); const firstWrite = mock.calls.findIndex((call) => call.method !== 'GET'); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, true); assert.equal(body.content_id, A); assert.equal(body.locale, 'en'); assert.equal(body.locale_document, null); assert.equal(body.locale_blob_sha, null); assert.deepEqual(mock.trees[0].tree.find((entry) => entry.path === `${BASE}/en.json`), { path: `${BASE}/en.json`, mode: '100644', type: 'blob', sha: null }); assert.equal(mock.calls.slice(firstWrite + 1).some((call) => call.method === 'GET'), false); } finally { mock.restore(); } }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const document = localeDocument({ draft: localized(), published }); const mock = installFetch({ allowWrites: true, locale: document, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(discardBody(), { env: postEnv }); const body = await res.json(); const firstWrite = mock.calls.findIndex((call) => call.method !== 'GET'); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, true); assert.equal(body.locale_document.draft, null); assert.deepEqual(body.locale_document.published, published); assert.equal(body.locale_blob_sha, `${'a'.repeat(39)}1`); assert.equal(mock.calls.slice(firstWrite + 1).some((call) => call.method === 'GET'), false); } finally { mock.restore(); } }
for (const bad of [
  () => { const value = discardBody(); delete value.expected_locale_blob_sha; return value; },
  () => discardBody({ expected_locale_blob_sha: 'bad' }),
  () => discardBody({ expected_locale_blob_sha: 'A'.repeat(40) }),
  () => discardBody({ expected_locale_blob_sha: null }),
  () => discardBody({ expected_locale_blob_sha: 1 }),
  () => discardBody({ content_id: 1 }),
  () => discardBody({ locale: [] }),
  () => discardBody({ payload: {} }),
  () => discardBody({ expected_source_revision: 1 }),
  () => discardBody({ expected_source_fingerprint: FP }),
  () => discardBody({ expected_locale_absent: true }),
  () => discardBody({ slug: 'crow' }),
  () => discardBody({ extra: true }),
]) { const mock = installFetch(); try { const res = await post(bad(), { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const [fixture, code, status] of [
  [{ locale: localeDocument({ published: { ...localized(), version: 1, published_at: '2026-09-15' } }) }, 'NO_DRAFT', 400],
  [{ locale: existingDraft }, 'DRAFT_INVALID', 400],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242' }] } }, 'SLUG_CLAIMED', 409],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }, 'STALE_EDITOR', 409],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] }, branchConflict: true, allowWrites: true }, 'BRANCH_REF_CONFLICT', 409],
]) { const mock = installFetch(fixture); try { const input = code === 'STALE_EDITOR' ? discardBody({ expected_locale_blob_sha: 'a'.repeat(40) }) : discardBody(); const res = await post(input, { env: postEnv }); assert.equal(res.status, status); assert.equal((await res.json()).code, code); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await post(discardBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); } finally { mock.restore(); } }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const document = localeDocument({ draft: localized(), published }); const mock = installFetch({ allowWrites: true, locale: document, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const originalGet = Map.prototype.get; Map.prototype.get = function (key) { return key.endsWith('/en.json') && this.size === 1 && this.has(key) ? undefined : originalGet.call(this, key); }; try { const res = await post(discardBody(), { env: postEnv }); assert.equal(res.status, 503); assert.equal((await res.json()).code, 'LOCALE_BLOB_SHA_MISSING'); } finally { Map.prototype.get = originalGet; mock.restore(); } }
{ const mock = installFetch({ allowWrites: true, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(publishBody(), { env: postEnv }); const body = await res.json(); const firstWrite = mock.calls.findIndex((call) => call.method !== 'GET'); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, true); assert.equal(body.content_id, A); assert.equal(body.locale, 'en'); assert.equal(body.locale_document.draft, null); assert.equal(body.locale_document.published.version, 1); assert.equal(body.locale_document.published.slug, 'crow'); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); assert.equal(JSON.stringify(body).includes('transaction'), false); assert.equal(mock.calls.some((call) => call.method === 'POST'), true); assert.equal(mock.calls.slice(firstWrite + 1).some((call) => call.method === 'GET'), false); } finally { mock.restore(); } }
{ const published = { ...localized('crow', 'Old'), version: 1, published_at: '2026-09-15' }; const document = localeDocument({ draft: localized('crow', 'New'), published }); const mock = installFetch({ allowWrites: true, locale: document, reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: A, kind: 'active' }] } }); try { const res = await post(publishBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.changed, true); assert.equal(body.locale_document.draft, null); assert.equal(body.locale_document.published.version, 2); assert.equal(body.locale_document.published.title, 'New'); assert.match(body.locale_blob_sha, /^[0-9a-f]{40}$/); } finally { mock.restore(); } }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const document = localeDocument({ draft: localized(), published }); const mock = installFetch({ locale: document, reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: A, kind: 'active' }] } }); try { const res = await post(publishBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.ok, true); assert.equal(body.changed, false); assert.equal(body.code, 'NO_CHANGES'); assert.deepEqual(body.locale_document, document); assert.equal(body.locale_blob_sha, localeSha); assert.equal(mock.calls.some((call) => call.method !== 'GET'), false); } finally { mock.restore(); } }
for (const bad of [
  () => { const value = publishBody(); delete value.expected_locale_blob_sha; return value; },
  () => publishBody({ expected_locale_blob_sha: 'bad' }), () => publishBody({ expected_locale_blob_sha: 'A'.repeat(40) }), () => publishBody({ expected_locale_blob_sha: null }), () => publishBody({ expected_locale_blob_sha: 1 }),
  () => publishBody({ content_id: 1 }), () => publishBody({ locale: [] }), () => publishBody({ payload: {} }), () => publishBody({ slug: 'crow' }), () => publishBody({ version: 1 }), () => publishBody({ published_at: '2026-09-16' }), () => publishBody({ published: {} }), () => publishBody({ draft: {} }), () => publishBody({ alphabet_key: 'C' }), () => publishBody({ source_revision: 1 }), () => publishBody({ source_fingerprint: FP }), () => publishBody({ expected_source_revision: 1 }), () => publishBody({ expected_source_fingerprint: FP }), () => publishBody({ expected_locale_absent: true }), () => publishBody({ registry_sha: 'a'.repeat(40) }), () => publishBody({ branch: 'main' }), () => publishBody({ extra: true }),
]) { const mock = installFetch(); try { const res = await post(bad(), { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const [fixture, input, code, status] of [
  [{ currentItem: { ...item, source_revision: 2, source_fingerprint: 'c'.repeat(64) }, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }, publishBody(), 'SOURCE_OUTDATED', 409],
  [{ locale: localeDocument({ draft: localized('new-slug') }), claims: { version: 1, claims: [{ locale: 'en', slug: 'new-slug', content_id: A }] }, reservations: { version: 1, reservations: [{ locale: 'en', slug: 'old-slug', content_id: A, kind: 'active' }] } }, publishBody(), 'PUBLISH_INVALID', 400],
  [{ locale: localeDocument({ published: { ...localized(), version: 1, published_at: '2026-09-15' } }) }, publishBody(), 'NO_DRAFT', 400],
  [{ locale: existingDraft }, publishBody(), 'DRAFT_INVALID', 400],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }, publishBody({ expected_locale_blob_sha: 'a'.repeat(40) }), 'STALE_EDITOR', 409],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242' }] } }, publishBody(), 'SLUG_CLAIMED', 409],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] }, reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242', kind: 'active' }] } }, publishBody(), 'SLUG_PERMANENTLY_RESERVED', 409],
  [{ locale: localeDocument({ draft: localized('raven'), published: { ...localized(), version: 1, published_at: '2026-09-15' } }), reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: A, kind: 'active' }] } }, publishBody(), 'PUBLISHED_SLUG_LOCKED', 409],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] }, branchConflict: true, allowWrites: true }, publishBody(), 'BRANCH_REF_CONFLICT', 409],
]) { const mock = installFetch(fixture); try { const res = await post(input, { env: postEnv }); const body = await res.json(); assert.equal(res.status, status); assert.equal(body.code, code); assert.equal(JSON.stringify(body).includes('test-token'), false); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await post(publishBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); } finally { mock.restore(); } }
{ const published = { ...localized('crow', 'Old'), version: 1, published_at: '2026-09-15' }; const document = localeDocument({ draft: localized('crow', 'New'), published }); const mock = installFetch({ allowWrites: true, locale: document, reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: A, kind: 'active' }] } }); const originalGet = Map.prototype.get; Map.prototype.get = function (key) { return key.endsWith('/en.json') && this.size === 1 && this.has(key) ? undefined : originalGet.call(this, key); }; try { const res = await post(publishBody(), { env: postEnv }); assert.equal(res.status, 503); assert.equal((await res.json()).code, 'LOCALE_BLOB_SHA_MISSING'); } finally { Map.prototype.get = originalGet; mock.restore(); } }
for (const bad of [
  () => { const value = rebaseBody(); delete value.expected_locale_blob_sha; return value; },
  () => rebaseBody({ expected_locale_blob_sha: 'bad' }),
  () => rebaseBody({ expected_locale_blob_sha: 'A'.repeat(40) }),
  () => rebaseBody({ expected_locale_blob_sha: 1 }),
  () => rebaseBody({ content_id: 1 }),
  () => rebaseBody({ locale: [] }),
  () => rebaseBody({ payload: {} }),
  () => rebaseBody({ expected_source_revision: 1 }),
  () => rebaseBody({ expected_source_fingerprint: FP }),
  () => rebaseBody({ expected_locale_absent: true }),
  () => rebaseBody({ extra: true }),
]) { const mock = installFetch(); try { const res = await post(bad(), { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const [fixture, code, status] of [
  [{ locale: localeDocument({ published: { ...localized(), version: 1, published_at: '2026-09-15' } }) }, 'NO_DRAFT', 400],
  [{ locale: existingDraft }, 'DRAFT_INVALID', 400],
  [{ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242' }] } }, 'SLUG_CLAIMED', 409],
]) { const mock = installFetch(fixture); try { const res = await post(rebaseBody(), { env: postEnv }); assert.equal(res.status, status); assert.equal((await res.json()).code, code); } finally { mock.restore(); } }
{ const mock = installFetch({ locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const res = await post(rebaseBody({ expected_locale_blob_sha: 'a'.repeat(40) }), { env: postEnv }); assert.equal(res.status, 409); assert.equal((await res.json()).code, 'STALE_EDITOR'); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await post(rebaseBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); } finally { mock.restore(); } }
{ const currentItem = { ...item, source_revision: 2, source_fingerprint: 'c'.repeat(64) }; const mock = installFetch({ allowWrites: true, currentItem, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const originalGet = Map.prototype.get; Map.prototype.get = function (key) { return key.endsWith('/en.json') && this.size === 1 && this.has(key) ? undefined : originalGet.call(this, key); }; try { const res = await post(rebaseBody(), { env: postEnv }); assert.equal(res.status, 503); assert.equal((await res.json()).code, 'LOCALE_BLOB_SHA_MISSING'); } finally { Map.prototype.get = originalGet; mock.restore(); } }
for (const [fixture, body, code] of [
  [{}, createBody({ expected_source_revision: 2 }), 'SOURCE_CHANGED'],
  [{ locale: existingDraft }, createBody(), 'STALE_EDITOR'],
  [{ locale: existingDraft }, updateBody({ expected_locale_blob_sha: 'a'.repeat(40) }), 'STALE_EDITOR'],
  [{ branchConflict: true, allowWrites: true }, createBody(), 'BRANCH_REF_CONFLICT'],
  [{ claims: { version: 2, claims: [] } }, createBody(), 'INVALID_SNAPSHOT_STATE'],
]) { const mock = installFetch(fixture); try { const res = await post(body, { env: postEnv }); assert.equal((await res.json()).code, code); assert.equal(res.status, code === 'INVALID_SNAPSHOT_STATE' ? 503 : 409); } finally { mock.restore(); } }
{ const mock = installFetch(); try { const res = await directPost({ body: createBody(), headers: { 'content-type': 'application/json' }, requestEnv: postEnv }); assert.equal(res.status, 403); assert.equal((await res.json()).code, 'FORBIDDEN_ORIGIN'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const contentType of ['multipart/form-data; boundary=test', 'application/x-www-form-urlencoded']) { const mock = installFetch(); try { const res = await directPost({ body: createBody(), headers: { origin: 'https://site.test', 'content-type': contentType }, requestEnv: postEnv }); assert.equal(res.status, 415); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
{ const mock = installFetch(); try { const res = await directPost({ headers: { origin: 'https://site.test', 'content-type': 'application/json' }, requestEnv: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_JSON'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const bad of [{ action: 'something_else' }, { action: 'unpublish' }, { ...updateBody(), expected_locale_blob_sha: 'A'.repeat(40) }, { ...updateBody(), expected_locale_blob_sha: 1 }, { action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: 'bad' }, { action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: 1 }, { ...createBody(), content_id: 1 }, { ...createBody(), locale: 1 }, { ...createBody(), expected_locale_absent: 'true' }]) { const mock = installFetch(); try { const res = await post(bad, { env: postEnv }); assert.equal(res.status, 400); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const action of ['something_else', 'unpublish']) { const mock = installFetch(); try { const res = await post({ action }, { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_ACTION'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const make of [
  () => ({ ...updateBody(), extra: true }),
  () => { const value = updateBody(); delete value.expected_locale_blob_sha; return value; },
  () => { const value = updateBody(); delete value.payload; return value; },
  () => ({ ...updateBody(), expected_source_revision: 1 }),
  () => ({ ...updateBody(), expected_locale_absent: true }),
  () => ({ action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, extra: true }),
  () => ({ action: 'begin_edit', content_id: A, locale: 'en' }),
  () => ({ action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, payload: {} }),
  () => ({ action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, expected_source_revision: 1 }),
  () => ({ action: 'begin_edit', content_id: A, locale: 'en', expected_locale_blob_sha: localeSha, expected_locale_absent: true }),
]) { const mock = installFetch(); try { const res = await post(make(), { env: postEnv }); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
for (const key of ['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key']) { const value = updateBody(); delete value.payload[key]; const mock = installFetch(); try { const res = await post(value, { env: postEnv }); assert.equal(res.status, 400); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
{ const mock = installFetch(); try { const value = updateBody(); value.payload.extra = true; const res = await post(value, { env: postEnv }); assert.equal(res.status, 400); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }
{ const mock = installFetch({ allowWrites: true, locale: existingDraft, claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); try { const value = updateBody({ payload: payload('crow', 'Edited', { description: null, alphabet_key: null }) }); const res = await post(value, { env: postEnv }); assert.equal(res.status, 200); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await post(createBody(), { env: postEnv }); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); assert.equal(JSON.stringify(body).includes('test-token'), false); } finally { mock.restore(); } }
for (const method of ['PUT', 'PATCH', 'DELETE']) { const res = onRequest({ request: new Request('https://site.test/api/admin/translations', { method }), env }); assert.equal(res.status, 405); assert.equal(res.headers.get('allow'), 'GET, POST'); assert.equal(res.headers.get('cache-control'), 'no-store'); }
const source = readFileSync('functions/api/admin/translations/index.ts', 'utf8');
assert.equal(source.includes('rebaseLocaleDraftWrite'), true);
assert.equal(source.includes('discardLocaleDraftWrite'), true);
assert.equal(source.includes('publishLocaleDraftWrite'), true);
assert.equal(/\bpublishLocaleDraft\b/.test(source), false);
assert.equal(source.includes('commitMultiFileTransaction'), false);
assert.equal(source.includes("else if (input.action === 'begin_edit')"), true);
assert.equal(source.includes("else if (input.action === 'rebase')"), true);
assert.equal(source.includes("else if (input.action === 'discard')"), true);
assert.equal(source.includes("else if (input.action === 'publish')"), true);
assert.equal(source.includes('publishLocaleDraftWrite(client, { branch, contentId: input.contentId, locale: input.locale, expectedLocaleBlobSha: input.expectedLocaleBlobSha })'), true);
assert.equal(source.includes('admin-auth'), false);
console.log('ADMIN TRANSLATIONS API PASS');
