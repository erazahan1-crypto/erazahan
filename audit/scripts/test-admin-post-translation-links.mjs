import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/admin/posts/edit.astro', 'utf8');
const CONTENT_ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';

function target(contentId, locale) {
  return `/admin/translations/edit/?${new URLSearchParams({ content_id: contentId, locale })}`;
}

assert.match(source, /<h2 id="translations-heading"[^>]*>Translations<\/h2>/);
assert.match(source, /data-translations-unavailable/);
assert.match(source, /data-translation-link="ru"[^>]*>RU</);
assert.match(source, /data-translation-link="en"[^>]*>EN</);
assert.match(source, /interface LoadResult[^}]*content_id\?: string/s);
assert.match(source, /configureTranslationLinks\(result\.content_id\)/);
assert.match(source, /function validContentId[\s\S]*?\[57\][\s\S]*?\[89ab\]/);
assert.match(source, /if \(!validContentId\(contentId\)\)[\s\S]*?translationLinks\.hidden = true[\s\S]*?translationsUnavailable\.hidden = false/);
assert.match(source, /new URLSearchParams\(\{ content_id: contentId, locale \}\)/);

assert.equal(target(CONTENT_ID, 'ru'), `/admin/translations/edit/?content_id=${CONTENT_ID}&locale=ru`);
assert.equal(target(CONTENT_ID, 'en'), `/admin/translations/edit/?content_id=${CONTENT_ID}&locale=en`);
assert.equal(target(CONTENT_ID, 'ru').includes('locale=en'), false);
assert.equal(target(CONTENT_ID, 'en').includes('locale=ru'), false);
assert.equal(target(CONTENT_ID, 'ru').includes('slug'), false);
assert.equal(source.includes('crypto.randomUUID'), false);

assert.match(source, /fetch\(`\/api\/admin\/posts\/\$\{id\}`, \{ headers: \{ accept: 'application\/json' \} \}\)/);
assert.match(source, /fetch\(`\/api\/admin\/posts\/\$\{id\}`, \{[\s\S]*?method: 'PUT'/);
assert.equal(/fetch\([^\n]*\/api\/admin\/translations/.test(source), false);
assert.equal(/(?:Create Draft|Save Translation|Begin Edit|Rebase|Discard|Publish)/.test(source), false);
assert.equal(/(?:POST|PUT|PATCH|DELETE)[\s\S]{0,160}\/api\/admin\/translations/.test(source), false);

console.log('ADMIN POST TRANSLATION LINKS PASS');
