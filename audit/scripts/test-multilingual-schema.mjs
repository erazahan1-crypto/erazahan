import assert from 'node:assert/strict';
import {
  sourceFingerprintV1,
} from '../../src/lib/content-schema/fingerprint.mjs';
import {
  ContentSchemaValidationError,
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
  validateLocalizedPayload,
  validatePublishedPayload,
} from '../../src/lib/content-schema/schema.mjs';
import {
  deriveNextSourceStateOnPublish,
  deriveTranslationState,
  selectPublishedLocale,
} from '../../src/lib/content-schema/state.mjs';

const CONTENT_ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const OTHER_CONTENT_ID = 'cadd4552-097e-5845-b59e-223c36c82488';
const NOW = '2026-09-12T20:00:00Z';

function localizedPayload(locale, overrides = {}) {
  const translationBasis = locale === 'hy'
    ? { based_on_source_revision: null, based_on_source_fingerprint: null }
    : { based_on_source_revision: 1, based_on_source_fingerprint: 'a'.repeat(64) };
  return {
    slug: `${locale}-example`,
    title: `${locale} title`,
    description: null,
    content: `<p>${locale} content</p>`,
    image_alts: { 'cover:primary': `${locale} cover alt` },
    tags: [`${locale} tag`],
    alphabet_key: locale === 'hy' ? 'Ե' : 'E',
    ...translationBasis,
    updated_at: NOW,
    generation: { kind: 'human', generated_at: NOW },
    ...overrides,
  };
}

function publishedPayload(locale, overrides = {}) {
  return {
    ...localizedPayload(locale),
    version: 1,
    published_at: '2026-09-12',
    ...overrides,
  };
}

const hyPublished = publishedPayload('hy');
const hyFingerprint = sourceFingerprintV1(hyPublished);
const item = {
  schema_version: 1,
  content_id: CONTENT_ID,
  type: 'dream_dictionary',
  source_locale: 'hy',
  source_revision: 1,
  source_fingerprint: hyFingerprint,
  fingerprint_spec_version: 1,
};

assert.equal(validateContentItem(item), item, 'valid ContentItem accepted');
assert.throws(
  () => validateContentItem({ ...item, content_id: 'not-a-uuid' }),
  ContentSchemaValidationError,
  'invalid content_id rejected',
);

for (const locale of ['hy', 'ru', 'en']) {
  const document = {
    schema_version: 1,
    content_id: CONTENT_ID,
    locale,
    draft: localizedPayload(locale),
    published: publishedPayload(locale),
  };
  assert.equal(validateLocaleDocument(document), document, `valid ${locale.toUpperCase()} locale accepted`);
  assert.equal(validateItemLocaleRelation(item, document), true);
}

assert.throws(
  () => validateLocaleDocument({
    schema_version: 1,
    content_id: CONTENT_ID,
    locale: 'de',
    draft: null,
    published: null,
  }),
  ContentSchemaValidationError,
  'unknown locale rejected',
);
assert.throws(
  () => validateItemLocaleRelation(item, {
    schema_version: 1,
    content_id: OTHER_CONTENT_ID,
    locale: 'ru',
    draft: localizedPayload('ru'),
    published: null,
  }),
  ContentSchemaValidationError,
  'item/locale content_id mismatch rejected',
);

const draftOnlyRu = {
  schema_version: 1,
  content_id: CONTENT_ID,
  locale: 'ru',
  draft: localizedPayload('ru', {
    based_on_source_revision: item.source_revision,
    based_on_source_fingerprint: item.source_fingerprint,
  }),
  published: null,
};
assert.equal(validateLocaleDocument(draftOnlyRu), draftOnlyRu, 'draft-only locale accepted');
assert.equal(selectPublishedLocale(draftOnlyRu), null, 'draft-only locale is excluded from public selection');

const publishedOnlyEn = {
  schema_version: 1,
  content_id: CONTENT_ID,
  locale: 'en',
  draft: null,
  published: publishedPayload('en', {
    based_on_source_revision: item.source_revision,
    based_on_source_fingerprint: item.source_fingerprint,
  }),
};
assert.equal(validateLocaleDocument(publishedOnlyEn), publishedOnlyEn, 'published-only locale accepted by contract');
assert.equal(selectPublishedLocale(publishedOnlyEn), publishedOnlyEn.published, 'published snapshot selected without draft');
assert.throws(
  () => validatePublishedPayload({ ...publishedOnlyEn.published, version: 0 }, 'en'),
  ContentSchemaValidationError,
  'malformed published payload rejected',
);

const reorderedFingerprintInput = {
  generation: { generated_at: '2030-01-01T00:00:00Z', kind: 'ai', model: 'future-model' },
  updated_at: '2030-01-01T00:00:00Z',
  based_on_source_fingerprint: null,
  based_on_source_revision: null,
  alphabet_key: 'Changed navigation key',
  tags: [...hyPublished.tags].reverse(),
  image_alts: Object.fromEntries(Object.entries(hyPublished.image_alts).reverse()),
  content: hyPublished.content,
  description: hyPublished.description,
  title: hyPublished.title,
  slug: 'changed-slug',
};
assert.equal(
  sourceFingerprintV1(hyPublished),
  sourceFingerprintV1(reorderedFingerprintInput),
  'object order, tag order, slug, timestamps, AI metadata, and alphabet key do not affect fingerprint',
);

for (const [label, changed] of [
  ['title', { title: 'semantic title change' }],
  ['description', { description: 'semantic description change' }],
  ['content', { content: '<p>semantic content change</p>' }],
  ['tag', { tags: [...hyPublished.tags, 'semantic tag change'] }],
  ['ALT', { image_alts: { ...hyPublished.image_alts, 'cover:primary': 'semantic ALT change' } }],
]) {
  assert.notEqual(
    sourceFingerprintV1(hyPublished),
    sourceFingerprintV1({ ...hyPublished, ...changed }),
    `semantic ${label} change updates fingerprint`,
  );
}

const initialItem = {
  ...item,
  source_revision: 0,
  source_fingerprint: null,
};
assert.deepEqual(deriveNextSourceStateOnPublish(initialItem, hyPublished), {
  source_revision: 1,
  source_fingerprint: hyFingerprint,
  changed: true,
});
const unchangedSource = deriveNextSourceStateOnPublish(item, hyPublished);
assert.deepEqual(unchangedSource, {
  source_revision: 1,
  source_fingerprint: hyFingerprint,
  changed: false,
});
const changedSource = deriveNextSourceStateOnPublish(item, { ...hyPublished, content: '<p>new HY source</p>' });
assert.equal(changedSource.source_revision, 2, 'changed HY publish increments source revision');
assert.equal(changedSource.changed, true);

const currentRu = {
  ...draftOnlyRu,
  draft: null,
  published: publishedPayload('ru', {
    based_on_source_revision: item.source_revision,
    based_on_source_fingerprint: item.source_fingerprint,
  }),
};
assert.deepEqual(deriveTranslationState(currentRu, item), {
  state: 'CURRENT',
  publication_state: 'PUBLISHED',
  draft_synchronization: 'NOT_CREATED',
  published_synchronization: 'CURRENT',
});
const outdatedRu = {
  ...currentRu,
  published: { ...currentRu.published, based_on_source_revision: item.source_revision + 1 },
};
assert.equal(deriveTranslationState(outdatedRu, item).state, 'OUTDATED');
assert.equal(deriveTranslationState(draftOnlyRu, item).state, 'DRAFT');

const publishedWithNewDraft = {
  ...currentRu,
  draft: localizedPayload('ru', {
    based_on_source_revision: item.source_revision + 1,
    based_on_source_fingerprint: 'b'.repeat(64),
  }),
};
assert.deepEqual(deriveTranslationState(publishedWithNewDraft, item), {
  state: 'CURRENT',
  publication_state: 'PUBLISHED_WITH_DRAFT',
  draft_synchronization: 'OUTDATED',
  published_synchronization: 'CURRENT',
});

const emptyEn = {
  schema_version: 1,
  content_id: CONTENT_ID,
  locale: 'en',
  draft: null,
  published: null,
};
assert.equal(deriveTranslationState(emptyEn, item).state, 'NOT_CREATED');
assert.equal(deriveTranslationState(currentRu, item).state, 'CURRENT', 'RU state remains independent of EN');
assert.equal(deriveTranslationState(emptyEn, item).state, 'NOT_CREATED', 'EN state remains independent of RU');

assert.equal(validateLocalizedPayload(localizedPayload('hy'), 'hy').title, 'hy title');

console.log('multilingual schema v1: validators, fingerprint, source revision, translation state, and draft exclusion PASS');
