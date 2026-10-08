import assert from 'node:assert/strict';
import {
  ambiguousTranslationWriteMessage,
  formatTranslationWriteFailure,
  requestTranslationWrite,
} from '../../src/lib/admin-translation-write-diagnostics.mjs';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

for (const action of ['create_draft RU', 'create_draft EN', 'update_draft', 'begin_edit', 'publish', 'rebase', 'discard']) {
  const outcome = await requestTranslationWrite(async () => jsonResponse(200, { ok: true, action }));
  assert.equal(outcome.kind, 'success', `${action} accepts only an explicit successful response`);
}

for (const [status, code] of [[400, 'INVALID_ATOMIC_BRANCH_CONFIRMATION'], [403, 'FORBIDDEN_ORIGIN'], [409, 'SOURCE_CHANGED'], [502, 'UPSTREAM_FAILURE'], [503, 'SERVICE_UNAVAILABLE']]) {
  const outcome = await requestTranslationWrite(async () => jsonResponse(status, { ok: false, code }));
  assert.equal(outcome.kind, 'server_rejection');
  assert.equal(formatTranslationWriteFailure(outcome, 'fallback').startsWith(`HTTP ${status} — ${code}`), true);
}

const unauthorized = await requestTranslationWrite(async () => new Response('<html>Access denied</html>', { status: 401, headers: { 'content-type': 'text/html' } }));
assert.equal(unauthorized.kind, 'non_json');
assert.equal(formatTranslationWriteFailure(unauthorized, '').startsWith('HTTP 401 — the server returned a non-JSON response.'), true);

const malformed = await requestTranslationWrite(async () => new Response('{not-json', { status: 503 }));
assert.equal(malformed.kind, 'non_json');

const detailed = await requestTranslationWrite(async () => jsonResponse(400, { ok: false, code: 'DRAFT_INVALID', message: 'Referenced content_id does not exist' }));
assert.equal(formatTranslationWriteFailure(detailed, 'fallback').includes('Referenced content_id does not exist'), true);

const unsafeMessage = await requestTranslationWrite(async () => jsonResponse(502, { ok: false, code: 'UPSTREAM_FAILURE', message: 'private upstream detail' }));
assert.equal(formatTranslationWriteFailure(unsafeMessage, 'fallback').includes('private upstream detail'), false);

let attempts = 0;
const network = await requestTranslationWrite(async () => { attempts += 1; throw new TypeError('network unavailable'); });
assert.equal(network.kind, 'network_error');
assert.equal(attempts, 1, 'network errors are never retried automatically');
assert.equal(formatTranslationWriteFailure(network, '').startsWith('Network error —'), true);

const unsavedDraft = { title: 'Unsaved EN editorial text', content: 'Must remain local' };
const retained = structuredClone(unsavedDraft);
await requestTranslationWrite(async () => jsonResponse(503, { ok: false, code: 'SERVICE_UNAVAILABLE' }));
assert.deepEqual(unsavedDraft, retained, 'diagnostic parsing does not mutate unsaved editor data');

for (const action of ['save_draft', 'publish', 'discard', 'rebase', 'begin_edit']) {
  const message = ambiguousTranslationWriteMessage(action);
  assert.match(message, /uncertain/i);
  assert.match(message, /Reload/);
}

console.log('ADMIN TRANSLATION WRITE DIAGNOSTICS PASS');
