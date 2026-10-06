import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/pages/admin/posts/edit.astro', 'utf8');
const field = source.match(/<input name="sourceUrl"[^>]*>/)?.[0] || '';
const slugField = source.match(/<input name="slug"[^>]*>/)?.[0] || '';
const newSource = readFileSync('src/pages/admin/posts/new.astro', 'utf8');
const newSlugField = newSource.match(/<input name="slug"[^>]*>/)?.[0] || '';
const publicRoute = readFileSync('src/pages/[...path].astro', 'utf8');

assert.ok(field, 'sourceUrl input exists and remains visible in the edit form');
assert.match(field, /\breadonly\b/, 'sourceUrl is read-only during normal form interaction');
assert.match(field, /\brequired\b/, 'sourceUrl remains required for the existing backend contract');
assert.doesNotMatch(field, /\bdisabled\b/, 'sourceUrl remains available to the submitted payload');
assert.match(source, /field\('sourceUrl'\)\.value = post\.sourceUrl \|\| ''/, 'loaded historical sourceUrl populates the read-only field');
assert.match(source, /sourceUrl: field\('sourceUrl'\)\.value/, 'payload preserves the loaded historical sourceUrl');
assert.match(source, /field\('description'\)\.value = post\.description \|\| ''/, 'blank descriptions reload as a blank editor field');
assert.match(source, /description: field\('description'\)\.value \|\| null/, 'blank editor descriptions submit as an explicit clear');
assert.match(publicRoute, /\(post\.description && post\.description\.trim\(\)\) \|\| excerptOf\(post, 160\)/, 'public SEO retains explicit-description then excerpt fallback');
assert.ok(slugField, 'slug input exists in the existing-post edit form');
assert.match(slugField, /\breadonly\b/, 'existing HY slugs are visibly read-only');
assert.doesNotMatch(slugField, /\bdisabled\b/, 'existing slug remains available to the submitted payload');
assert.ok(newSlugField, 'slug input exists in the native create form');
assert.doesNotMatch(newSlugField, /\breadonly\b/, 'native create slug remains editable');
for (const fieldName of ['title', 'slug', 'date', 'letter', 'categories', 'content']) {
  assert.match(source, new RegExp(fieldName), `${fieldName} remains present in the edit form`);
}

console.log('ADMIN SOURCE URL FREEZE PASS');
