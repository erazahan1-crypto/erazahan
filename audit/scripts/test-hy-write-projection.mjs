import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import {
  HyWriteProjectionError,
  hyStorePaths,
  projectExistingHyPostUpdate,
  resolveExistingHyIdentity,
} from '../../src/lib/content-write/project-hy-post.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSTS_PATH = path.join(ROOT, 'src', 'data', 'posts.json');
const REGISTRY_PATH = path.join(ROOT, 'src', 'data', 'migrations', 'content-id-registry.v1.json');
const CONTENT_ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';

function editFrom(post, overrides = {}) {
  return {
    slug: post.slug,
    title: post.title,
    date: post.date,
    letter: post.letter,
    categories: [...post.categories],
    content: post.content,
    sourceUrl: post.sourceUrl,
    ...overrides,
  };
}

function canonicalCheckoutBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function fixture() {
  const published = {
    slug: 'example-dream',
    title: 'Example dream',
    description: 'Preserved description',
    content: '<p>Example content</p>',
    image_alts: { 'asset:one': 'Preserved alt' },
    tags: ['One', 'Two'],
    alphabet_key: 'Ե',
    based_on_source_revision: null,
    based_on_source_fingerprint: null,
    updated_at: '2026-09-12T20:00:00Z',
    generation: { kind: 'human', generated_at: '2026-09-12T20:00:00Z' },
    version: 3,
    published_at: '2026-09-12',
  };
  const currentPost = {
    slug: published.slug,
    title: published.title,
    date: published.published_at,
    letter: published.alphabet_key,
    categories: [...published.tags],
    content: published.content,
    sourceUrl: 'https://erazahan.info/example-dream/',
    comments: [{ id: 'comment-1', content: 'Preserved comment' }],
    cover: '/uploads/example.webp',
  };
  const currentItem = {
    schema_version: 1,
    content_id: CONTENT_ID,
    type: 'dream_dictionary',
    source_locale: 'hy',
    source_revision: 7,
    source_fingerprint: sourceFingerprintV1(published),
    fingerprint_spec_version: 1,
  };
  const currentHy = {
    schema_version: 1,
    content_id: CONTENT_ID,
    locale: 'hy',
    draft: null,
    published,
  };
  const registryEntries = [{
    content_id: CONTENT_ID,
    legacy: {
      original_array_index: 4,
      original_hy_slug: 'example-dream',
      original_source_url: currentPost.sourceUrl,
    },
    migration: { version: 1 },
  }];
  const paths = hyStorePaths(CONTENT_ID);
  return {
    postIndex: 4,
    currentPost,
    editedPost: editFrom(currentPost),
    registryEntries,
    currentItem,
    currentHy,
    itemPath: paths.item,
    hyPath: paths.hy,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => error instanceof HyWriteProjectionError && error.code === code);
}

const valid = fixture();
const registryBefore = JSON.stringify(valid.registryEntries);
assert.equal(resolveExistingHyIdentity(valid).contentId, CONTENT_ID);
assert.equal(JSON.stringify(valid.registryEntries), registryBefore, 'registry remains immutable');
expectCode('REGISTRY_IDENTITY_MISSING', () => resolveExistingHyIdentity({ ...fixture(), registryEntries: [] }));
expectCode('REGISTRY_IDENTITY_MISSING', () => resolveExistingHyIdentity({ ...fixture(), postIndex: 5 }));
expectCode('REGISTRY_IDENTITY_AMBIGUOUS', () => {
  const input = fixture();
  resolveExistingHyIdentity({ ...input, registryEntries: [...input.registryEntries, structuredClone(input.registryEntries[0])] });
});
expectCode('INVALID_POST_INDEX', () => resolveExistingHyIdentity({ ...fixture(), postIndex: -1 }));
expectCode('CURRENT_SOURCE_URL_MISMATCH', () => {
  const input = fixture();
  resolveExistingHyIdentity({ ...input, currentPost: { ...input.currentPost, sourceUrl: 'https://erazahan.info/wrong/' } });
});
expectCode('SOURCE_URL_IMMUTABLE', () => {
  const input = fixture();
  resolveExistingHyIdentity({ ...input, editedPost: editFrom(input.currentPost, { sourceUrl: 'https://erazahan.info/changed/' }) });
});
expectCode('CONTENT_ID_MISMATCH', () => {
  const input = fixture();
  const wrongId = 'cadd4552-097e-5845-b59e-223c36c82488';
  resolveExistingHyIdentity({ ...input, currentItem: { ...input.currentItem, content_id: wrongId } });
});
expectCode('STORE_PATH_MISMATCH', () => resolveExistingHyIdentity({ ...fixture(), itemPath: `src/data/content/dreams/ff/${CONTENT_ID}/item.json` }));

function project(overrides = {}) {
  const input = fixture();
  return projectExistingHyPostUpdate({ ...input, editedPost: editFrom(input.currentPost, overrides) });
}

const cases = [
  ['title', { title: 'Changed title' }, true, true],
  ['content', { content: '<p>Changed content</p>' }, true, true],
  ['category membership', { categories: ['One', 'Two', 'Three'] }, true, true],
  ['category order only', { categories: ['Two', 'One'] }, false, true],
  ['slug only', { slug: 'changed-slug' }, false, true],
  ['letter only', { letter: 'Ա' }, false, true],
  ['date only', { date: '2026-09-13' }, false, true],
  ['combined semantic', { title: 'Combined', content: '<p>Combined</p>', categories: ['Three'] }, true, true],
];
for (const [label, overrides, semanticChanged, publishedChanged] of cases) {
  const result = project(overrides);
  assert.equal(result.changes.semanticFingerprintChanged, semanticChanged, `${label}: semantic classification`);
  assert.equal(result.changes.publishedPayloadChanged, publishedChanged, `${label}: published classification`);
  assert.equal(result.updatedItem.source_revision, 7 + Number(semanticChanged), `${label}: source revision`);
  assert.equal(result.updatedHy.published.version, 3 + Number(publishedChanged), `${label}: published version`);
  assert.equal(result.changes.noOp, false, `${label}: not a no-op`);
}

const preserved = project({ title: 'Changed title' });
assert.deepEqual(preserved.updatedPost.comments, valid.currentPost.comments, 'comments preserved in posts.json');
assert.equal(preserved.updatedPost.cover, valid.currentPost.cover, 'cover preserved in posts.json');
assert.equal('comments' in preserved.updatedHy.published, false, 'comments not projected');
assert.equal('cover' in preserved.updatedHy.published, false, 'cover not projected');
for (const field of ['description', 'image_alts', 'updated_at', 'generation']) {
  assert.deepEqual(preserved.updatedHy.published[field], valid.currentHy.published[field], `${field} preserved`);
}

const noOp = project();
assert.deepEqual(noOp.changes, {
  legacyPostChanged: false,
  itemChanged: false,
  hyChanged: false,
  semanticFingerprintChanged: false,
  publishedPayloadChanged: false,
  noOp: true,
});
assert.equal(noOp.updatedItem.source_revision, 7);
assert.equal(noOp.updatedHy.published.version, 3);

function projectWithContent(currentContent, submittedContent) {
  const input = fixture();
  input.currentPost = { ...input.currentPost, content: currentContent };
  input.currentHy = {
    ...input.currentHy,
    published: { ...input.currentHy.published, content: currentContent },
  };
  input.currentItem = {
    ...input.currentItem,
    source_fingerprint: sourceFingerprintV1(input.currentHy.published),
  };
  return projectExistingHyPostUpdate({
    ...input,
    editedPost: editFrom(input.currentPost, { content: submittedContent }),
  });
}

const crlfNoOp = projectWithContent('a\r\nb', 'a\nb');
assert.equal(crlfNoOp.updatedPost.content, 'a\r\nb', 'CRLF no-op restores stored bytes');
assert.equal(crlfNoOp.updatedHy.published.content, 'a\r\nb', 'CRLF HY no-op restores stored bytes');
assert.equal(crlfNoOp.changes.noOp, true, 'CRLF browser normalization is a no-op');
assert.equal(crlfNoOp.updatedItem.source_revision, 7, 'CRLF no-op keeps source revision');
assert.equal(crlfNoOp.updatedHy.published.version, 3, 'CRLF no-op keeps published version');

const crlfEdit = projectWithContent('a\r\nb', 'a\nB');
assert.equal(crlfEdit.updatedPost.content, 'a\r\nB', 'CRLF edit restores stored newline style');
assert.equal(crlfEdit.updatedHy.published.content, 'a\r\nB', 'CRLF edit projects stored newline style');
assert.equal(crlfEdit.changes.semanticFingerprintChanged, true, 'CRLF edit changes fingerprint');
assert.equal(crlfEdit.updatedItem.source_revision, 8, 'CRLF edit increments source revision once');
assert.equal(crlfEdit.updatedHy.published.version, 4, 'CRLF edit increments published version once');

const lfNoOp = projectWithContent('a\nb', 'a\nb');
assert.equal(lfNoOp.changes.noOp, true, 'LF no-op remains exact');
const lfEdit = projectWithContent('a\nb', 'a\r\nB');
assert.equal(lfEdit.updatedPost.content, 'a\nB', 'LF records retain LF style');

const noBreakEdit = projectWithContent('single line', 'single\r\nline');
assert.equal(noBreakEdit.updatedPost.content, 'single\nline', 'no-break records keep browser LF for introduced lines');

for (const unsupported of ['a\rb', 'a\r\nb\nc']) {
  const input = fixture();
  input.currentPost = { ...input.currentPost, content: unsupported };
  input.currentHy = { ...input.currentHy, published: { ...input.currentHy.published, content: unsupported } };
  input.currentItem = { ...input.currentItem, source_fingerprint: sourceFingerprintV1(input.currentHy.published) };
  expectCode('UNSUPPORTED_NEWLINE_STYLE', () => projectExistingHyPostUpdate({
    ...input,
    editedPost: editFrom(input.currentPost),
  }));
}

const post110Before = '<strong>Երազահան Զամբյուղ Պատրաստել</strong>\r\n<h3><span>Երազում զամբյուղ պատրաստել նշանակում է - Անօգուտ աշխատանք:</span></h3>';
const post110Submitted = '<strong>Երազահան Զամբյուղ Պատրաստել</strong>\n<h3><span>Երազում զամբյուղ պատրաստել նշանակում է - Անօգուտ աշխատանք։</span></h3>';
const post110 = fixture();
post110.currentPost = {
  slug: 'erazahan-zambyux-patrastel', title: 'Երազահան Զամբյուղ Պատրաստել', date: '2016-09-12', letter: 'Զ',
  categories: ['Երազներ սկսող Զ տառով'], content: post110Before,
  sourceUrl: 'https://erazahan.info/erazahan-zambyux-patrastel/', comments: [],
};
post110.registryEntries[0] = {
  ...post110.registryEntries[0],
  legacy: {
    original_array_index: post110.postIndex,
    original_hy_slug: post110.currentPost.slug,
    original_source_url: post110.currentPost.sourceUrl,
  },
};
post110.editedPost = editFrom(post110.currentPost, { content: post110Submitted });
post110.currentHy = {
  ...post110.currentHy,
  published: {
    slug: post110.currentPost.slug, title: post110.currentPost.title, description: null, content: post110Before,
    image_alts: {}, tags: [...post110.currentPost.categories], alphabet_key: post110.currentPost.letter,
    based_on_source_revision: null, based_on_source_fingerprint: null, version: 1, published_at: post110.currentPost.date,
  },
};
post110.currentItem = { ...post110.currentItem, source_revision: 1, source_fingerprint: sourceFingerprintV1(post110.currentHy.published) };
const post110Result = projectExistingHyPostUpdate(post110);
assert.equal(post110Result.updatedPost.content, post110Submitted.replace(/\n/g, '\r\n'), 'post 110 retains CRLF');
assert.equal(post110Result.updatedItem.source_fingerprint, '1977b25195cfd7e8631cd9efb99db9523ae332f5b7b3b381d36be0019748ab3c', 'post 110 fingerprint uses CRLF content');

expectCode('CURRENT_FINGERPRINT_DRIFT', () => {
  const input = fixture();
  projectExistingHyPostUpdate({ ...input, currentItem: { ...input.currentItem, source_fingerprint: 'a'.repeat(64) } });
});
expectCode('CURRENT_PROJECTION_DRIFT', () => {
  const input = fixture();
  projectExistingHyPostUpdate({ ...input, currentPost: { ...input.currentPost, title: 'Drifted title' }, editedPost: editFrom(input.currentPost) });
});
expectCode('UNSUPPORTED_HY_STATE', () => {
  const input = fixture();
  projectExistingHyPostUpdate({ ...input, currentHy: { ...input.currentHy, draft: { ...input.currentHy.published, version: undefined, published_at: undefined } } });
});

function translation(item) {
  return {
    schema_version: 1,
    content_id: CONTENT_ID,
    locale: 'ru',
    draft: null,
    published: {
      slug: 'ru-example',
      title: 'RU title',
      description: null,
      content: '<p>RU content</p>',
      image_alts: {},
      tags: ['RU'],
      alphabet_key: null,
      based_on_source_revision: item.source_revision,
      based_on_source_fingerprint: item.source_fingerprint,
      version: 1,
      published_at: '2026-09-12',
    },
  };
}
const translationAtCurrent = translation(valid.currentItem);
assert.equal(deriveTranslationState(translationAtCurrent, preserved.updatedItem).state, 'OUTDATED');
assert.equal(deriveTranslationState(translationAtCurrent, project({ slug: 'changed-slug' }).updatedItem).state, 'CURRENT');
assert.equal(deriveTranslationState(translationAtCurrent, project({ date: '2026-09-13' }).updatedItem).state, 'CURRENT');
assert.equal(deriveTranslationState(translationAtCurrent, project({ letter: 'Ա' }).updatedItem).state, 'CURRENT');

const posts = JSON.parse(readFileSync(POSTS_PATH, 'utf8'));
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
const corpus = {
  identity: 0,
  schema: 0,
  fingerprint: 0,
  itemLogical: 0,
  hyLogical: 0,
  itemBytes: 0,
  hyBytes: 0,
  drift: 0,
};
const unexpected = [];

for (let postIndex = 0; postIndex < posts.length; postIndex += 1) {
  const currentPost = posts[postIndex];
  const registryEntry = registry.entries.find((entry) => entry.legacy.original_array_index === postIndex);
  try {
    assert.ok(registryEntry, 'registry entry exists');
    const paths = hyStorePaths(registryEntry.content_id);
    const itemFile = path.join(ROOT, ...paths.item.split('/'));
    const hyFile = path.join(ROOT, ...paths.hy.split('/'));
    const itemBytes = readFileSync(itemFile);
    const hyBytes = readFileSync(hyFile);
    const currentItem = JSON.parse(itemBytes.toString('utf8'));
    const currentHy = JSON.parse(hyBytes.toString('utf8'));
    const result = projectExistingHyPostUpdate({
      postIndex,
      currentPost,
      editedPost: editFrom(currentPost),
      registryEntries: registry.entries,
      currentItem,
      currentHy,
      itemPath: paths.item,
      hyPath: paths.hy,
    });
    corpus.identity += 1;
    corpus.schema += 1;
    corpus.fingerprint += Number(!result.changes.semanticFingerprintChanged);
    corpus.itemLogical += Number(assert.deepEqual(result.updatedItem, currentItem) === undefined);
    corpus.hyLogical += Number(assert.deepEqual(result.updatedHy, currentHy) === undefined);
    corpus.itemBytes += Number(Buffer.from(result.serialized.item, 'utf8').equals(canonicalCheckoutBytes(itemBytes)));
    corpus.hyBytes += Number(Buffer.from(result.serialized.hy, 'utf8').equals(canonicalCheckoutBytes(hyBytes)));
    corpus.drift += Number(!result.changes.noOp);
  } catch (error) {
    unexpected.push({ postIndex, message: error instanceof Error ? error.message : String(error) });
  }
}

assert.equal(posts.length, 5800);
assert.equal(registry.entries.length, 5800);
for (const [label, value] of Object.entries(corpus)) {
  if (label === 'drift') assert.equal(value, 0, `${label}: ${JSON.stringify(unexpected.slice(0, 3))}`);
  else assert.equal(value, 5800, `${label}: ${JSON.stringify(unexpected.slice(0, 3))}`);
}
assert.deepEqual(unexpected, []);

const storeFiles = readdirSync(path.join(ROOT, 'src', 'data', 'content', 'dreams'));
assert.ok(storeFiles.length > 0, 'permanent store exists');

console.log('HY WRITE PROJECTION PASS');
console.log(JSON.stringify({
  identity: `${corpus.identity}/5800`,
  schema: `${corpus.schema}/5800`,
  fingerprint: `${corpus.fingerprint}/5800`,
  item_logical: `${corpus.itemLogical}/5800`,
  hy_logical: `${corpus.hyLogical}/5800`,
  item_byte_parity: `${corpus.itemBytes}/5800`,
  hy_byte_parity: `${corpus.hyBytes}/5800`,
  unexpected_drift: corpus.drift,
}, null, 2));
