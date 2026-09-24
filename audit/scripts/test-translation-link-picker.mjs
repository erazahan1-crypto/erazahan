import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marked } from 'marked';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { projectTranslationLinkIndex } from '../../src/lib/content-source/translation-link-index.mjs';
import { prepareSearchIndex, rankPreparedSearch } from '../../src/lib/public-search.mjs';

const registry = JSON.parse(readFileSync('src/data/migrations/content-id-registry.v1.json', 'utf8'));
const repository = scanContentStore('src/data/content/dreams');
const index = projectTranslationLinkIndex(repository);
const again = projectTranslationLinkIndex(repository);

assert.equal(index.length, 5800);
assert.deepEqual(index, again, 'projection is deterministic');
assert.equal(new Set(index.map((row) => row.content_id)).size, 5800);
assert.deepEqual(index.map((row) => row.content_id), [...index.map((row) => row.content_id)].sort((a, b) => a.localeCompare(b, 'en')));
const registryIds = new Set(registry.entries.map((entry) => entry.content_id));
for (const row of index) {
  assert.equal(registryIds.has(row.content_id), true);
  assert.deepEqual(Object.keys(row).sort(), ['content_id', 'slug', 'title']);
  assert.match(row.content_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(Object.values(row).some((value) => typeof value === 'string' && value.includes('content://')), false);
}
const oneRecord = { records: [repository.records[0]] };
assert.throws(() => projectTranslationLinkIndex(oneRecord, { entries: [{ content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242' }] }), /absent from registry/);
assert.throws(() => projectTranslationLinkIndex(oneRecord, { entries: [{ content_id: repository.records[0].content_id }, { content_id: repository.records[0].content_id }] }), /must be unique/);
assert.throws(() => projectTranslationLinkIndex(oneRecord, { entries: [{ content_id: repository.records[0].content_id }, { content_id: 'aaa61838-86c8-56b8-815c-0a38b0a83242' }] }), /counts differ/);
assert.throws(() => projectTranslationLinkIndex({ records: [repository.records[0], repository.records[0]] }, { entries: [{ content_id: repository.records[0].content_id }] }), /counts differ/);

const prepared = prepareSearchIndex(index);
assert.equal(prepared.length, 5800, 'the index is prepared once as one collection');
const query = index.find((row) => row.title.trim())?.title.split(/\s+/u)[0] ?? '';
const ranked = rankPreparedSearch(query, prepared, 12);
assert.ok(ranked.length > 0 && ranked.length <= 12, 'common title term returns capped results');

const editor = readFileSync('src/pages/admin/translations/edit.astro', 'utf8');
assert.match(editor, /data-internal-link-action/);
assert.match(editor, /data-internal-link-dialog/);
assert.match(editor, /fetch\('\/admin\/translations\/link-index\.json'/);
assert.match(editor, /prepareSearchIndex\(rows\)/);
assert.match(editor, /rankPreparedSearch\(query, preparedTranslationLinkIndex!, 12\)/);
assert.match(editor, /setTimeout\(\(\) => \{ void renderInternalLinkResults\(\); \}, 200\)/);
assert.match(editor, /session !== internalLinkSession \|\| !internalLinkDialog\.open \|\| query !== internalLinkSearch\.value\.trim\(\)/);
assert.match(editor, /row\.content_id !== loadedState\?\.content_id/);
assert.match(editor, /contentField\.setRangeText\(markdown, savedContentSelection\.start, savedContentSelection\.end, 'end'\)/);
assert.match(editor, /\[\$\{escapeMarkdownAnchor\(anchor\)\}\]\(content:\/\/\$\{selectedLinkTarget\.content_id\}\)/);
assert.match(editor, /contentField\.focus\(\); syncDraftFromForm\(\);/);
assert.equal(editor.includes('fetch(\'/api/admin/translations\''), true, 'existing save API remains present');
const pickerSource = editor.slice(editor.indexOf('function validLinkIndex'), editor.indexOf('function initializeDraft'));
assert.equal(pickerSource.includes("method: 'POST'"), false);
assert.equal(pickerSource.includes('saveDraft()'), false);
assert.equal(pickerSource.includes('publishDraft()'), false);
assert.equal(pickerSource.includes('content://${selectedLinkTarget.slug}'), false);

function insert(value, range, anchor, target) {
  const markdown = `[${anchor.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}](content://${target.content_id})`;
  return { value: value.slice(0, range.start) + markdown + value.slice(range.end), caret: range.start + markdown.length };
}
const target = index[1];
const selected = insert('Before localized anchor after', { start: 7, end: 23 }, 'localized anchor', target);
assert.equal(selected.value, `Before [localized anchor](content://${target.content_id}) after`);
assert.equal(selected.caret, `Before [localized anchor](content://${target.content_id})`.length);
const unselected = insert('Before after', { start: 7, end: 7 }, 'Custom anchor', target);
assert.equal(unselected.value, `Before [Custom anchor](content://${target.content_id})after`);
assert.equal(unselected.value.includes(target.slug), false);
assert.equal(unselected.value.includes('http'), false);
const bracketAnchor = insert('xa [ b]y', { start: 1, end: 7 }, 'a [ b]', target);
assert.equal(bracketAnchor.value, `x[a \\[ b\\]](content://${target.content_id})y`);
assert.match(marked.parse(bracketAnchor.value), /<a href="content:\/\/[^\"]+">a \[ b\]<\/a>/);

console.log('TRANSLATION LINK PICKER PASS');
