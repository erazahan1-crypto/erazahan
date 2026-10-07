import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import { DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH } from '../../functions/_lib/admin-locale-draft-write.mjs';
import { saveWorkspace } from '../../functions/_lib/admin-workspace-save.mjs';

const store = scanContentStore('src/data/content/dreams');
const record = store.records.find((entry) => !entry.locales.ru && !entry.locales.en);
assert.ok(record, 'fixture requires an HY-only logical record');
const paths = hyStorePaths(record.content_id);
const POSTS_PATH = 'src/data/posts.json';
const REGISTRY_PATH = 'src/data/migrations/content-id-registry.v1.json';

// The browser/API seams are intentionally checked here as source contracts:
// the workspace must use the existing index-backed pickers, and preview must
// use the public localized renderer rather than a second markdown renderer.
const workspacePage = readFileSync('src/pages/admin/posts/workspace.astro', 'utf8');
const previewEndpoint = readFileSync('functions/api/admin/workspace/preview.ts', 'utf8');
assert.doesNotMatch(workspacePage, /\bprompt\s*\(/, 'workspace must not fall back to browser prompt pickers');
assert.match(workspacePage, /\/admin\/translations\/link-index\.json/, 'workspace uses the established logical-link index');
assert.match(workspacePage, /\/admin\/translations\/media-index\.json/, 'workspace uses the established managed-media index');
assert.match(previewEndpoint, /renderLocalizedContent/, 'preview uses the public localized rendering pipeline');
assert.match(previewEndpoint, /localizedAuthoringContext/, 'preview has the shared logical-reference context');

function transport() {
  const files = new Map([POSTS_PATH, REGISTRY_PATH, paths.item, paths.hy, DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH]
    .map((file, index) => [file, { sha: `${index}`.padStart(40, 'a'), content: readFileSync(file, 'utf8') }]));
  let commits = 0; let blobs = 0;
  return {
    get commits() { return commits; },
    async getBranchRef() { return { sha: 'b'.repeat(40) }; },
    async getCommit() { return { treeSha: 'c'.repeat(40) }; },
    async readFileFromTree(_tree, file) { return files.get(file) ?? null; },
    async createBlob() { blobs += 1; return { sha: `${blobs}`.padStart(40, 'd') }; },
    async createTree() { return { sha: 'e'.repeat(40) }; },
    async createCommit() { commits += 1; return { sha: 'f'.repeat(40) }; },
    async updateBranchRef() { return { sha: 'f'.repeat(40) }; },
  };
}

const payload = (locale) => ({
  slug: locale === 'ru' ? 'тест-рабочей-области' : 'workspace-save-test',
  title: locale === 'ru' ? 'Тест рабочей области' : 'Workspace save test',
  description: null, content: `<p>${locale} workspace body</p>`, image_alts: {}, tags: [], alphabet_key: null,
});

{
  const client = transport();
  const result = await saveWorkspace(client, {
    branch: 'main', contentId: record.content_id,
    locales: { ru: { expectedLocaleAbsent: true, payload: payload('ru') }, en: { expectedLocaleAbsent: true, payload: payload('en') } },
  });
  assert.equal(client.commits, 1, 'RU and EN Save All uses one commit');
  assert.equal(result.saved.hy, false);
  assert.equal(result.saved.ru, true);
  assert.equal(result.saved.en, true);
  assert.equal(result.transaction.changedPaths.filter((path) => path.endsWith('/ru.json')).length, 1);
  assert.equal(result.transaction.changedPaths.filter((path) => path.endsWith('/en.json')).length, 1);
}

{
  const client = transport();
  const invalid = { ...payload('en'), slug: 'не-ascii' };
  await assert.rejects(() => saveWorkspace(client, {
    branch: 'main', contentId: record.content_id,
    locales: { ru: { expectedLocaleAbsent: true, payload: payload('ru') }, en: { expectedLocaleAbsent: true, payload: invalid } },
  }));
  assert.equal(client.commits, 0, 'cross-language validation rejects the whole transaction before commit');
}

console.log('ADMIN WORKSPACE SAVE PASS');
