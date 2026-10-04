import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { publicPathFor } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { listPublishedLocaleEntries } from '../../src/lib/content-source/published-content.mjs';
import { listPublishedSearchEntries, projectPublishedSearchEntry } from '../../src/lib/content-source/published-search.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { plainTextFromPostContent } from '../../src/lib/render-post-content.ts';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';
const roots = [];

function payload(locale, slug, fingerprint, overrides = {}) {
  return {
    slug, title: `${locale} title`, description: null, content: `<p>${locale} content</p>`,
    image_alts: {}, tags: [locale], alphabet_key: locale === 'hy' ? 'Հ' : null,
    based_on_source_revision: locale === 'hy' ? null : 1,
    based_on_source_fingerprint: locale === 'hy' ? null : fingerprint,
    ...overrides,
  };
}

function published(locale, slug, overrides = {}) {
  return (fingerprint) => ({ draft: null, published: { ...payload(locale, slug, fingerprint, overrides), version: 1, published_at: '2026-09-14' } });
}

function draft(locale, slug, overrides = {}) {
  return (fingerprint) => ({ draft: payload(locale, slug, fingerprint, overrides), published: null });
}

function both(locale, draftSlug, publishedSlug, overrides = {}) {
  return (fingerprint) => ({
    draft: payload(locale, draftSlug, fingerprint, { title: 'SECRET DRAFT TITLE', content: 'SECRET DRAFT CONTENT' }),
    published: { ...payload(locale, publishedSlug, fingerprint, overrides), version: 1, published_at: '2026-09-14' },
  });
}

function root() {
  const value = mkdtempSync(path.join(tmpdir(), 'erazahan-multilingual-search-'));
  roots.push(value);
  return value;
}

function write(rootPath, relative, value) {
  const target = path.join(rootPath, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function add(rootPath, id, { ru = null, en = null, hySlug = `hy-${id.slice(0, 8)}`, hyOverrides = {} } = {}) {
  const hy = { ...payload('hy', hySlug, null, hyOverrides), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: id, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hy), fingerprint_spec_version: 1 };
  const base = `${id.slice(0, 2)}/${id}`;
  write(rootPath, `${base}/item.json`, item);
  write(rootPath, `${base}/hy.json`, { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hy });
  if (ru) write(rootPath, `${base}/ru.json`, { schema_version: 1, content_id: id, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(rootPath, `${base}/en.json`, { schema_version: 1, content_id: id, locale: 'en', ...en(item.source_fingerprint) });
}

function fields(entries) {
  return entries.map((entry) => Object.keys(entry).sort().join(','));
}

try {
  { // Synthetic HY-only corpus: neither translation may be invented.
    const fixture = root();
    const content = '<p>HY <strong>ONLY</strong> &amp; text</p>';
    add(fixture, A, {
      hyOverrides: { title: 'HY ONLY TITLE', alphabet_key: 'Ա', content },
    });
    const repository = scanContentStore(fixture);
    assert.deepEqual(listPublishedSearchEntries(repository, 'hy'), [{
      slug: `hy-${A.slice(0, 8)}`,
      title: 'HY ONLY TITLE',
      letter: 'Ա',
      text: plainTextFromPostContent(content).slice(0, 220),
    }]);
    assert.deepEqual(listPublishedSearchEntries(repository, 'ru'), []);
    assert.deepEqual(listPublishedSearchEntries(repository, 'en'), []);
  }
  { // HY+RU remains two isolated corpora; EN has no fallback record.
    const fixture = root();
    add(fixture, A, {
      hyOverrides: { title: 'HY TITLE', alphabet_key: 'Ա', content: '<p>HY CONTENT</p>' },
      ru: published('ru', 'русская-ворона', { title: 'RU TITLE', alphabet_key: 'В', content: '<p>RU CONTENT</p>' }),
    });
    const repository = scanContentStore(fixture);
    assert.deepEqual(listPublishedSearchEntries(repository, 'hy'), [{ slug: `hy-${A.slice(0, 8)}`, title: 'HY TITLE', letter: 'Ա', text: 'HY CONTENT' }]);
    assert.deepEqual(listPublishedSearchEntries(repository, 'ru'), [{ slug: 'русская-ворона', title: 'RU TITLE', letter: 'В', text: 'RU CONTENT' }]);
    assert.deepEqual(listPublishedSearchEntries(repository, 'en'), []);
  }
  { // HY+EN remains two isolated corpora; RU has no fallback record.
    const fixture = root();
    add(fixture, A, {
      hyOverrides: { title: 'HY TITLE', alphabet_key: 'Ա', content: '<p>HY CONTENT</p>' },
      en: published('en', 'english-crow', { title: 'EN TITLE', alphabet_key: 'C', content: '<p>EN CONTENT</p>' }),
    });
    const repository = scanContentStore(fixture);
    assert.deepEqual(listPublishedSearchEntries(repository, 'hy'), [{ slug: `hy-${A.slice(0, 8)}`, title: 'HY TITLE', letter: 'Ա', text: 'HY CONTENT' }]);
    assert.deepEqual(listPublishedSearchEntries(repository, 'en'), [{ slug: 'english-crow', title: 'EN TITLE', letter: 'C', text: 'EN CONTENT' }]);
    assert.deepEqual(listPublishedSearchEntries(repository, 'ru'), []);
  }
  {
    const fixture = root();
    add(fixture, A, {
      hyOverrides: { alphabet_key: 'Ա' },
      ru: published('ru', 'русская-буква', { alphabet_key: 'В' }),
      en: published('en', 'english-letter', { alphabet_key: 'C' }),
    });
    const repository = scanContentStore(fixture);
    assert.equal(listPublishedSearchEntries(repository, 'hy')[0].letter, 'Ա');
    assert.equal(listPublishedSearchEntries(repository, 'ru')[0].letter, 'В');
    assert.equal(listPublishedSearchEntries(repository, 'en')[0].letter, 'C');
  }
  {
    // Stage 12H-A guarantees same-locale ownership and no fallback only. A
    // future locale navigation/alphabet contract defines allowed RU/EN keys,
    // normalization, casing, and alphabet/category navigation behavior.
    const fixture = root();
    add(fixture, A, {
      hyOverrides: { alphabet_key: 'Ա' },
      ru: published('ru', 'нулевая-буква', { title: 'RU TITLE', alphabet_key: null }),
      en: published('en', 'null-letter', { title: 'EN TITLE', alphabet_key: null }),
    });
    const repository = scanContentStore(fixture);
    assert.equal(listPublishedSearchEntries(repository, 'ru')[0].letter, null);
    assert.equal(listPublishedSearchEntries(repository, 'en')[0].letter, null);
  }
  {
    const fixture = root();
    add(fixture, B, { ru: published('ru', 'ворона-старая', { title: 'PUBLIC TITLE', content: '<p>PUBLIC CONTENT</p>' }) });
    add(fixture, A, { ru: both('ru', 'секретная-ворона', 'ворона-публичная', { title: 'Публичная ворона', content: '<p>PUBLIC CONTENT</p>' }), en: published('en', 'crow-dream') });
    add(fixture, C, { ru: draft('ru', 'только-черновик'), en: draft('en', 'draft-only') });
    const repository = scanContentStore(fixture);
    const hy = listPublishedSearchEntries(repository, 'hy');
    const ru = listPublishedSearchEntries(repository, 'ru');
    const en = listPublishedSearchEntries(repository, 'en');
    assert.equal(hy.length, 3);
    assert.deepEqual(ru.map((entry) => entry.slug), ['ворона-старая', 'ворона-публичная']);
    assert.deepEqual(en.map((entry) => entry.slug), ['crow-dream']);
    assert.deepEqual(fields([...hy, ...ru, ...en]), Array(6).fill('letter,slug,text,title'));
    assert.equal(ru.some((entry) => entry.slug === 'только-черновик'), false);
    assert.equal(en.some((entry) => entry.slug === 'draft-only'), false);
    assert.equal(JSON.stringify(ru).includes('секретная-ворона'), false);
    assert.equal(JSON.stringify(ru).includes('SECRET DRAFT TITLE'), false);
    assert.equal(JSON.stringify(ru).includes('SECRET DRAFT CONTENT'), false);
    assert.equal(JSON.stringify(ru).includes('"draft"'), false);
    assert.equal(publicPathFor('ru', ru[1].slug), '/ru/ворона-публичная/');
    assert.deepEqual(ru, listPublishedSearchEntries(repository, 'ru'));
    assert.throws(() => listPublishedSearchEntries(repository, 'de'));
  }
  {
    const fixture = root();
    add(fixture, C, { ru: published('ru', 'зулу') });
    add(fixture, A, { ru: published('ru', 'альфа', { based_on_source_revision: 2 }) });
    add(fixture, B, { ru: published('ru', 'середина') });
    const repository = scanContentStore(fixture);
    const ru = listPublishedSearchEntries(repository, 'ru');
    assert.deepEqual(ru.map((entry) => entry.slug), ['зулу', 'середина', 'альфа']);
    assert.equal(ru.some((entry) => entry.slug === 'альфа'), true, 'OUTDATED published translation remains searchable');
  }
  {
    const repository = scanContentStore('src/data/content/dreams');
    for (const locale of ['hy', 'ru', 'en']) {
      const published = listPublishedLocaleEntries(repository, locale);
      const expected = listPublishedSearchEntries(repository, locale);
      const indexFile = locale === 'hy' ? 'dist/search-index.json' : `dist/${locale}/search-index.json`;
      const actual = JSON.parse(readFileSync(indexFile, 'utf8'));

      assert.deepEqual(actual, expected, `${locale} logical search projection exactly matches the current public index`);
      assert.equal(actual.length, published.length, `${locale} search has one entry per published locale document`);
      assert.equal(new Set(published.map((entry) => entry.content_id)).size, published.length, `${locale} published search ownership has no duplicate content IDs`);
      assert.equal(new Set(published.map((entry) => entry.slug)).size, published.length, `${locale} published locale records have no duplicate slugs`);
      assert.equal(new Set(actual.map((entry) => entry.slug)).size, actual.length, `${locale} search index has no duplicate slugs`);
      const actualBySlug = new Map(actual.map((entry) => [entry.slug, entry]));
      for (const source of published) {
        const entry = actualBySlug.get(source.slug);
        assert.ok(entry, `${locale}/${source.content_id} published record is present in the search index`);
        assert.equal(source.locale, locale, `${locale}/${source.content_id} published record retains its locale`);
        assert.equal(entry.slug, source.slug, `${locale}/${source.content_id} search uses the published slug`);
        assert.equal(entry.title, source.published.title, `${locale}/${source.content_id} search uses the published title`);
        assert.equal(entry.letter, source.published.alphabet_key, `${locale}/${source.content_id} search uses the published alphabet key`);
        assert.deepEqual(entry, projectPublishedSearchEntry(source), `${locale}/${source.content_id} search entry belongs to the canonical published record`);
      }
    }
  }
  console.log('MULTILINGUAL SEARCH FOUNDATION PASS');
} finally {
  for (const fixture of roots) rmSync(fixture, { recursive: true, force: true });
}
