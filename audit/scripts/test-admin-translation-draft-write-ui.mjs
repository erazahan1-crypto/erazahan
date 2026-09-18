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
assert.match(source, /discardAction\.hidden = state !== 'DRAFT' && state !== 'PUBLISHED_WITH_DRAFT'/);
assert.match(source, /data-rebase-action[^>]*>Mark reviewed for current HY<\/button>/);
assert.match(source, /Translation text will not change\./);
assert.match(source, /Save your draft changes before marking it reviewed\./);
assert.match(source, /function canRebase\(\)[\s\S]*state === 'DRAFT' \|\| state === 'PUBLISHED_WITH_DRAFT'[\s\S]*draft_synchronization === 'OUTDATED'[\s\S]*loadedState\?\.locale_document\?\.draft[\s\S]*\^\[0-9a-f\]\{40\}\$/);
const rebaseSource = source.slice(source.indexOf('async function rebaseDraft()'), source.indexOf('async function beginEdit()'));
assert.match(rebaseSource, /if \(saving \|\| writeBlocked \|\| isDirty\(\) \|\| !loadedState \|\| !canRebase\(\) \|\| !localeBlobSha\) return/);
assert.match(rebaseSource, /window\.confirm\('Mark this draft as reviewed against the current HY source\?\\n\\nThe translation text will not be changed\. This only updates which HY source version this draft is based on\.'/);
assert.match(rebaseSource, /const body = \{ action: 'rebase', content_id: loadedState\.content_id, locale: loadedState\.locale, expected_locale_blob_sha: localeBlobSha \}/);
assert.match(rebaseSource, /code === 'STALE_EDITOR' \|\| code === 'BRANCH_REF_CONFLICT'[\s\S]*await load\(\); writeBlocked = true/s);
assert.match(rebaseSource, /code === 'NO_DRAFT'\) await load\(\)/);
for (const forbidden of ['payload', 'draftBuffer', 'saveDraft()', "action: 'publish'", 'expected_source_revision', 'expected_source_fingerprint', 'expected_locale_absent']) assert.equal(rebaseSource.includes(forbidden), false);
assert.match(source, /data-discard-action[^>]*>Discard Draft<\/button>/);
assert.match(source, /function canDiscard\(\)[\s\S]*state === 'DRAFT' \|\| state === 'PUBLISHED_WITH_DRAFT'[\s\S]*loadedState\?\.locale_document\?\.draft[\s\S]*\^\[0-9a-f\]\{40\}\$/);
assert.match(source, /discardAction\.disabled = saving \|\| writeBlocked \|\| !canDiscard\(\)/);
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
for (const forbidden of ["method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", 'localStorage', 'sessionStorage']) assert.equal(source.includes(forbidden), false);
assert.match(source, /data-publish-action[^>]*>Publish<\/button>/);
assert.equal(publishSource.includes('payload'), false);
assert.equal(publishSource.includes('saveDraft()'), false);

const beginSource = source.slice(source.indexOf('async function beginEdit()'), source.indexOf('function addField'));
const discardSource = source.slice(source.indexOf('async function discardDraft()'), source.indexOf('async function rebaseDraft()'));
assert.match(discardSource, /if \(saving \|\| writeBlocked \|\| !loadedState \|\| !canDiscard\(\) \|\| !localeBlobSha\) return/);
assert.match(discardSource, /window\.confirm\(message\)/);
assert.match(discardSource, /'Discard this draft\?\\n\\nThe saved translation draft and any unsaved local changes will be deleted\.\\nThis cannot be undone\.'/);
assert.match(discardSource, /'Discard this draft\?\\n\\nThe draft and any unsaved local changes will be deleted\.\\nThe published translation will remain unchanged\.'/);
assert.match(discardSource, /const body = \{ action: 'discard', content_id: loadedState\.content_id, locale: loadedState\.locale, expected_locale_blob_sha: localeBlobSha \}/);
assert.match(discardSource, /code === 'STALE_EDITOR' \|\| code === 'BRANCH_REF_CONFLICT'[\s\S]*await load\(\); writeBlocked = true/s);
assert.match(discardSource, /code === 'NO_DRAFT'\) await load\(\)/);
for (const forbidden of ['payload', 'draftBuffer', 'saveDraft()', "action: 'publish'", "action: 'rebase'", 'expected_source_revision', 'expected_source_fingerprint', 'expected_locale_absent']) assert.equal(discardSource.includes(forbidden), false);
assert.match(beginSource, /if \(saving \|\| writeBlocked \|\| !loadedState \|\| !canBeginEdit\(\)\) return/);
assert.match(beginSource, /const body = \{ action: 'begin_edit', content_id: loadedState\.content_id, locale: loadedState\.locale, expected_locale_blob_sha: localeBlobSha \}/);
assert.match(beginSource, /if \(!await load\(\)\)/);
assert.match(beginSource, /code === 'STALE_EDITOR' \|\| code === 'BRANCH_REF_CONFLICT'/);
assert.match(beginSource, /code === 'NO_DRAFT' \? 'This translation is no longer published without a draft/);
for (const forbidden of ['payload', 'draftBuffer', 'saveDraft()', "action: 'create_draft'", "action: 'update_draft'", "action: 'publish'", 'expected_source_revision', 'expected_source_fingerprint']) assert.equal(beginSource.includes(forbidden), false);

const publishStateSource = source.slice(source.indexOf('function updateDraftAction()'), source.indexOf('function parseJsonField'))
  .replace(/querySelectorAll<[^>]+>/g, 'querySelectorAll');
function publishDisabledFor({ state = 'DRAFT', draft = true, draftSync = 'OUTDATED', sha = 'a'.repeat(40), dirty = false, saving = false, writeBlocked = false } = {}) {
  const draftAction = { disabled: false };
  const publishAction = { disabled: false };
  const rebaseAction = { disabled: false, hidden: false };
  const rebaseDirtyHelp = { hidden: true };
  const discardAction = { disabled: false };
  const beginEditAction = { disabled: false };
  const otherControl = { disabled: false };
  const values = { saving, writeBlocked, draftAction, publishAction, rebaseAction, rebaseDirtyHelp, discardAction, beginEditAction, draftForm: { querySelectorAll: () => [draftAction, publishAction, rebaseAction, discardAction, otherControl] }, loadedState: { translation_state: { publication_state: state, draft_synchronization: draftSync }, locale_document: draft ? { draft: {} } : null }, localeBlobSha: sha, formError: { hidden: true }, isDirty: () => dirty };
  const controller = Function('state', `with (state) { ${publishStateSource}; return { updateDraftAction }; }`)(values);
  controller.updateDraftAction();
  return { publish: publishAction.disabled, rebase: rebaseAction.disabled, rebaseDirtyHelp: rebaseDirtyHelp.hidden, discard: discardAction.disabled, beginEdit: beginEditAction.disabled };
}
assert.equal(publishDisabledFor().publish, false);
assert.equal(publishDisabledFor({ dirty: true }).publish, true);
assert.equal(publishDisabledFor({ sha: null }).publish, true);
assert.equal(publishDisabledFor({ writeBlocked: true }).publish, true);
assert.equal(publishDisabledFor({ saving: true }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT' }).publish, false);
assert.equal(publishDisabledFor().discard, false);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT' }).discard, false);
assert.equal(publishDisabledFor({ dirty: true }).discard, false);
assert.equal(publishDisabledFor({ saving: true }).discard, true);
assert.equal(publishDisabledFor({ writeBlocked: true }).discard, true);
assert.equal(publishDisabledFor({ sha: null }).discard, true);
assert.equal(publishDisabledFor({ sha: 'invalid' }).discard, true);
assert.equal(publishDisabledFor({ draft: false }).discard, true);
assert.equal(publishDisabledFor({ state: 'NOT_CREATED', draft: false, sha: null }).discard, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).discard, true);
assert.equal(publishDisabledFor({ state: 'NOT_CREATED', draft: false, sha: null }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).publish, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).beginEdit, false);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, saving: true }).beginEdit, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, writeBlocked: true }).beginEdit, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false, sha: 'invalid' }).beginEdit, true);
assert.equal(publishDisabledFor().rebase, false);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT' }).rebase, false);
assert.equal(publishDisabledFor({ draftSync: 'CURRENT' }).rebase, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT', draftSync: 'CURRENT' }).rebase, true);
assert.equal(publishDisabledFor({ dirty: true }).rebase, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT', dirty: true }).rebase, true);
assert.equal(publishDisabledFor({ dirty: true }).rebaseDirtyHelp, false);
assert.equal(publishDisabledFor({ dirty: false }).rebaseDirtyHelp, true);
assert.equal(publishDisabledFor({ saving: true }).rebase, true);
assert.equal(publishDisabledFor({ writeBlocked: true }).rebase, true);
assert.equal(publishDisabledFor({ sha: null }).rebase, true);
assert.equal(publishDisabledFor({ sha: 'A'.repeat(40) }).rebase, true);
assert.equal(publishDisabledFor({ sha: 'a'.repeat(39) }).rebase, true);
assert.equal(publishDisabledFor({ sha: 'g'.repeat(40) }).rebase, true);
assert.equal(publishDisabledFor({ sha: '' }).rebase, true);
assert.equal(publishDisabledFor({ sha: 'invalid' }).rebase, true);
assert.equal(publishDisabledFor({ draft: false }).rebase, true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }).rebase, true);

const rebaseVisibilitySource = source.slice(source.indexOf('rebaseAction.hidden ='), source.indexOf('discardAction.hidden ='));
function rebaseHiddenFor(state, draft, draftSync) {
  const rebaseAction = { hidden: true }; const rebaseHelp = { hidden: true }; const rebaseDirtyHelp = { hidden: true };
  Function('state', 'data', 'rebaseAction', 'rebaseHelp', 'rebaseDirtyHelp', 'isDirty', rebaseVisibilitySource)(state, { locale_document: draft ? { draft: {} } : null, translation_state: { draft_synchronization: draftSync } }, rebaseAction, rebaseHelp, rebaseDirtyHelp, () => false);
  assert.equal(rebaseHelp.hidden, rebaseAction.hidden);
  assert.equal(rebaseDirtyHelp.hidden, true);
  return rebaseAction.hidden;
}
assert.equal(rebaseHiddenFor('DRAFT', true, 'OUTDATED'), false);
assert.equal(rebaseHiddenFor('PUBLISHED_WITH_DRAFT', true, 'OUTDATED'), false);
assert.equal(rebaseHiddenFor('DRAFT', true, 'CURRENT'), true);
assert.equal(rebaseHiddenFor('PUBLISHED_WITH_DRAFT', true, 'CURRENT'), true);
assert.equal(rebaseHiddenFor('NOT_CREATED', false, 'NOT_CREATED'), true);
assert.equal(rebaseHiddenFor('PUBLISHED', false, 'CURRENT'), true);
assert.equal(rebaseHiddenFor('DRAFT', false, 'OUTDATED'), true);

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

const executableDiscardSource = discardSource
  .replace('const result: unknown', 'const result')
  .replaceAll(' as { code?: unknown }', '')
  .replaceAll(' as { ok?: unknown }', '');
const discardRequests = [];
let resolveDiscard;
let discardLoadCount = 0;
const discardState = {
  saving: false,
  writeBlocked: false,
  loadedState: { content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', locale: 'en', translation_state: { publication_state: 'DRAFT' }, locale_document: { draft: {} } },
  localeBlobSha: 'a'.repeat(40),
  updateDraftAction: () => {},
  writeError: { hidden: true, textContent: '' },
  safeWriteMessage: () => 'error',
  canDiscard: () => true,
  load: async () => { discardLoadCount += 1; return true; },
  window: { confirm: () => true },
  fetch: (_url, options) => new Promise((resolve) => { discardRequests.push(options); resolveDiscard = resolve; }),
};
const invokeDiscard = Function('state', `with (state) { ${executableDiscardSource}; return discardDraft; }`)(discardState);
const firstDiscard = invokeDiscard();
const secondDiscard = invokeDiscard();
assert.equal(discardRequests.length, 1);
assert.deepEqual(Object.keys(JSON.parse(discardRequests[0].body)).sort(), ['action', 'content_id', 'expected_locale_blob_sha', 'locale']);
assert.deepEqual(JSON.parse(discardRequests[0].body), { action: 'discard', content_id: discardState.loadedState.content_id, locale: discardState.loadedState.locale, expected_locale_blob_sha: discardState.localeBlobSha });
resolveDiscard({ ok: true, json: async () => ({ ok: true }) });
await firstDiscard;
await secondDiscard;
assert.equal(discardLoadCount, 1);
assert.equal(discardState.saving, false);

let cancelledRequests = 0;
const cancelledDiscard = Function('state', `with (state) { ${executableDiscardSource}; return discardDraft; }`)({ ...discardState, saving: false, window: { confirm: () => false }, fetch: () => { cancelledRequests += 1; } });
await cancelledDiscard();
assert.equal(cancelledRequests, 0);

const executableRebaseSource = rebaseSource
  .replace('const result: unknown', 'const result')
  .replaceAll(' as { code?: unknown }', '')
  .replaceAll(' as { ok?: unknown }', '');
const rebaseRequests = [];
let resolveRebase;
let rebaseLoadCount = 0;
let confirmation;
const rebaseState = {
  saving: false,
  writeBlocked: false,
  loadedState: { content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', locale: 'en', translation_state: { publication_state: 'DRAFT', draft_synchronization: 'OUTDATED' }, locale_document: { draft: {} } },
  localeBlobSha: 'a'.repeat(40),
  updateDraftAction: () => {},
  writeError: { hidden: true, textContent: '' },
  safeWriteMessage: () => 'error',
  canRebase: () => true,
  isDirty: () => false,
  load: async () => { rebaseLoadCount += 1; return true; },
  window: { confirm: (message) => { confirmation = message; return true; } },
  fetch: (_url, options) => new Promise((resolve) => { rebaseRequests.push(options); resolveRebase = resolve; }),
};
const invokeRebase = Function('state', `with (state) { ${executableRebaseSource}; return rebaseDraft; }`)(rebaseState);
const firstRebase = invokeRebase();
const secondRebase = invokeRebase();
assert.equal(rebaseRequests.length, 1);
assert.equal(confirmation, 'Mark this draft as reviewed against the current HY source?\n\nThe translation text will not be changed. This only updates which HY source version this draft is based on.');
assert.deepEqual(Object.keys(JSON.parse(rebaseRequests[0].body)).sort(), ['action', 'content_id', 'expected_locale_blob_sha', 'locale']);
assert.deepEqual(JSON.parse(rebaseRequests[0].body), { action: 'rebase', content_id: rebaseState.loadedState.content_id, locale: rebaseState.loadedState.locale, expected_locale_blob_sha: rebaseState.localeBlobSha });
resolveRebase({ ok: true, json: async () => ({ ok: true, locale_document: { draft: {} } }) });
await firstRebase;
await secondRebase;
assert.equal(rebaseLoadCount, 1);
assert.equal(rebaseState.loadedState.translation_state.draft_synchronization, 'OUTDATED', 'success does not invent CURRENT locally before authoritative load renders it');
assert.equal(rebaseState.saving, false);

let dirtyRebaseRequests = 0;
let dirtyRebaseLoads = 0;
let dirtyRebaseConfirmations = 0;
const dirtyRebase = Function('state', `with (state) { ${executableRebaseSource}; return rebaseDraft; }`)({ ...rebaseState, saving: false, isDirty: () => true, window: { confirm: () => { dirtyRebaseConfirmations += 1; return true; } }, load: async () => { dirtyRebaseLoads += 1; return true; }, fetch: () => { dirtyRebaseRequests += 1; } });
await dirtyRebase();
assert.equal(dirtyRebaseRequests, 0);
assert.equal(dirtyRebaseLoads, 0);
assert.equal(dirtyRebaseConfirmations, 0);
assert.equal(rebaseState.saving, false);

let cancelledRebaseRequests = 0;
const cancelledRebase = Function('state', `with (state) { ${executableRebaseSource}; return rebaseDraft; }`)({ ...rebaseState, saving: false, window: { confirm: () => false }, fetch: () => { cancelledRebaseRequests += 1; } });
await cancelledRebase();
assert.equal(cancelledRebaseRequests, 0);

for (const code of ['STALE_EDITOR', 'BRANCH_REF_CONFLICT', 'NO_DRAFT']) {
  let loads = 0;
  const errorState = { ...rebaseState, saving: false, writeBlocked: false, updateDraftAction: () => {}, writeError: { hidden: true, textContent: '' }, load: async () => { loads += 1; return true; }, window: { confirm: () => true }, fetch: async () => ({ ok: false, json: async () => ({ ok: false, code }) }) };
  const invoke = Function('state', `with (state) { ${executableRebaseSource}; return rebaseDraft; }`)(errorState);
  await invoke();
  assert.equal(loads, 1, `${code} reconciles authoritative state`);
  assert.equal(errorState.writeBlocked, code !== 'NO_DRAFT', `${code} write blocking follows editor conventions`);
}
console.log('ADMIN TRANSLATION DRAFT WRITE UI PASS');
