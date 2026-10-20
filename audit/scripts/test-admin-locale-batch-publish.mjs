import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import { DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH, prepareLocaleBatchPublish, publishLocaleBatch } from '../../functions/_lib/admin-locale-batch-publish.mjs';

const ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const OTHER = 'cadd4552-097e-5845-b59e-223c36c82488';
const TARGET = JSON.parse(readFileSync('src/data/migrations/content-id-registry.v1.json', 'utf8')).entries.find((entry) => entry.content_id !== ID).content_id;
const FP = 'a'.repeat(64);
const BASE = `src/data/content/dreams/${ID.slice(0, 2)}/${ID}`;
const paths = { item: `${BASE}/item.json`, hy: `${BASE}/hy.json`, ru: `${BASE}/ru.json`, en: `${BASE}/en.json` };
const item = { schema_version: 1, content_id: ID, type: 'dream_dictionary', source_locale: 'hy', source_revision: 7, source_fingerprint: FP, fingerprint_spec_version: 1 };
const hy = { schema_version: 1, content_id: ID, locale: 'hy', draft: null, published: { slug: 'hy-source', title: 'HY source', description: null, content: 'HY source', image_alts: {}, tags: ['HY'], alphabet_key: 'Ա', based_on_source_revision: null, based_on_source_fingerprint: null, version: 1, published_at: '2026-10-20' } };
const payload = (locale, overrides = {}) => locale === 'ru'
  ? { slug: 'ворон', title: 'Ворон', description: null, content: 'Ворон', image_alts: {}, tags: ['Птицы'], alphabet_key: 'В', ...overrides }
  : { slug: 'crow', title: 'Crow', description: null, content: 'Crow', image_alts: {}, tags: ['Birds'], alphabet_key: 'C', ...overrides };
const localized = (locale, overrides = {}) => ({ ...payload(locale), based_on_source_revision: 7, based_on_source_fingerprint: FP, ...overrides });
const document = (locale, { draft = null, published = null } = {}) => ({ schema_version: 1, content_id: ID, locale, draft, published });

function fixture({ ru = null, en = null, claims = { version: 1, claims: [] }, reservations = { version: 1, reservations: [] }, branchConflict = false, branchUnknown = false, stateful = false } = {}) {
  const files = new Map([
    [paths.item, { sha: 'item-sha', content: canonicalJson(item) }], [paths.hy, { sha: 'hy-sha', content: canonicalJson(hy) }],
    [paths.ru, ru ? { sha: 'ru-sha', content: canonicalJson(ru) } : null], [paths.en, en ? { sha: 'en-sha', content: canonicalJson(en) } : null],
    [DRAFT_CLAIMS_PATH, { sha: 'claims-sha', content: canonicalJson(claims) }], [PUBLISHED_RESERVATIONS_PATH, { sha: 'reservations-sha', content: canonicalJson(reservations) }],
  ]);
  const calls = { blobs: [], trees: [], commits: 0, updates: 0, reads: [] };
  const blobContents = new Map(); let pendingEntries = [];
  const client = {
    async getBranchRef() { return { sha: 'commit-sha' }; }, async getCommit() { return { treeSha: 'tree-sha' }; },
    async readFileFromTree(tree, path) { calls.reads.push({ tree, path }); return files.get(path) ?? null; },
    async createBlob(content) { calls.blobs.push(content); const sha = calls.blobs.length.toString(16).padStart(40, 'a'); blobContents.set(sha, content); return { sha }; },
    async createTree(value) { calls.trees.push(value); pendingEntries = value.entries; return { sha: 'tree-next' }; }, async createCommit() { calls.commits += 1; return { sha: 'commit-next' }; },
    async updateBranchRef() { calls.updates += 1; if (branchConflict) { const error = new Error('advanced'); error.status = 422; throw error; } if (branchUnknown) throw new Error('unknown ref update result'); if (stateful) for (const entry of pendingEntries) files.set(entry.path, entry.sha === null ? null : { sha: entry.sha, content: blobContents.get(entry.sha) }); },
  };
  return { client, calls };
}
function selection(locale, overrides = {}) {
  return { locale, mode: 'import', payload: payload(locale), expectedLocaleAbsent: true, replacePublished: false, allowOutdatedSource: false, ...overrides };
}
function input(selections) { return { branch: 'main', contentId: ID, expectedSourceRevision: 7, expectedSourceFingerprint: FP, selections, publishedAt: '2026-10-20' }; }
async function rejects(code, operation) { await assert.rejects(operation, (error) => error?.code === code); }
function treePaths(test) { return test.calls.trees[0]?.entries.map((entry) => entry.path) ?? []; }

{ const test = fixture(); const result = await publishLocaleBatch(test.client, input([selection('ru')])); assert.equal(result.changed, true); assert.deepEqual(treePaths(test), [paths.ru, PUBLISHED_RESERVATIONS_PATH]); assert.equal(test.calls.commits, 1); assert.equal(test.calls.updates, 1); assert.equal(result.documents.en, null); }
{ const test = fixture(); const result = await publishLocaleBatch(test.client, input([selection('en')])); assert.deepEqual(treePaths(test), [paths.en, PUBLISHED_RESERVATIONS_PATH]); assert.equal(result.documents.ru, null); }
{ const test = fixture(); const result = await publishLocaleBatch(test.client, input([selection('ru'), selection('en')])); assert.deepEqual(treePaths(test), [paths.ru, paths.en, PUBLISHED_RESERVATIONS_PATH]); assert.equal(result.transaction.commitSha, 'commit-next'); assert.equal(test.calls.commits, 1, 'RU + EN must create one commit'); assert.equal(test.calls.updates, 1); assert.deepEqual(result.changes.some((change) => change.path === paths.item || change.path === paths.hy), false, 'batch must not mutate HY'); }
{ const test = fixture(); const invalid = selection('ru', { payload: payload('ru', { alphabet_key: 'Z' }) }); await assert.rejects(() => prepareLocaleBatchPublish(test.client, input([invalid])), (error) => error?.code === 'DRAFT_INVALID' && error?.locale === 'ru'); assert.equal(test.calls.blobs.length, 0); assert.equal(test.calls.trees.length, 0); }
{ const test = fixture(); const invalid = selection('ru', { payload: payload('ru', { content: '(asset://019c2a10-4e61-7a32-8c15-2a37bcf94d02)', image_alts: { '019c2a10-4e61-7a32-8c15-2a37bcf94d02': 'Изображение' } }) }); await rejects('DRAFT_INVALID', () => publishLocaleBatch(test.client, input([invalid, selection('en')]))); assert.equal(test.calls.blobs.length, 0); assert.equal(test.calls.trees.length, 0); assert.equal(test.calls.updates, 0); }
{ const test = fixture(); const invalid = selection('en', { payload: payload('en', { content: '[missing](content://aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa)' }) }); await rejects('DRAFT_INVALID', () => publishLocaleBatch(test.client, input([selection('ru'), invalid]))); assert.equal(test.calls.blobs.length, 0); assert.equal(test.calls.trees.length, 0); }
{ const test = fixture(); const linked = (locale) => selection(locale, { payload: payload(locale, { content: `[related](content://${TARGET})` }) }); const result = await prepareLocaleBatchPublish(test.client, input([linked('ru'), linked('en')])); assert.equal(result.summary.length, 2, 'known content references remain valid when both locales publish together'); }
{ const published = { ...localized('en'), version: 1, published_at: '2026-10-19' }; const test = fixture({ en: document('en', { published }), reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: ID, kind: 'active' }] } }); await rejects('PUBLISHED_REPLACEMENT_CONFIRMATION_REQUIRED', () => prepareLocaleBatchPublish(test.client, input([selection('en', { expectedLocaleBlobSha: 'en-sha', expectedLocaleAbsent: undefined })]))); assert.equal(test.calls.trees.length, 0); }
{ const published = { ...localized('en'), version: 1, published_at: '2026-10-19' }; const test = fixture({ en: document('en', { published }), reservations: { version: 1, reservations: [{ locale: 'en', slug: 'crow', content_id: ID, kind: 'active' }] } }); const result = await publishLocaleBatch(test.client, input([selection('en', { expectedLocaleBlobSha: 'en-sha', expectedLocaleAbsent: undefined, replacePublished: true, payload: payload('en', { title: 'New crow' }) })])); assert.equal(result.documents.en.published.version, 2); assert.equal(result.documents.en.draft, null); }
{ const draft = localized('en'); const test = fixture({ en: document('en', { draft }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: ID }] } }); const result = await publishLocaleBatch(test.client, input([selection('ru')])); assert.deepEqual(result.documents.en, document('en', { draft }), 'unselected existing draft must be preserved'); }
{ const stale = localized('en', { based_on_source_revision: 6, based_on_source_fingerprint: 'b'.repeat(64) }); const test = fixture({ en: document('en', { draft: stale }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: ID }] } }); const saved = { locale: 'en', mode: 'saved_draft', expectedLocaleBlobSha: 'en-sha', replacePublished: false, allowOutdatedSource: false }; await rejects('SOURCE_OUTDATED', () => prepareLocaleBatchPublish(test.client, input([saved]))); const result = await publishLocaleBatch(test.client, input([{ ...saved, allowOutdatedSource: true }])); assert.equal(result.documents.en.published.based_on_source_revision, 6); assert.equal(result.documents.en.published.based_on_source_fingerprint, 'b'.repeat(64)); }
{ const stale = localized('en', { based_on_source_revision: 6, based_on_source_fingerprint: 'b'.repeat(64) }); const test = fixture({ en: document('en', { draft: stale }), claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: ID }] } }); const imported = selection('en', { expectedLocaleBlobSha: 'en-sha', expectedLocaleAbsent: undefined, payload: payload('en', { title: 'Fresh text' }) }); await rejects('SOURCE_OUTDATED', () => prepareLocaleBatchPublish(test.client, input([imported]))); assert.equal(test.calls.trees.length, 0, 'import must not automatically rebase an outdated existing draft'); }
{ const test = fixture(); await rejects('STALE_EDITOR', () => prepareLocaleBatchPublish(test.client, input([selection('en', { expectedLocaleAbsent: false })]))); }
{ const test = fixture(); await rejects('SOURCE_CHANGED', () => prepareLocaleBatchPublish(test.client, { ...input([selection('en')]), expectedSourceRevision: 6 })); }
{ const test = fixture({ branchConflict: true }); await rejects('BRANCH_REF_CONFLICT', () => publishLocaleBatch(test.client, input([selection('ru'), selection('en')]))); assert.equal(test.calls.updates, 1); }
{ const test = fixture({ stateful: true }); const original = input([selection('ru'), selection('en')]); await publishLocaleBatch(test.client, original); await rejects('STALE_EDITOR', () => publishLocaleBatch(test.client, original)); assert.equal(test.calls.commits, 1, 'a repeated stale request must not create another commit'); assert.equal(test.calls.updates, 1); }
{ const test = fixture({ branchUnknown: true }); await rejects('BRANCH_REF_UPDATE_FAILURE', () => publishLocaleBatch(test.client, input([selection('ru'), selection('en')]))); assert.equal(test.calls.updates, 1, 'unknown branch update outcome is never retried by the writer'); }
{ const test = fixture({ claims: { version: 1, claims: [{ locale: 'en', slug: 'crow', content_id: OTHER }] } }); await rejects('SLUG_CLAIMED', () => prepareLocaleBatchPublish(test.client, input([selection('en')]))); assert.equal(test.calls.trees.length, 0); }

console.log('ADMIN LOCALE BATCH PUBLISH PASS');
