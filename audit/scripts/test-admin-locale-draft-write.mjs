import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import {
  AdminLocaleDraftWriteError,
  DRAFT_CLAIMS_PATH,
  PUBLISHED_RESERVATIONS_PATH,
  beginLocaleEditWrite,
  createLocaleDraftWrite,
  discardLocaleDraftWrite,
  loadLocaleTranslationEditorState,
  rebaseLocaleDraftWrite,
  updateLocaleDraftWrite,
} from '../../functions/_lib/admin-locale-draft-write.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const FP7 = 'a'.repeat(64); const FP8 = 'b'.repeat(64);
const BASE = `src/data/content/dreams/${A.slice(0, 2)}/${A}`;
const PATHS = { item: `${BASE}/item.json`, hy: `${BASE}/hy.json`, locale: `${BASE}/en.json` };
const payload = (slug = 'crow', title = 'Crow', overrides = {}) => ({ slug, title, description: null, content: `<p>${title}</p>`, image_alts: {}, tags: ['Bird'], alphabet_key: null, ...overrides });
const item = (revision = 7, fingerprint = FP7) => ({ schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: revision, source_fingerprint: fingerprint, fingerprint_spec_version: 1 });
const hy = (current = item()) => ({ schema_version: 1, content_id: A, locale: 'hy', draft: null, published: { ...payload('hy-source', 'HY source'), based_on_source_revision: null, based_on_source_fingerprint: null, version: 1, published_at: '2026-09-15' } });
const localized = (slug = 'crow', title = 'Crow', provenance = { based_on_source_revision: 7, based_on_source_fingerprint: FP7 }) => ({ ...payload(slug, title), ...provenance });
const document = ({ draft = null, published = null } = {}) => ({ schema_version: 1, content_id: A, locale: 'en', draft, published });

function fixture({ locale = null, currentItem = item(), claims = { version: 1, claims: [] }, reservations = { version: 1, reservations: [] }, missingItem = false, branchConflict = false } = {}) {
  const files = new Map([
    [PATHS.item, missingItem ? null : { sha: 'item-sha', content: canonicalJson(currentItem) }],
    [PATHS.hy, { sha: 'hy-sha', content: canonicalJson(hy(currentItem)) }],
    [PATHS.locale, locale === null ? null : { sha: 'locale-sha', content: canonicalJson(locale) }],
    [DRAFT_CLAIMS_PATH, { sha: 'claims-sha', content: canonicalJson(claims) }],
    [PUBLISHED_RESERVATIONS_PATH, { sha: 'reservations-sha', content: canonicalJson(reservations) }],
  ]);
  const calls = { refs: 0, commits: 0, reads: [], blobs: [], trees: [], updates: [] };
  const client = {
    async getBranchRef() { calls.refs += 1; return { sha: 'commit-sha' }; },
    async getCommit() { calls.commits += 1; return { treeSha: 'tree-sha' }; },
    async readFileFromTree(tree, path) { calls.reads.push({ tree, path }); return files.get(path) ?? null; },
    async createBlob(content) { calls.blobs.push(content); return { sha: `blob-${calls.blobs.length}` }; },
    async createTree(value) { calls.trees.push(value); return { sha: 'tree-next' }; },
    async createCommit() { return { sha: 'commit-next' }; },
    async updateBranchRef(value) { calls.updates.push(value); if (branchConflict) { const error = new Error('advanced'); error.status = 422; throw error; } return { sha: value.sha }; },
  };
  return { client, calls };
}
async function code(expected, operation) { await assert.rejects(operation, (error) => error?.code === expected); }
function changedPaths(calls) { return calls.trees[0]?.entries.map((entry) => entry.path) ?? []; }
const createInput = (overrides = {}) => ({ branch: 'main', contentId: A, locale: 'en', payload: payload(), expectedLocaleAbsent: true, expectedSourceRevision: 7, expectedSourceFingerprint: FP7, ...overrides });

{ const test = fixture(); const result = await loadLocaleTranslationEditorState(test.client, createInput()); assert.equal(result.translation_state.publication_state, 'NOT_CREATED'); assert.equal(result.locale_document, null); assert.equal(result.locale_blob_sha, null); assert.equal(result.slug_locked, false); assert.equal(result.alphabet_suggestion, null); assert.equal(test.calls.refs, 1); assert.equal(test.calls.commits, 1); assert.equal(new Set(test.calls.reads.map((call) => call.tree)).size, 1); }
{ const draft = localized(); const test = fixture({ locale: document({ draft }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const result = await loadLocaleTranslationEditorState(test.client, createInput()); assert.equal(result.translation_state.publication_state, 'DRAFT'); assert.equal(result.alphabet_suggestion, 'C'); }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const test = fixture({ locale: document({ published }) }); assert.equal((await loadLocaleTranslationEditorState(test.client, createInput())).translation_state.publication_state, 'PUBLISHED'); const both = fixture({ locale: document({ draft: localized(), published }) }); assert.equal((await loadLocaleTranslationEditorState(both.client, createInput())).translation_state.publication_state, 'PUBLISHED_WITH_DRAFT'); }
await code('CONTENT_NOT_FOUND', () => loadLocaleTranslationEditorState(fixture({ missingItem: true }).client, createInput()));
await code('LOCALE_UNSUPPORTED', () => loadLocaleTranslationEditorState(fixture().client, { ...createInput(), locale: 'hy' }));
await code('INVALID_SNAPSHOT_STATE', () => loadLocaleTranslationEditorState(fixture({ claims: { version: 2, claims: [] } }).client, createInput()));
await code('INVALID_SNAPSHOT_STATE', () => loadLocaleTranslationEditorState(fixture({ reservations: { version: 2, reservations: [] } }).client, createInput()));
await code('INVALID_SNAPSHOT_STATE', () => loadLocaleTranslationEditorState(fixture({ locale: { ...document({ draft: localized() }), content_id: B } }).client, createInput()));
await code('INVALID_SNAPSHOT_STATE', () => loadLocaleTranslationEditorState(fixture({ locale: { ...document({ draft: localized() }), locale: 'ru' } }).client, createInput()));

{ const test = fixture(); const input = createInput({ payload: payload('crow', 'Crow', { alphabet_key: 'Z', based_on_source_revision: 999 }) }); const original = structuredClone(input.payload); const result = await createLocaleDraftWrite(test.client, input); assert.equal(result.changed, true); assert.equal(result.localeDocument.draft.based_on_source_revision, 7); assert.equal(result.localeDocument.draft.alphabet_key, 'Z'); assert.deepEqual(input.payload, original); assert.deepEqual(changedPaths(test.calls), [PATHS.locale, DRAFT_CLAIMS_PATH]); assert.equal(test.calls.trees[0].entries.find((entry) => entry.path === PATHS.locale).sha !== null, true); assert.deepEqual(test.calls.updates, [{ branch: 'main', sha: 'commit-next', force: false }]); }
{ const test = fixture(); const result = await createLocaleDraftWrite(test.client, createInput({ payload: payload('owl', 'Owl', { alphabet_key: null }) })); assert.equal(result.localeDocument.draft.alphabet_key, null); }
await code('STALE_EDITOR', () => createLocaleDraftWrite(fixture().client, createInput({ expectedLocaleAbsent: false })));
await code('STALE_EDITOR', () => createLocaleDraftWrite(fixture({ locale: document({ draft: localized() }) }).client, createInput()));
await code('SOURCE_CHANGED', () => createLocaleDraftWrite(fixture().client, createInput({ expectedSourceRevision: 6 })));
await code('SOURCE_CHANGED', () => createLocaleDraftWrite(fixture().client, createInput({ expectedSourceFingerprint: FP8 })));
await code('SLUG_CLAIMED', () => createLocaleDraftWrite(fixture({ claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: B }] } }).client, createInput()));
await code('SLUG_PERMANENTLY_RESERVED', () => createLocaleDraftWrite(fixture({ reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: B, kind: 'active' }] } }).client, createInput()));

{ const draft = localized(); const test = fixture({ currentItem: item(8, FP8), locale: document({ draft }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const result = await updateLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', payload: payload('crow', 'Edited'), expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); assert.equal(result.localeDocument.draft.based_on_source_revision, 7); assert.equal(result.localeDocument.draft.based_on_source_fingerprint, FP7); }
{ const draft = localized(); const test = fixture({ locale: document({ draft }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); await updateLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', payload: payload('raven', 'Raven'), expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale, DRAFT_CLAIMS_PATH]); }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const test = fixture({ locale: document({ draft: localized(), published }) }); await updateLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', payload: payload('crow', 'New'), expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); await code('PUBLISHED_SLUG_LOCKED', () => updateLocaleDraftWrite(fixture({ locale: document({ draft: localized(), published }) }).client, { branch: 'main', contentId: A, locale: 'en', payload: payload('raven'), expectedLocaleBlobSha: 'locale-sha' })); }
await code('STALE_EDITOR', () => updateLocaleDraftWrite(fixture({ locale: document({ draft: localized() }) }).client, { branch: 'main', contentId: A, locale: 'en', payload: payload(), expectedLocaleBlobSha: 'old' }));

{ const old = { ...localized('crow', 'Crow', { based_on_source_revision: 7, based_on_source_fingerprint: FP7 }), version: 1, published_at: '2026-09-15' }; const test = fixture({ currentItem: item(8, FP8), locale: document({ published: old }) }); const result = await beginLocaleEditWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); assert.equal(result.localeDocument.draft.based_on_source_revision, 7); assert.deepEqual(result.localeDocument.published, old); }
await code('STALE_EDITOR', () => beginLocaleEditWrite(fixture({ locale: document({ published: { ...localized(), version: 1, published_at: '2026-09-15' } }) }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'old' }));

{ const draft = localized('crow', 'Crow', { based_on_source_revision: 7, based_on_source_fingerprint: FP7 }); const test = fixture({ currentItem: item(8, FP8), locale: document({ draft }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const result = await rebaseLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); assert.equal(result.localeDocument.draft.based_on_source_revision, 8); assert.equal(result.localeDocument.draft.content, draft.content); }
{ const test = fixture({ locale: document({ draft: localized() }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); const result = await rebaseLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.equal(result.code, 'NO_CHANGES'); assert.equal(test.calls.trees.length, 0); }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const test = fixture({ currentItem: item(8, FP8), locale: document({ draft: localized(), published }) }); await rebaseLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); }
await code('STALE_EDITOR', () => rebaseLocaleDraftWrite(fixture({ locale: document({ draft: localized() }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'old' }));

{ const test = fixture({ locale: document({ draft: localized() }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }); await discardLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale, DRAFT_CLAIMS_PATH]); assert.equal(test.calls.trees[0].entries.find((entry) => entry.path === PATHS.locale).sha, null); }
{ const published = { ...localized(), version: 1, published_at: '2026-09-15' }; const test = fixture({ locale: document({ draft: localized(), published }) }); await discardLocaleDraftWrite(test.client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }); assert.deepEqual(changedPaths(test.calls), [PATHS.locale]); }
await code('NO_DRAFT', () => discardLocaleDraftWrite(fixture({ locale: document({ published: { ...localized(), version: 1, published_at: '2026-09-15' } }) }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }));
await code('DRAFT_INVALID', () => discardLocaleDraftWrite(fixture({ locale: document({ draft: localized() }) }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }));
await code('SLUG_CLAIMED', () => discardLocaleDraftWrite(fixture({ locale: document({ draft: localized() }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: B }] } }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'locale-sha' }));
await code('STALE_EDITOR', () => discardLocaleDraftWrite(fixture({ locale: document({ draft: localized() }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: A }] } }).client, { branch: 'main', contentId: A, locale: 'en', expectedLocaleBlobSha: 'old' }));
await code('BRANCH_REF_CONFLICT', () => createLocaleDraftWrite(fixture({ branchConflict: true }).client, createInput()));

const source = readFileSync('functions/_lib/admin-locale-draft-write.mjs', 'utf8');
assert.equal(source.includes('publishLocaleDraft'), false); assert.equal(source.includes('admin-auth'), false); assert.equal(source.includes('published_at'), false); assert.equal(source.includes('updated_at'), false); assert.equal(source.includes('generation'), false);
console.log('ADMIN LOCALE DRAFT WRITE PASS');
