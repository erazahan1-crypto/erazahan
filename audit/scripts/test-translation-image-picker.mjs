import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTranslationMediaIndex } from '../../src/lib/content-source/translation-media-index.mjs';

const index = loadTranslationMediaIndex();
assert.equal(index.length, 2, 'current manifest projection count');
assert.deepEqual(index, loadTranslationMediaIndex(), 'projection is deterministic');
assert.equal(new Set(index.map((asset) => asset.asset_id)).size, index.length, 'asset IDs are unique');
for (const asset of index) {
  assert.deepEqual(Object.keys(asset).sort(), ['asset_id', 'height', 'mime_type', 'public_url', 'width']);
  assert.match(asset.asset_id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(asset.public_url, /^https:\/\//);
  assert.equal('source_url' in asset, false);
  assert.equal('integrity' in asset, false);
  assert.equal('image_alts' in asset, false);
}

const [first, second] = index;
function validAlts(raw) {
  try {
    const value = raw.trim() ? JSON.parse(raw) : {};
    return value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every((item) => typeof item === 'string') ? value : null;
  } catch { return null; }
}
function insert(content, range, rawAlts, asset, alt, decorative = false) {
  const alts = validAlts(rawAlts);
  if (!alts || (!decorative && !alt.trim())) return { content, rawAlts, caret: range.start, inserted: false };
  alts[asset.asset_id] = decorative ? '' : alt.trim();
  const markdown = `![](asset://${asset.asset_id})`;
  return { content: content.slice(0, range.start) + markdown + content.slice(range.end), rawAlts: JSON.stringify(alts, null, 2), caret: range.start + markdown.length, inserted: true };
}

const meaningful = insert('Before selected after', { start: 7, end: 15 }, '{}', first, 'Localized text');
assert.equal(meaningful.content, `Before ![](asset://${first.asset_id}) after`);
assert.equal(meaningful.content.includes(first.public_url), false);
assert.equal(meaningful.content.includes('source_url'), false);
assert.equal(meaningful.caret, `Before ![](asset://${first.asset_id})`.length);
assert.deepEqual(JSON.parse(meaningful.rawAlts), { [first.asset_id]: 'Localized text' });
assert.match(meaningful.content, /!\[\]\(asset:\/\/[0-9a-f-]+\)/);

const decorative = insert('', { start: 0, end: 0 }, meaningful.rawAlts, second, '', true);
assert.deepEqual(JSON.parse(decorative.rawAlts), { [first.asset_id]: 'Localized text', [second.asset_id]: '' });
const reuse = insert(decorative.content, { start: 0, end: 0 }, decorative.rawAlts, first, 'Updated localized text');
assert.equal(JSON.parse(reuse.rawAlts)[first.asset_id], 'Updated localized text');
assert.equal(insert('unchanged', { start: 0, end: 0 }, '{bad', first, 'x').inserted, false, 'malformed raw JSON is untouched');
assert.equal(insert('unchanged', { start: 0, end: 0 }, '[]', first, 'x').inserted, false, 'non-object raw JSON is untouched');
assert.equal(insert('unchanged', { start: 0, end: 0 }, '{"x":1}', first, 'x').inserted, false, 'non-string raw values are untouched');
assert.equal(insert('unchanged', { start: 0, end: 0 }, '{}', first, '').inserted, false, 'missing ALT does not become decorative');

const editor = readFileSync('src/pages/admin/translations/edit.astro', 'utf8');
assert.match(editor, /data-insert-image-action/);
assert.match(editor, /data-managed-image-dialog/);
assert.match(editor, /fetch\('\/admin\/translations\/media-index\.json'/);
assert.match(editor, /contentField\.setRangeText\(markdown, savedImageSelection\.start, savedImageSelection\.end, 'end'\)/);
assert.match(editor, /const markdown = `!\[\]\(asset:\/\/\$\{selectedManagedImage\.asset_id\}\)`/);
assert.match(editor, /currentImageAlts\(\)/);
assert.match(editor, /Image alts must be a JSON object of strings before inserting/);
assert.match(editor, /managedImageSession/);
assert.match(editor, /managedImageDialog\.addEventListener\('close'/);
assert.match(editor, /contentField\.focus\(\); syncDraftFromForm\(\);/);
assert.match(editor, /data-managed-image-decorative/);
assert.match(editor, /managedImageAlt\.disabled = true/);
assert.equal(editor.includes('pending-image:'), false);
assert.equal(editor.includes('source_url'), false);

console.log('TRANSLATION IMAGE PICKER PASS');
