import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import {
  getContentRecord,
  getLocaleDocument,
  listContentRecords,
  MultilingualStoreValidationError,
  scanContentStore,
} from '../../src/lib/content-source/multilingual-store.mjs';
import { hyBaselineInventory } from './verify-hy-store.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const V7 = '01990c84-9c78-7abc-8def-123456789abc';
const roots = [];

function payload(locale, slug, fingerprint, overrides = {}) {
  return {
    slug,
    title: `${locale} title`,
    description: null,
    content: `<p>${locale} content</p>`,
    image_alts: {},
    tags: [locale],
    alphabet_key: null,
    based_on_source_revision: locale === 'hy' ? null : 1,
    based_on_source_fingerprint: locale === 'hy' ? null : fingerprint,
    ...overrides,
  };
}

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-multilingual-store-'));
  roots.push(root);
  return root;
}

function write(root, relative, value) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function documents(id, { ru = null, en = null } = {}) {
  const hyPublished = { ...payload('hy', `hy-${id.slice(0, 8)}`, null), version: 1, published_at: '2026-09-14' };
  const item = {
    schema_version: 1,
    content_id: id,
    type: 'dream_dictionary',
    source_locale: 'hy',
    source_revision: 1,
    source_fingerprint: sourceFingerprintV1(hyPublished),
    fingerprint_spec_version: 1,
  };
  return {
    item,
    hy: { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hyPublished },
    ru: ru && { schema_version: 1, content_id: id, locale: 'ru', ...ru(item.source_fingerprint) },
    en: en && { schema_version: 1, content_id: id, locale: 'en', ...en(item.source_fingerprint) },
  };
}

function addRecord(root, id, options = {}, shard = id.slice(0, 2)) {
  const record = documents(id, options);
  const directory = `${shard}/${id}`;
  write(root, `${directory}/item.json`, record.item);
  write(root, `${directory}/hy.json`, record.hy);
  if (record.ru) write(root, `${directory}/ru.json`, record.ru);
  if (record.en) write(root, `${directory}/en.json`, record.en);
  return record;
}

function draft(locale, slug, overrides = {}) {
  return (fingerprint) => ({ draft: payload(locale, slug, fingerprint, overrides), published: null });
}

function published(locale, slug, overrides = {}) {
  return (fingerprint) => ({ draft: null, published: { ...payload(locale, slug, fingerprint, overrides), version: 1, published_at: '2026-09-14' } });
}

function both(locale, draftSlug, publishedSlug) {
  return (fingerprint) => ({
    draft: payload(locale, draftSlug, fingerprint),
    published: { ...payload(locale, publishedSlug, fingerprint), version: 1, published_at: '2026-09-14' },
  });
}

function assertFailure(action, code) {
  assert.throws(action, (error) => error instanceof MultilingualStoreValidationError && error.code === code);
}

function failure(action, code) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof MultilingualStoreValidationError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected ${code}`);
}

try {
  {
    const root = fixtureRoot();
    addRecord(root, A);
    const repository = scanContentStore(root);
    assert.equal(repository.counts.logical_records, 1);
    assert.equal(repository.counts.hy_documents, 1);
    assert.equal(repository.counts.ru_documents, 0);
    assert.equal(getContentRecord(repository, A)?.item.content_id, A);
    assert.equal(getLocaleDocument(repository, A, 'ru'), null);
    assert.deepEqual(listContentRecords(repository).map((record) => record.content_id), [A]);
  }
  {
    const root = fixtureRoot();
    addRecord(root, V7);
    const repository = scanContentStore(root);
    assert.equal(getContentRecord(repository, V7)?.content_id, V7, 'UUIDv7 directory and documents are accepted');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: draft('ru', 'ru-draft') });
    const repository = scanContentStore(root);
    assert.equal(repository.counts.ru_documents, 1);
    assert.equal(getLocaleDocument(repository, A, 'ru')?.draft.slug, 'ru-draft');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: published('ru', 'ru-published') });
    assert.equal(scanContentStore(root).counts.ru_documents, 1);
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { en: draft('en', 'en-draft') });
    assert.equal(scanContentStore(root).counts.en_documents, 1);
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: both('ru', 'ru-draft', 'ru-published'), en: published('en', 'en-published') });
    const repository = scanContentStore(root);
    assert.equal(repository.counts.total_files, 4);
    assert.equal(repository.counts.ru_documents, 1);
    assert.equal(repository.counts.en_documents, 1);
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A, { ru: draft('ru', 'mismatch') });
    record.ru.locale = 'en';
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    const error = failure(() => scanContentStore(root), 'INVALID_LOCALE_DOCUMENT');
    assert.equal(error.context.content_id, A);
    assert.equal(error.context.locale, 'ru');
    assert.match(error.context.path, /ru\.json$/);
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A, { ru: draft('ru', 'bad-locale') });
    record.ru.locale = 'de';
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    assertFailure(() => scanContentStore(root), 'INVALID_LOCALE_DOCUMENT');
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A, { ru: draft('ru', 'wrong-id') });
    record.ru.content_id = B;
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    const error = failure(() => scanContentStore(root), 'INVALID_LOCALE_DOCUMENT');
    assert.equal(error.context.content_id, A);
    assert.equal(error.context.locale, 'ru');
    assert.match(error.context.path, /ru\.json$/);
  }
  {
    const root = fixtureRoot();
    addRecord(root, 'not-a-uuid', {}, 'aa');
    const error = failure(() => scanContentStore(root), 'INVALID_CONTENT_ID');
    assert.equal(error.context.content_id, 'not-a-uuid');
    assert.match(error.context.path, /not-a-uuid$/);
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, {}, 'ff');
    assertFailure(() => scanContentStore(root), 'SHARD_MISMATCH');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A);
    write(root, `${A.slice(0, 2)}/${A}/unknown.json`, '{}\n');
    assertFailure(() => scanContentStore(root), 'UNEXPECTED_CONTENT_ENTRY');
  }
  {
    for (const filename of ['ru-RU.json', 'english.json', 'armenian.json', 'foo.json', 'backup.json', 'notes.txt']) {
      const root = fixtureRoot();
      addRecord(root, A);
      write(root, `${A.slice(0, 2)}/${A}/${filename}`, '{}\n');
      assertFailure(() => scanContentStore(root), 'UNEXPECTED_CONTENT_ENTRY');
    }
  }
  {
    const root = fixtureRoot();
    addRecord(root, A);
    mkdirSync(path.join(root, A.slice(0, 2), A, 'nested'));
    assertFailure(() => scanContentStore(root), 'UNEXPECTED_CONTENT_ENTRY');
  }
  {
    const root = fixtureRoot();
    const record = documents(A);
    write(root, `${A.slice(0, 2)}/${A}/hy.json`, record.hy);
    assertFailure(() => scanContentStore(root), 'MISSING_REQUIRED_DOCUMENT');
  }
  {
    const root = fixtureRoot();
    const record = documents(A);
    write(root, `${A.slice(0, 2)}/${A}/item.json`, record.item);
    assertFailure(() => scanContentStore(root), 'MISSING_REQUIRED_DOCUMENT');
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A);
    delete record.item.type;
    write(root, `${A.slice(0, 2)}/${A}/item.json`, record.item);
    assertFailure(() => scanContentStore(root), 'INVALID_ITEM_DOCUMENT');
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A);
    delete record.hy.published.version;
    write(root, `${A.slice(0, 2)}/${A}/hy.json`, record.hy);
    assertFailure(() => scanContentStore(root), 'INVALID_LOCALE_DOCUMENT');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: published('ru', 'collision') });
    addRecord(root, B, { ru: published('ru', 'collision') });
    assertFailure(() => scanContentStore(root), 'ACTIVE_SLUG_COLLISION');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: both('ru', 'new-slug', 'old-slug') });
    assert.equal(scanContentStore(root).counts.logical_records, 1);
    addRecord(root, B, { ru: draft('ru', 'new-slug') });
    assertFailure(() => scanContentStore(root), 'ACTIVE_SLUG_COLLISION');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: published('ru', 'collision') });
    addRecord(root, B, { ru: draft('ru', 'collision') });
    assertFailure(() => scanContentStore(root), 'ACTIVE_SLUG_COLLISION');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: draft('ru', 'collision') });
    addRecord(root, B, { ru: draft('ru', 'collision') });
    assertFailure(() => scanContentStore(root), 'ACTIVE_SLUG_COLLISION');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A, { ru: published('ru', 'same-slug') });
    addRecord(root, B, { en: published('en', 'same-slug') });
    assert.equal(scanContentStore(root).counts.logical_records, 2);
  }
  {
    const root = fixtureRoot();
    const source = addRecord(root, A, { ru: published('ru', 'outdated', { based_on_source_revision: 2 }) });
    const repository = scanContentStore(root);
    const translation = getLocaleDocument(repository, A, 'ru');
    assert.equal(translation.published.slug, 'outdated');
    assert.equal(deriveTranslationState(translation, source.item).state, 'OUTDATED');
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A, { ru: published('ru', 'safe-published') });
    record.ru.published.slug = 'a%2Fb';
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    const error = failure(() => scanContentStore(root), 'INVALID_ACTIVE_SLUG');
    assert.equal(error.context.content_id, A);
    assert.equal(error.context.locale, 'ru');
    assert.match(error.context.path, /ru\.json$/);
    assert.match(error.message, /published slug is invalid/);
    assert.ok(error.cause instanceof Error);
  }
  {
    const root = fixtureRoot();
    const record = addRecord(root, A, { ru: draft('ru', 'safe-draft') });
    record.ru.draft.slug = 'a/b';
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    const error = failure(() => scanContentStore(root), 'INVALID_ACTIVE_SLUG');
    assert.equal(error.context.content_id, A);
    assert.equal(error.context.locale, 'ru');
    assert.match(error.context.path, /ru\.json$/);
    assert.match(error.message, /draft slug is invalid/);
  }
  {
    const root = fixtureRoot();
    addRecord(root, V7, { ru: draft('ru', 'v7-ru'), en: published('en', 'v7-en') });
    const repository = scanContentStore(root);
    assert.equal(getLocaleDocument(repository, V7, 'hy')?.locale, 'hy');
    assert.equal(getLocaleDocument(repository, V7, 'ru')?.locale, 'ru');
    assert.equal(getLocaleDocument(repository, V7, 'en')?.locale, 'en');
  }
  {
    const root = fixtureRoot();
    addRecord(root, V7);
    addRecord(root, A);
    addRecord(root, B);
    const first = listContentRecords(scanContentStore(root)).map((record) => record.content_id);
    const second = listContentRecords(scanContentStore(root)).map((record) => record.content_id);
    assert.deepEqual(first, [...first].sort((a, b) => a.localeCompare(b, 'en')));
    assert.deepEqual(second, first);
  }
  {
    const root = fixtureRoot();
    addRecord(root, A);
    const baseline = hyBaselineInventory(root).sha256;
    const ru = documents(A, { ru: draft('ru', 'baseline-ru') }).ru;
    write(root, `${A.slice(0, 2)}/${A}/ru.json`, ru);
    assert.equal(hyBaselineInventory(root).sha256, baseline, 'valid RU does not alter HY baseline inventory');
    const en = documents(A, { en: draft('en', 'baseline-en') }).en;
    write(root, `${A.slice(0, 2)}/${A}/en.json`, en);
    assert.equal(hyBaselineInventory(root).sha256, baseline, 'valid EN does not alter HY baseline inventory');
    write(root, `${A.slice(0, 2)}/${A}/hy.json`, '{"changed":true}\n');
    assert.notEqual(hyBaselineInventory(root).sha256, baseline, 'HY changes alter HY baseline inventory');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A);
    const baseline = hyBaselineInventory(root).sha256;
    write(root, `${A.slice(0, 2)}/${A}/item.json`, '{"changed":true}\n');
    assert.notEqual(hyBaselineInventory(root).sha256, baseline, 'item changes alter HY baseline inventory');
  }
  {
    const root = fixtureRoot();
    addRecord(root, A);
    // Required HY documents remain mandatory even when future translations exist.
    rmSync(path.join(root, A.slice(0, 2), A, 'hy.json'));
    assertFailure(() => scanContentStore(root), 'MISSING_REQUIRED_DOCUMENT');
  }
  console.log('MULTILINGUAL STORE SCANNER PASS');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
