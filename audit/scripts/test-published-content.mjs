import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import {
  getPublishedLocaleEntry,
  listPublishedLocaleEntries,
  listPublishedLocalesForContent,
} from '../../src/lib/content-source/published-content.mjs';
import { MultilingualStoreValidationError, scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';

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

function draft(locale, slug) {
  return (fingerprint) => ({ draft: payload(locale, slug, fingerprint), published: null });
}

function published(locale, slug, overrides = {}) {
  return (fingerprint) => ({
    draft: null,
    published: { ...payload(locale, slug, fingerprint, overrides), version: 1, published_at: '2026-09-14' },
  });
}

function both(locale, draftSlug, publishedSlug) {
  return (fingerprint) => ({
    draft: payload(locale, draftSlug, fingerprint),
    published: { ...payload(locale, publishedSlug, fingerprint), version: 1, published_at: '2026-09-14' },
  });
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

function root() {
  const value = mkdtempSync(path.join(tmpdir(), 'erazahan-published-content-'));
  roots.push(value);
  return value;
}

function write(rootPath, relative, value) {
  const target = path.join(rootPath, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function addRecord(rootPath, id, options = {}) {
  const record = documents(id, options);
  const directory = `${id.slice(0, 2)}/${id}`;
  write(rootPath, `${directory}/item.json`, record.item);
  write(rootPath, `${directory}/hy.json`, record.hy);
  if (record.ru) write(rootPath, `${directory}/ru.json`, record.ru);
  if (record.en) write(rootPath, `${directory}/en.json`, record.en);
  return record;
}

try {
  { // A: HY only; missing translations do not fall back.
    const fixture = root();
    addRecord(fixture, A);
    const repository = scanContentStore(fixture);
    assert.equal(getPublishedLocaleEntry(repository, A, 'hy').path, `/hy-${A.slice(0, 8)}/`);
    assert.equal(getPublishedLocaleEntry(repository, A, 'ru'), null);
    assert.equal(getPublishedLocaleEntry(repository, A, 'en'), null);
    assert.deepEqual(listPublishedLocalesForContent(repository, A), ['hy']);
  }
  { // B: draft-only RU is never public.
    const fixture = root();
    addRecord(fixture, A, { ru: draft('ru', 'ru-draft') });
    const repository = scanContentStore(fixture);
    assert.equal(getPublishedLocaleEntry(repository, A, 'ru'), null);
    assert.deepEqual(listPublishedLocaleEntries(repository, 'ru'), []);
    assert.deepEqual(listPublishedLocalesForContent(repository, A), ['hy']);
  }
  { // C/D/E: canonical locale order only includes published documents.
    const fixture = root();
    addRecord(fixture, A, { ru: published('ru', 'ru-published'), en: published('en', 'en-published') });
    const repository = scanContentStore(fixture);
    const ruEntry = getPublishedLocaleEntry(repository, A, 'ru');
    assert.equal(ruEntry.path, '/ru/ru-published/');
    assert.equal(ruEntry.freshness, 'CURRENT');
    assert.equal(getPublishedLocaleEntry(repository, A, 'en').path, '/en/en-published/');
    assert.deepEqual(listPublishedLocalesForContent(repository, A), ['hy', 'ru', 'en']);
  }
  { // F: published payload/path are isolated from a newer editorial draft.
    const fixture = root();
    const record = addRecord(fixture, A, { ru: both('ru', 'secret-new-slug', 'public-old-slug') });
    record.ru.published.title = 'Published title';
    record.ru.published.content = 'Published content';
    record.ru.draft.title = 'SECRET DRAFT TITLE';
    record.ru.draft.content = 'SECRET DRAFT CONTENT';
    write(fixture, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    const entry = getPublishedLocaleEntry(scanContentStore(fixture), A, 'ru');
    assert.equal(entry.slug, 'public-old-slug');
    assert.equal(entry.path, '/ru/public-old-slug/');
    assert.equal(entry.published.slug, 'public-old-slug');
    assert.equal(Object.hasOwn(entry, 'draft'), false);
    const serialized = JSON.stringify(entry);
    for (const secret of ['secret-new-slug', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) {
      assert.equal(serialized.includes(secret), false, `${secret} must not leak`);
    }
    for (const publishedValue of ['public-old-slug', 'Published title', 'Published content']) {
      assert.equal(serialized.includes(publishedValue), true, `${publishedValue} must remain public`);
    }
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.published), true);
  }
  { // G/H: published outdated stays public; draft-only remains excluded.
    const fixture = root();
    addRecord(fixture, A, {
      ru: published('ru', 'outdated', { based_on_source_revision: 2 }),
      en: draft('en', 'en-draft'),
    });
    const repository = scanContentStore(fixture);
    assert.equal(getPublishedLocaleEntry(repository, A, 'ru').freshness, 'OUTDATED');
    assert.equal(getPublishedLocaleEntry(repository, A, 'en'), null);
  }
  {
    const fixture = root();
    addRecord(fixture, A, {
      ru: published('ru', 'fingerprint-outdated', { based_on_source_fingerprint: '0'.repeat(64) }),
    });
    const entry = getPublishedLocaleEntry(scanContentStore(fixture), A, 'ru');
    assert.equal(entry.freshness, 'OUTDATED');
    assert.equal(entry.slug, 'fingerprint-outdated');
  }
  { // I: EN cannot satisfy an RU request.
    const fixture = root();
    addRecord(fixture, A, { ru: draft('ru', 'ru-draft'), en: published('en', 'en-only') });
    const repository = scanContentStore(fixture);
    assert.equal(getPublishedLocaleEntry(repository, A, 'ru'), null);
    assert.equal(getPublishedLocaleEntry(repository, A, 'en').slug, 'en-only');
    assert.deepEqual(listPublishedLocalesForContent(repository, A), ['hy', 'en']);
  }
  {
    const fixture = root();
    addRecord(fixture, A, { ru: published('ru', 'current-ru') });
    addRecord(fixture, B, { ru: draft('ru', 'draft-only-ru') });
    addRecord(fixture, V7, { ru: published('ru', 'outdated-ru', { based_on_source_revision: 2 }) });
    const enOnly = '11111111-1111-5111-8111-111111111111';
    addRecord(fixture, enOnly, { en: published('en', 'en-only') });
    const entries = listPublishedLocaleEntries(scanContentStore(fixture), 'ru');
    assert.deepEqual(entries.map((entry) => entry.content_id), [V7, A]);
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.content_id === A)?.freshness, 'CURRENT');
    assert.equal(entries.find((entry) => entry.content_id === V7)?.freshness, 'OUTDATED');
    assert.equal(entries.some((entry) => entry.content_id === B), false);
    assert.equal(entries.some((entry) => entry.content_id === enOnly), false);
  }
  {
    const fixture = root();
    const record = addRecord(fixture, A, { ru: published('ru', 'safe-ru') });
    record.ru.published.slug = 'a%2Fb';
    write(fixture, `${A.slice(0, 2)}/${A}/ru.json`, record.ru);
    assert.throws(
      () => scanContentStore(fixture),
      (error) => error instanceof MultilingualStoreValidationError && error.code === 'INVALID_ACTIVE_SLUG',
    );
  }
  {
    const fixture = root();
    addRecord(fixture, B);
    addRecord(fixture, A);
    addRecord(fixture, V7);
    const repository = scanContentStore(fixture);
    const entries = listPublishedLocaleEntries(repository, 'hy');
    assert.deepEqual(entries.map((entry) => entry.content_id), [V7, B, A]);
    assert.equal(getPublishedLocaleEntry(repository, 'not-a-uuid', 'hy'), null);
    assert.equal(getPublishedLocaleEntry(repository, '01990c84-9c78-7abc-8def-123456789abd', 'hy'), null);
    assert.throws(() => getPublishedLocaleEntry(repository, A, 'fr'));
    assert.throws(() => listPublishedLocaleEntries(repository, 'ru-RU'));
  }
  console.log('PUBLISHED CONTENT RESOLVER PASS');
} finally {
  for (const fixture of roots) rmSync(fixture, { recursive: true, force: true });
}
