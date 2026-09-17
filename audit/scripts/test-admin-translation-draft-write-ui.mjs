import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/admin/translations/edit.astro', 'utf8');
const publishSource = source.slice(source.indexOf('async function publishDraft()'), source.indexOf('function addField'));
for (const action of ['create_draft', 'update_draft', 'publish']) assert.match(source, new RegExp(`'${action}'`));
assert.match(source, /state === 'NOT_CREATED' \? 'create_draft'/);
assert.match(source, /state === 'DRAFT' \|\| state === 'PUBLISHED_WITH_DRAFT/);
assert.match(source, /expected_locale_absent: true/);
assert.match(source, /expected_source_revision: loadedState\.source\.revision/);
assert.match(source, /expected_source_fingerprint: loadedState\.source\.fingerprint/);
assert.match(source, /expected_locale_blob_sha: localeBlobSha/);
assert.match(source, /const body = \{ action: 'publish', content_id: loadedState\.content_id, locale: loadedState\.locale, expected_locale_blob_sha: localeBlobSha \}/);
assert.match(source, /function canPublish\(\)[\s\S]*state === 'DRAFT' \|\| state === 'PUBLISHED_WITH_DRAFT'[\s\S]*loadedState\?\.locale_document\?\.draft[\s\S]*!isDirty\(\)/);
assert.match(source, /publishAction\.disabled = saving \|\| writeBlocked \|\| !canPublish\(\)/);
assert.match(source, /publishAction\.hidden = state !== 'DRAFT' && state !== 'PUBLISHED_WITH_DRAFT'/);
assert.match(source, /beginEditAction\.hidden = state !== 'PUBLISHED'/);
assert.match(source, /beginEditAction\.disabled = saving \|\| writeBlocked \|\| !canBeginEdit\(\)/);
assert.match(source, /async function publishDraft\(\)[\s\S]*if \(saving \|\| writeBlocked \|\| !canPublish\(\)[\s\S]*fetch\('\/api\/admin\/translations', \{ method: 'POST'/);
assert.match(source, /publishAction\.addEventListener\('click', publishDraft\)/);
assert.match(source, /fetch\('\/api\/admin\/translations', \{ method: 'POST'/);
assert.match(source, /data-draft-action[^>]*disabled:cursor-not-allowed[^>]*disabled:opacity-60/);
assert.equal(/data-draft-action[^>]*\sopacity-60(?:\s|")/.test(source), false);
assert.match(source, /localeBlobSha = typeof .*locale_blob_sha/s);
assert.match(source, /await load\(\)/);
assert.match(source, /if \(!await load\(\)\) \{ writeBlocked = true; writeError\.textContent = 'Draft may have been saved/);
assert.match(source, /draftForm\.querySelectorAll[\s\S]*control\.disabled = saving/);
assert.match(source, /if \(saving \|\| \(isDirty\(\)/);
assert.match(source, /!localeBlobSha \|\| !loadedState\.locale_document\?\.draft/);
assert.match(source, /code === 'STALE_EDITOR'/);
assert.match(source, /const preserved = structuredClone\(draftBuffer\); await load\(\); draftBuffer = preserved/);
assert.match(source, /code === 'SOURCE_OUTDATED'.*Rebase the saved draft before publishing/s);
assert.match(source, /code === 'STALE_EDITOR'.*await load\(\); writeBlocked = true/s);
for (const code of ['NO_CHANGES', 'NO_DRAFT', 'DRAFT_INVALID', 'SLUG_INVALID', 'SLUG_RESERVED', 'SLUG_CLAIMED', 'SLUG_PERMANENTLY_RESERVED', 'PUBLISHED_SLUG_LOCKED', 'BRANCH_REF_CONFLICT']) assert.match(source, new RegExp(`code === '${code}'`));
assert.match(source, /saving \|\| writeBlocked/);
for (const forbidden of ['rebase', 'discard', "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", 'localStorage', 'sessionStorage']) assert.equal(source.includes(forbidden), false);
assert.match(source, /data-publish-action[^>]*>Publish<\/button>/);
assert.equal(publishSource.includes('payload'), false);
assert.equal(publishSource.includes('saveDraft()'), false);

const beginSource = source.slice(source.indexOf('async function beginEdit()'), source.indexOf('function addField'));
assert.match(beginSource, /if \(saving \|\| writeBlocked \|\| !loadedState \|\| !canBeginEdit\(\)\) return/);
assert.match(beginSource, /const body = \{ action: 'begin_edit', content_id: loadedState\.content_id, locale: loadedState\.locale, expected_locale_blob_sha: localeBlobSha \}/);
assert.match(beginSource, /if \(!await load\(\)\)/);
assert.match(beginSource, /code === 'STALE_EDITOR' \|\| code === 'BRANCH_REF_CONFLICT'/);
assert.match(beginSource, /code === 'NO_DRAFT' \? 'This translation is no longer published without a draft/);
for (const forbidden of ['payload', 'draftBuffer', 'saveDraft()', "action: 'create_draft'", "action: 'update_draft'", "action: 'publish'", 'expected_source_revision', 'expected_source_fingerprint']) assert.equal(beginSource.includes(forbidden), false);

const publishStateSource = source.slice(source.indexOf('function updateDraftAction()'), source.indexOf('function parseJsonField'))
  .replace(/querySelectorAll<[^>]+>/g, 'querySelectorAll');
function publishDisabledFor({ state = 'DRAFT', draft = true, sha = 'a'.repeat(40), dirty = false, saving = false, writeBlocked = false } = {}) {
  const draftAction = { disabled: false };
  const publishAction = { disabled: false };
  const beginEditAction = { disabled: false };
  const otherControl = { disabled: false };
  const values = { saving, writeBlocked, draftAction, publishAction, beginEditAction, draftForm: { querySelectorAll: () => [draftAction, publishAction, otherControl] }, loadedState: { translation_state: { publication_state: state }, locale_document: draft ? { draft: {} } : null }, localeBlobSha: sha, formError: { hidden: true }, isDirty: () => dirty };
  const controller = Function('state', `with (state) { ${publishStateSource}; return { updateDraftAction }; }`)(values);
  controller.updateDraftAction();
  return { publish: publishAction.disabled, beginEdit: beginEditAction.disabled };
}
assert.equal(publishDisabledFor().publish, false);
assert.equal(publishDisabledFor({ dirty: true }).publish, true);
assert.equal(publishDisabledFor({ sha: null }).publish, true);
assert.equal(publishDisabledFor({ writeBlocked: true }).publish, true);
assert.equal(publishDisabledFor({ saving: true }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT' }).publish, false);
assert.equal(publishDisabledFor({ state: 'NOT_CREATED', draft: false, sha: null }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).beginEdit, false);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, saving: true }).beginEdit, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, writeBlocked: true }).beginEdit, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, sha: 'invalid' }).beginEdit, true);

const executableBeginSource = beginSource
  .replace('const result: unknown', 'const result')
  .replaceAll(' as { code?: unknown }', '')
  .replaceAll(' as { ok?: unknown }', '');
const requests = [];
let resolveRequest;
let loadCount = 0;
const beginState = {
  saving: false,
  writeBlocked: false,
  loadedState: { content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', locale: 'en', translation_state: { publication_state: 'PUBLISHED' } },
  localeBlobSha: 'a'.repeat(40),
  updateDraftAction: () => {},
  writeError: { hidden: true, textContent: '' },
  safeWriteMessage: () => 'error',
  canBeginEdit: () => true,
  load: async () => { loadCount += 1; return true; },
  fetch: (_url, options) => new Promise((resolve) => { requests.push(options); resolveRequest = resolve; }),
};
const invokeBeginEdit = Function('state', `with (state) { ${executableBeginSource}; return beginEdit; }`)(beginState);
const firstBegin = invokeBeginEdit();
const secondBegin = invokeBeginEdit();
assert.equal(requests.length, 1);
assert.deepEqual(Object.keys(JSON.parse(requests[0].body)).sort(), ['action', 'content_id', 'expected_locale_blob_sha', 'locale']);
assert.deepEqual(JSON.parse(requests[0].body), { action: 'begin_edit', content_id: beginState.loadedState.content_id, locale: beginState.loadedState.locale, expected_locale_blob_sha: beginState.localeBlobSha });
resolveRequest({ ok: true, json: async () => ({ ok: true }) });
await firstBegin;
await secondBegin;
assert.equal(loadCount, 1);
assert.equal(beginState.saving, false);
console.log('ADMIN TRANSLATION DRAFT WRITE UI PASS');
