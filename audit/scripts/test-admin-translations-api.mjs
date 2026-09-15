import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, onRequestGet } from '../../functions/api/admin/translations/index.ts';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const BASE = `src/data/content/dreams/${A.slice(0, 2)}/${A}`;
const FP = 'a'.repeat(64);
const env = { GITHUB_TOKEN: 'test-token', ADMIN_GITHUB_REPO: 'test-owner/test-repo', ADMIN_GITHUB_BRANCH: 'main' };
const payload = (slug, title, provenance) => ({ slug, title, description: null, content: `<p>${title}</p>`, image_alts: {}, tags: [], alphabet_key: null, ...provenance });
const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: FP, fingerprint_spec_version: 1 };
const hy = { schema_version: 1, content_id: A, locale: 'hy', draft: null, published: { ...payload('hy-source', 'HY source', { based_on_source_revision: null, based_on_source_fingerprint: null }), version: 1, published_at: '2026-09-15' } };
const registryPaths = ['src/data/content/locale-draft-slug-claims.v1.json', 'src/data/content/locale-slug-reservations.v1.json'];
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
function base64(value) { return btoa(unescape(encodeURIComponent(value))); }
function installFetch({ missing = false, malformed = false, transportFailure = false } = {}) {
  const original = globalThis.fetch; const calls = [];
  const files = new Map([
    [`${BASE}/item.json`, JSON.stringify(item)], [`${BASE}/hy.json`, JSON.stringify(hy)],
    [`${BASE}/ru.json`, null], [`${BASE}/en.json`, null],
    [registryPaths[0], malformed ? '{bad' : JSON.stringify({ version: 1, claims: [] })],
    [registryPaths[1], JSON.stringify({ version: 1, reservations: [] })],
  ]);
  const blobs = new Map(); let index = 0;
  for (const [path, content] of files) if (content !== null) blobs.set(`blob-${++index}`, { path, content });
  const tree = (prefix) => [...blobs].filter(([, value]) => value.path.startsWith(prefix)).map(([sha, value]) => {
    const rest = value.path.slice(prefix.length); const part = rest.split('/')[0];
    if (rest.includes('/')) return { path: part, type: 'tree', sha: `tree-${prefix}${part}/` };
    return { path: part, type: 'blob', sha };
  }).filter((entry, i, entries) => entries.findIndex((other) => other.path === entry.path) === i);
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input); const path = url.pathname; calls.push({ path, method: init.method ?? 'GET' });
    if (init.method && init.method !== 'GET') throw new Error('write API called');
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
  return { calls, restore: () => { globalThis.fetch = original; } };
}
async function response(url, options = {}) { return onRequestGet({ request: new Request(url, options), env: options.env ?? env }); }
async function expectInvalid(url) { const mock = installFetch(); try { const res = await response(url); assert.equal(res.status, 400); assert.equal((await res.json()).code, 'INVALID_REQUEST'); assert.equal(mock.calls.length, 0); } finally { mock.restore(); } }

for (const locale of ['ru', 'en']) { const mock = installFetch(); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=${locale}`); const body = await res.json(); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(body.ok, true); for (const key of ['content_id', 'locale', 'source', 'locale_document', 'locale_blob_sha', 'translation_state', 'slug_locked', 'alphabet_suggestion']) assert.ok(Object.hasOwn(body, key)); assert.equal(body.source.revision, 1); assert.equal(body.source.fingerprint, FP); assert.equal(body.locale_blob_sha, null); for (const forbidden of ['draftClaims', 'reservations', 'snapshot', 'treeSha', 'commitSha', 'refSha', 'token', 'config']) assert.equal(JSON.stringify(body).includes(forbidden), false); assert.equal(mock.calls.some((call) => call.method !== 'GET'), false); } finally { mock.restore(); } }
for (const suffix of ['', `?locale=ru`, `?content_id=${A}`, '?content_id=&locale=ru', `?content_id=${A}&locale=`, `?content_id=${A}&locale=hy`, `?content_id=${A}&locale=de`, '?content_id=bad&locale=ru', `?content_id=${A}&content_id=${A}&locale=ru`, `?content_id=${A}&locale=ru&locale=en`]) await expectInvalid(`https://site.test/api/admin/translations${suffix}`);
{ const mock = installFetch({ missing: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); assert.equal(res.status, 404); assert.equal((await res.json()).code, 'CONTENT_NOT_FOUND'); } finally { mock.restore(); } }
{ const mock = installFetch({ malformed: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); assert.equal(res.status, 503); assert.equal((await res.json()).code, 'SERVICE_UNAVAILABLE'); } finally { mock.restore(); } }
{ const mock = installFetch({ transportFailure: true }); try { const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`); const body = await res.json(); assert.equal(res.status, 502); assert.equal(body.code, 'UPSTREAM_FAILURE'); assert.equal(JSON.stringify(body).includes('private upstream detail'), false); } finally { mock.restore(); } }
{ const res = await response(`https://site.test/api/admin/translations?content_id=${A}&locale=ru`, { env: {} }); assert.equal(res.status, 503); }
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) { const res = onRequest({ request: new Request('https://site.test/api/admin/translations', { method }), env }); assert.equal(res.status, 405); assert.equal(res.headers.get('allow'), 'GET'); assert.equal(res.headers.get('cache-control'), 'no-store'); }
const source = readFileSync('functions/api/admin/translations/index.ts', 'utf8');
for (const forbidden of ['createLocaleDraftWrite', 'updateLocaleDraftWrite', 'beginLocaleEditWrite', 'rebaseLocaleDraftWrite', 'discardLocaleDraftWrite', 'publishLocaleDraft', 'commitMultiFileTransaction']) assert.equal(source.includes(forbidden), false);
assert.equal(source.includes('admin-auth'), false);
console.log('ADMIN TRANSLATIONS API PASS');
