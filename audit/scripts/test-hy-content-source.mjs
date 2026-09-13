import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  DEFAULT_HY_CONTENT_SOURCE,
  HY_CONTENT_SOURCE,
  HY_CONTENT_SOURCE_ENV,
  loadLegacyHyPosts,
  loadNewHyPosts,
  loadSelectedHyPosts,
  resolveHyContentSource,
} from '../../src/lib/content-source/hy-content-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourceFiles = [
  'src/data/posts.json',
  'src/data/migrations/content-id-registry.v1.json',
];
const sourceBytesBefore = new Map(
  sourceFiles.map((file) => [file, readFileSync(path.join(ROOT, file))]),
);

assert.equal(DEFAULT_HY_CONTENT_SOURCE, 'legacy');
const configuredSource = process.env[HY_CONTENT_SOURCE_ENV];
delete process.env[HY_CONTENT_SOURCE_ENV];
assert.equal(resolveHyContentSource(), 'legacy');
if (configuredSource === undefined) delete process.env[HY_CONTENT_SOURCE_ENV];
else process.env[HY_CONTENT_SOURCE_ENV] = configuredSource;
assert.equal(resolveHyContentSource('legacy'), 'legacy');
assert.equal(resolveHyContentSource('new'), 'new');
assert.throws(() => resolveHyContentSource(''), /must be one of legacy, new/);
assert.throws(() => resolveHyContentSource('unknown'), /must be one of legacy, new/);
assert.deepEqual(loadSelectedHyPosts('legacy'), loadLegacyHyPosts(), 'legacy selection keeps current posts.json behavior');

const legacy = loadLegacyHyPosts();
const fromStore = loadNewHyPosts();
assert.equal(legacy.length, 5800);
assert.equal(fromStore.length, 5800);
assert.equal(loadSelectedHyPosts('new').length, 5800, 'new selection loads the permanent HY store');

const compatibilityFields = [
  'slug',
  'title',
  'description',
  'date',
  'letter',
  'categories',
  'content',
  'sourceUrl',
  'comments',
  'cover',
];

for (let index = 0; index < legacy.length; index += 1) {
  const oldPost = legacy[index];
  const newPost = fromStore[index];
  assert.deepEqual(
    Object.keys(newPost).sort(),
    Object.keys(oldPost).sort(),
    `post ${index} has the legacy-compatible public shape`,
  );
  for (const field of compatibilityFields) {
    assert.deepEqual(newPost[field], oldPost[field], `post ${index} ${field} parity`);
  }
  assert.equal(newPost.sourceUrl, oldPost.sourceUrl, `post ${index} sourceUrl provenance parity`);
  assert.deepEqual(newPost.comments, oldPost.comments, `post ${index} comments are the read-only legacy bridge`);
  assert.equal('content_id' in newPost, false, `post ${index} does not expose content_id`);
}

assert.ok(isDeepStrictEqual(fromStore, legacy), 'new HY compatibility adapter differs from legacy post shape');

for (const file of sourceFiles) {
  assert.deepEqual(
    readFileSync(path.join(ROOT, file)),
    sourceBytesBefore.get(file),
    `${file} was not mutated`,
  );
}

console.log('HY content source selector PASS');
console.log(JSON.stringify({
  environment_variable: HY_CONTENT_SOURCE_ENV,
  active_source: HY_CONTENT_SOURCE,
  default_source: DEFAULT_HY_CONTENT_SOURCE,
  absent: DEFAULT_HY_CONTENT_SOURCE,
  explicit_legacy: resolveHyContentSource('legacy'),
  explicit_new: resolveHyContentSource('new'),
  invalid_value: 'hard failure',
  legacy_posts: legacy.length,
  new_posts: fromStore.length,
  exact_compatibility_shape: true,
  compatibility_fields: compatibilityFields,
  comments_bridge: 'legacy posts.json by registry sourceUrl; read-only',
  source_data_mutated: false,
}, null, 2));
