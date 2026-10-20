import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/admin/translations/batch.astro', 'utf8');
const hyEditor = readFileSync('src/pages/admin/posts/edit.astro', 'utf8');
const api = readFileSync('functions/api/admin/translations/batch.ts', 'utf8');

assert.match(page, /Publish RU \+ EN/);
assert.match(page, /Preview selected translations/);
assert.match(page, /Publish selected translations/);
assert.match(page, /parseTranslationImport/);
assert.match(page, /preview_batch/);
assert.match(page, /publish_batch/);
assert.match(page, /Pasted JSON remains in this browser/i);
assert.match(page, /Waiting for Cloudflare deployment/);
assert.match(page, /I understand this replaces the existing published translation/);
assert.match(page, /const reloaded = await load\(\)/);
assert.match(page, /No retry was sent/);
assert.match(page, /loadedStateMatchesLastPreview/);
assert.match(page, /previewAction\.disabled = true/);
assert.match(page, /finally \{ previewAction\.disabled = false; \}/);
assert.match(page, /candidate\.error/);
assert.match(page, /allow_outdated_source: candidate\.allowOutdated/);
assert.match(hyEditor, /data-translation-batch-link/);
assert.match(hyEditor, /ждать Cloudflare не нужно/);
assert.match(api, /FORBIDDEN_ORIGIN/);
assert.match(api, /resolveAdminWriteBranch/);
assert.match(api, /preview_batch/);
assert.match(api, /publish_batch/);
assert.match(api, /PUBLISHED_REPLACEMENT_CONFIRMATION_REQUIRED/);
assert.match(api, /\.\.\.\(locale \? \{ locale \} : \{\}\)/);

console.log('ADMIN TRANSLATION BATCH SHELL PASS');
