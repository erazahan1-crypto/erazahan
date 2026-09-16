import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/admin/translations/edit.astro', 'utf8');
const CONTENT_ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const payload = (title = 'Crow') => ({ slug: 'crow', title, description: 'Description', content: '<p>Content</p>', image_alts: { hero: 'Crow image' }, tags: ['Bird'], alphabet_key: 'C' });
const response = ({ locale = 'ru', publication = 'NOT_CREATED', draft = null, published = null, draftSync = 'NOT_CREATED', publishedSync = 'NOT_CREATED' } = {}) => ({
  ok: true,
  content_id: CONTENT_ID,
  locale,
  source: { revision: 1, fingerprint: 'a'.repeat(64), title: 'HY source', description: 'HY description', content: '<p>HY content</p>', image_alts: { hero: 'HY image' }, tags: ['HY'], alphabet_key: 'Հ' },
  locale_document: draft || published ? { draft, published } : null,
  locale_blob_sha: draft || published ? 'b'.repeat(40) : null,
  translation_state: { state: publication === 'PUBLISHED' ? 'CURRENT' : publication, publication_state: publication, draft_synchronization: draftSync, published_synchronization: publishedSync },
  slug_locked: Boolean(published),
  alphabet_suggestion: 'C',
});

function getUrl(locale) {
  return `/api/admin/translations?${new URLSearchParams({ content_id: CONTENT_ID, locale })}`;
}

assert.match(source, /import AdminLayout/);
assert.match(source, /const CONTENT_ID_RE = .*\[57\].*\[89ab\]/);
assert.match(source, /function validLocale.*value === 'ru'.*value === 'en'/s);
assert.match(source, /if \(!contentId \|\| !CONTENT_ID_RE\.test\(contentId\)\).*return/s);
assert.match(source, /if \(!validLocale\(locale\)\).*return/s);
assert.match(source, /fetch\(`\/api\/admin\/translations\?\$\{new URLSearchParams\(\{ content_id: contentId, locale \}\)\}`/);
assert.equal(getUrl('ru'), `/api/admin/translations?content_id=${CONTENT_ID}&locale=ru`);
assert.equal(getUrl('en'), `/api/admin/translations?content_id=${CONTENT_ID}&locale=en`);
assert.match(source, /href = `\/admin\/translations\/edit\/\?\$\{new URLSearchParams\(\{ content_id: id, locale: next \}\)\}`/);

for (const state of ['NOT_CREATED', 'DRAFT', 'PUBLISHED', 'PUBLISHED_WITH_DRAFT']) {
  const fixture = state === 'NOT_CREATED'
    ? response({ publication: state })
    : state === 'DRAFT'
      ? response({ publication: state, draft: payload() })
      : state === 'PUBLISHED'
        ? response({ publication: state, published: { ...payload(), version: 1, published_at: '2026-09-16' }, publishedSync: 'CURRENT' })
        : response({ publication: state, draft: payload('Draft'), published: { ...payload('Published'), version: 2, published_at: '2026-09-16' }, draftSync: 'OUTDATED', publishedSync: 'CURRENT' });
  assert.equal(fixture.translation_state.publication_state, state);
  assert.match(source, new RegExp(`'${state}'`));
}

const both = response({ publication: 'PUBLISHED_WITH_DRAFT', draft: payload('Draft'), published: { ...payload('Published'), version: 2, published_at: '2026-09-16' }, draftSync: 'CURRENT', publishedSync: 'OUTDATED' });
assert.equal(both.locale_document.draft.title, 'Draft');
assert.equal(both.locale_document.published.title, 'Published');
assert.match(source, /renderPayload\(snapshots, 'Published'.*renderPayload\(snapshots, 'Draft'/s);
assert.match(source, /draft_synchronization.*published_synchronization/s);
assert.match(source, /data-outdated-warning/);
assert.match(source, /data-source-fields/);
assert.match(source, /Read only/);
assert.match(source, /data-slug-lock/);
assert.match(source, /Suggested alphabet key/);
assert.match(source, /CONTENT_NOT_FOUND/);
assert.match(source, /LOCALE_UNSUPPORTED/);
assert.match(source, /Translation data is temporarily unavailable\./);
assert.match(source, /function validPayload/);
assert.match(source, /function validSource/);
assert.match(source, /fetch\('\/api\/admin\/translations', \{ method: 'POST'/);
assert.equal(/method:\s*['"](?:PUT|PATCH|DELETE)/.test(source), false);
for (const action of ['Create Draft', 'Save Draft', 'Begin Edit', 'Rebase', 'Discard', 'Publish']) {
  assert.equal(new RegExp(`<(?:button|a)[^>]*>\\s*${action}\\s*<`, 'i').test(source), false);
}
for (const forbidden of ['localStorage', 'sessionStorage', 'GITHUB_TOKEN', 'CF_ACCESS', 'ADMIN_GITHUB_BRANCH', 'github.com']) assert.equal(source.includes(forbidden), false);

console.log('ADMIN TRANSLATION EDITOR SHELL PASS');
