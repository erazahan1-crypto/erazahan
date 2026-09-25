import assert from 'node:assert/strict';
import { selectedHyPosts } from '../../src/lib/content-source/hy-content-source.mjs';
import { GET } from '../../src/pages/admin/posts/categories.json.ts';
import { readFile } from 'node:fs/promises';

const response = GET();
assert.equal(response.status, 200);
const categories = await response.json();
const expected = new Map();
const alphabetKeys = new Map();
for (const post of selectedHyPosts) {
  const values = Array.isArray(post.categories) ? post.categories : typeof post.categories === 'string' ? [post.categories] : [];
  for (const category of new Set(values.filter((value) => typeof value === 'string' && value.trim()))) {
    expected.set(category, (expected.get(category) || 0) + 1);
    if (typeof post.letter === 'string' && post.letter.trim()) {
      const keys = alphabetKeys.get(category) || new Set();
      keys.add(post.letter);
      alphabetKeys.set(category, keys);
    }
  }
}
const expectedCategories = [...expected].map(([name, count]) => {
  const keys = alphabetKeys.get(name);
  return {
    name,
    count,
    alphabet_key: /^Երազներ սկսող\s+.+?\s+տառով$/u.test(name) && keys?.size === 1 ? [...keys][0] : null,
  };
}).sort((left, right) =>
  left.name.localeCompare(right.name, 'hy-AM', { sensitivity: 'base' }) || left.name.localeCompare(right.name, 'en'));
assert.deepEqual(categories, expectedCategories);
const kCategory = categories.find(({ name }) => name === 'Երազներ սկսող Կ տառով');
assert.equal(kCategory?.alphabet_key, 'Կ');
assert.equal(new Set(categories.map(({ name }) => name)).size, categories.length);

const [newForm, editForm] = await Promise.all([
  readFile(new URL('../../src/pages/admin/posts/new.astro', import.meta.url), 'utf8'),
  readFile(new URL('../../src/pages/admin/posts/edit.astro', import.meta.url), 'utf8'),
]);
for (const form of [newForm, editForm]) {
  assert.match(form, /\/admin\/posts\/categories\.json/);
  assert.match(form, /data-category-search/);
  assert.match(form, /selectedCategories/);
  assert.match(form, /picker\.hidden = true|categoryPicker\.hidden = true/);
  assert.doesNotMatch(form, /data-category-create/);
}
assert.match(newForm, /categories, content/);
assert.doesNotMatch(newForm, /name="categories"/);
assert.match(editForm, /normalizeCategories\(post\.categories\)/);
assert.match(editForm, /selectedCategories\.filter\(\(value\) => value !== category\)/);
assert.match(editForm, /if \(!letter\.value\.trim\(\) && option\.alphabet_key\) letter\.value = option\.alphabet_key/);
assert.match(newForm, /if \(!letter\.value\.trim\(\) && item\.alphabet_key\) letter\.value = item\.alphabet_key/);
assert.match(editForm, /categoryPicker\.hidden = !categoryPicker\.hidden/);
assert.match(newForm, /picker\.hidden = !picker\.hidden/);
assert.doesNotMatch(editForm, /letter\.value = ''/);
assert.doesNotMatch(newForm, /letter\.value = ''/);
console.log(`ADMIN POST CATEGORIES PASS (${categories.length} canonical HY categories)`);
