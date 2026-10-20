import assert from 'node:assert/strict';
import { onRequestPost } from '../../functions/api/admin/translations/batch.ts';

const ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const FP = 'a'.repeat(64);
const SHA = 'b'.repeat(40);
const payload = { slug: 'crow', title: 'Crow', description: null, content: 'Crow', image_alts: {}, tags: ['Birds'], alphabet_key: 'C' };
const valid = {
  action: 'preview_batch', content_id: ID, expected_source_revision: 7, expected_source_fingerprint: FP,
  selections: [{ locale: 'en', mode: 'import', expected_locale_blob_sha: SHA, payload, replace_published: false, allow_outdated_source: false }],
};
const env = { GITHUB_TOKEN: 'test-token', ADMIN_GITHUB_REPO: 'test-owner/test-repo', ADMIN_GITHUB_BRANCH: 'main', ERAZAHAN_LOCALE_ADMIN_ATOMIC_BRANCH: 'main', ERAZAHAN_ADMIN_DEPLOYMENT_CLASS: 'production' };

async function post(body, headers = { origin: 'https://site.test', 'content-type': 'application/json' }) {
  return onRequestPost({ request: new Request('https://site.test/api/admin/translations/batch', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }), env });
}
async function rejectsWithoutFetch(body, expectedCode) {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('GitHub must not be called'); };
  try { const response = await post(body); assert.equal(response.status, 400); assert.equal((await response.json()).code, expectedCode); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
}

await rejectsWithoutFetch({ ...valid, unknown: true }, 'INVALID_REQUEST');
await rejectsWithoutFetch({ ...valid, selections: [{ ...valid.selections[0], unexpected: true }] }, 'INVALID_REQUEST');
await rejectsWithoutFetch({ ...valid, selections: [{ ...valid.selections[0], payload: { ...payload, unknown: true } }] }, 'INVALID_REQUEST');
{ const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('GitHub must not be called'); };
  try { const response = await post(valid, { origin: 'https://evil.test', 'content-type': 'application/json' }); assert.equal(response.status, 403); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
}
{ const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls += 1; throw new Error('GitHub must not be called'); };
  try { const response = await post(valid, { origin: 'https://site.test', 'content-type': 'text/plain' }); assert.equal(response.status, 415); assert.equal(calls, 0); }
  finally { globalThis.fetch = original; }
}

console.log('ADMIN TRANSLATION BATCH API PASS');
