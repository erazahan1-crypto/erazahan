import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HY_DREAM_ALPHABET_KEYS, normalizeHyDreamAlphabetKey } from '../../src/lib/content-schema/hy-alphabet.mjs';
import { projectHyAlphabetWordList } from '../../src/lib/content-source/hy-alphabet-projection.mjs';

const pagesBytes = readFileSync('src/data/pages.json');
const pages = JSON.parse(pagesBytes);
const posts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
const registry = JSON.parse(readFileSync('src/data/migrations/content-id-registry.v1.json', 'utf8'));
const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
const nativeSlugs = new Set(registry.entries.filter((entry) => entry.native).map((entry) => entry.native.slug));
const letterPages = pages.filter((page) => page.kind === 'letter');
const pageFor = (key) => letterPages.find((page) => normalizeHyDreamAlphabetKey(page.letter) === key);
const project = (page, extraPosts = posts, extraNativeSlugs = nativeSlugs) => projectHyAlphabetWordList({
  letter: page.letter,
  legacyWordList: page.wordList,
  posts: extraPosts,
  nativeSlugs: extraNativeSlugs,
  resolveLegacySlug: (slug) => postsBySlug.has(slug) ? slug : null,
});

assert.deepEqual(letterPages.map((page) => normalizeHyDreamAlphabetKey(page.letter)), HY_DREAM_ALPHABET_KEYS, 'shared contract matches every imported HY letter page');
assert.equal(letterPages.length, 37, 'existing HY letter route count is unchanged');

const dolphinPage = pageFor('Դ');
const dolphinWords = project(dolphinPage);
assert.deepEqual(dolphinWords.slice(0, dolphinPage.wordList.length), dolphinPage.wordList, 'legacy order remains byte-for-byte equivalent in projection order');
assert.equal(dolphinWords.filter((word) => word.slug === 'erazahan-delfin').length, 1, 'Dolphin appears exactly once under Դ');
assert.equal(dolphinWords.at(-1)?.wordText, 'Երազահան Դելֆին', 'native listing uses canonical HY title');

const legacyOnly = pageFor('Ա');
assert.deepEqual(project(legacyOnly), legacyOnly.wordList, 'a legacy-only page is unchanged');

const futureNative = { slug: 'hy-alphabet-projection-fixture', title: 'Կանոնական նոր նյութ', letter: 'Կ' };
const futurePosts = [...posts, futureNative];
const futureNativeSlugs = new Set([...nativeSlugs, futureNative.slug]);
const futureWords = project(pageFor('Կ'), futurePosts, futureNativeSlugs);
assert.equal(futureWords.filter((word) => word.slug === futureNative.slug).length, 1, 'future native article appears without a pages.json mutation');
assert.equal(project(pageFor('Դ'), futurePosts, futureNativeSlugs).some((word) => word.slug === futureNative.slug), false, 'future native article does not leak to another letter');

const nullKeyNative = { slug: 'null-key-native', title: 'Historical compatible', letter: null };
assert.equal(project(pageFor('Կ'), [...posts, nullKeyNative], new Set([...nativeSlugs, nullKeyNative.slug])).some((word) => word.slug === nullKeyNative.slug), false, 'null alphabet keys remain readable but are not projected');

const duplicateLegacyPage = { ...dolphinPage, wordList: [...dolphinPage.wordList, { slug: 'erazahan-delfin', wordText: 'Duplicate legacy ownership', wordTranslit: '' }] };
assert.equal(project(duplicateLegacyPage).filter((word) => word.slug === 'erazahan-delfin').length, 1, 'legacy/native ownership cannot duplicate a native card');
assert.deepEqual(readFileSync('src/data/pages.json'), pagesBytes, 'alphabet projection never mutates pages.json');

console.log('HY ALPHABET PROJECTION PASS');
