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
for (const forbidden of ['begin_edit', 'rebase', 'discard', "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'", 'localStorage', 'sessionStorage']) assert.equal(source.includes(forbidden), false);
assert.match(source, /data-publish-action[^>]*>Publish<\/button>/);
assert.equal(publishSource.includes('payload'), false);
assert.equal(publishSource.includes('saveDraft()'), false);

const publishStateSource = source.slice(source.indexOf('function updateDraftAction()'), source.indexOf('function parseJsonField'))
  .replace(/querySelectorAll<[^>]+>/g, 'querySelectorAll');
function publishDisabledFor({ state = 'DRAFT', draft = true, sha = 'a'.repeat(40), dirty = false, saving = false, writeBlocked = false } = {}) {
  const draftAction = { disabled: false };
  const publishAction = { disabled: false };
  const otherControl = { disabled: false };
  const values = { saving, writeBlocked, draftAction, publishAction, draftForm: { querySelectorAll: () => [draftAction, publishAction, otherControl] }, loadedState: { translation_state: { publication_state: state }, locale_document: draft ? { draft: {} } : null }, localeBlobSha: sha, formError: { hidden: true }, isDirty: () => dirty };
  const controller = Function('state', `with (state) { ${publishStateSource}; return { updateDraftAction }; }`)(values);
  controller.updateDraftAction();
  return publishAction.disabled;
}
assert.equal(publishDisabledFor(), false);
assert.equal(publishDisabledFor({ dirty: true }), true);
assert.equal(publishDisabledFor({ sha: null }), true);
assert.equal(publishDisabledFor({ writeBlocked: true }), true);
assert.equal(publishDisabledFor({ saving: true }), true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED_WITH_DRAFT' }), false);
assert.equal(publishDisabledFor({ state: 'NOT_CREATED', draft: false, sha: null }), true);
assert.equal(publishDisabledFor({ state: 'PUBLISHED', draft: false }), true);
console.log('ADMIN TRANSLATION DRAFT WRITE UI PASS');
