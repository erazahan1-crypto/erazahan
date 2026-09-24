import assert from 'node:assert/strict';
import { loadMediaManifest } from '../../src/lib/content-source/media-manifest.mjs';
import { renderLocalizedContent, validateLocalizedBody } from '../../src/lib/localized-content-pipeline.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const DRAFT = '01990c84-9c78-7abc-8def-123456789abc';
const ASSET = '019c2a10-4e61-7a32-8c15-2a37bcf94d02';
const UNKNOWN_ASSET = '019c2a10-4e61-7cd9-8d8e-1148b1f55c07';
const index = { knownContentIds: new Set([A, B, DRAFT]), pathsByContentId: new Map([[A, new Map([['hy', '/hy/']])], [B, new Map([['en', '/en/target/'], ['ru', '/ru/outdated/']])]]) };
const mediaIndex = loadMediaManifest();
const render = (content, imageAlts = {}) => renderLocalizedContent({ content, imageAlts, locale: 'en', currentContentId: A, contentLinkIndex: index, mediaIndex });

assert.match(render(`[safe **label**](content://${B})`), /<a href="\/en\/target\/">safe <strong>label<\/strong><\/a>/);
assert.equal(render(`[draft target](content://${DRAFT})`), '<p>draft target</p>\n');
assert.match(render(`![](asset://${ASSET})`, { [ASSET]: 'Localized <alt>' }), /src="https:\/\/images\.erazahan\.info\/posts\/erazahan-bexer-2\.webp" alt="Localized &lt;alt&gt;"/);
assert.match(render(`![](asset://${ASSET})`, { [ASSET]: '' }), /alt=""/);
for (const [content, imageAlts, code] of [
  [`![](asset://${ASSET})`, {}, 'ASSET_ALT_MISSING'],
  [`![wrong](asset://${ASSET})`, { [ASSET]: 'x' }, 'LOGICAL_REFERENCE_INVALID'],
  [`[self](content://${A})`, {}, 'CONTENT_REFERENCE_SELF'],
  [`[missing](content://11111111-1111-5111-8111-111111111111)`, {}, 'CONTENT_REFERENCE_MISSING'],
  [`![](asset://${UNKNOWN_ASSET})`, { [UNKNOWN_ASSET]: 'x' }, 'ASSET_REFERENCE_MISSING'],
  ['<a href="content://efa61838-86c8-56b8-815c-0a38b0a83242">bad</a>', {}, 'LOGICAL_REFERENCE_NONCANONICAL'],
]) assert.throws(() => render(content, imageAlts), (error) => error.code === code);

assert.doesNotThrow(() => validateLocalizedBody({ content: `![](asset://${ASSET}) [draft](content://${DRAFT})`, imageAlts: {}, locale: 'en', currentContentId: A, contentLinkIndex: index, mediaIndex, mode: 'draft' }));
assert.match(render('## Pilot heading\n\nExternal [site](https://example.test) and *emphasis*.'), /<h2>Pilot heading<\/h2>[\s\S]*href="https:\/\/example\.test"[\s\S]*<em>emphasis<\/em>/);
console.log('LOCALIZED CONTENT PIPELINE PASS');
