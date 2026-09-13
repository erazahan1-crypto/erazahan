import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/admin/posts/edit.astro', 'utf8');
const field = source.match(/<input name="sourceUrl"[^>]*>/)?.[0] || '';

assert.ok(field, 'sourceUrl input exists and remains visible in the edit form');
assert.match(field, /\breadonly\b/, 'sourceUrl is read-only during normal form interaction');
assert.match(field, /\brequired\b/, 'sourceUrl remains required for the existing backend contract');
assert.doesNotMatch(field, /\bdisabled\b/, 'sourceUrl remains available to the submitted payload');
assert.match(source, /field\('sourceUrl'\)\.value = post\.sourceUrl \|\| ''/, 'loaded historical sourceUrl populates the read-only field');
assert.match(source, /sourceUrl: field\('sourceUrl'\)\.value/, 'payload preserves the loaded historical sourceUrl');
for (const fieldName of ['title', 'slug', 'date', 'letter', 'categories', 'content']) {
  assert.match(source, new RegExp(fieldName), `${fieldName} remains present in the edit form`);
}

console.log('ADMIN SOURCE URL FREEZE PASS');
