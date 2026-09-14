import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { listPublishedSearchEntries } from '../../src/lib/content-source/published-search.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { GET as ruGet, prerender as ruPrerender, serializeSearchIndex as serializeRu } from '../../src/pages/ru/search-index.json.ts';
import { GET as enGet, prerender as enPrerender, serializeSearchIndex as serializeEn } from '../../src/pages/en/search-index.json.ts';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const roots = [];

function payload(locale, slug, fingerprint, overrides = {}) {
  return {
    slug, title: `${locale} title`, description: null, content: `<p>${locale} content</p>`, image_alts: {}, tags: [locale], alphabet_key: null,
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
  const value = mkdtempSync(path.join(tmpdir(), 'erazahan-locale-search-routes-'));
  roots.push(value);
  return value;
}

function write(rootPath, relative, value) {
  const target = path.join(rootPath, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function add(rootPath, id, { ru = null, en = null } = {}) {
  const hy = { ...payload('hy', `hy-${id.slice(0, 8)}`, null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: id, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hy), fingerprint_spec_version: 1 };
  const base = `${id.slice(0, 2)}/${id}`;
  write(rootPath, `${base}/item.json`, item);
  write(rootPath, `${base}/hy.json`, { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hy });
  if (ru) write(rootPath, `${base}/ru.json`, { schema_version: 1, content_id: id, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(rootPath, `${base}/en.json`, { schema_version: 1, content_id: id, locale: 'en', ...en(item.source_fingerprint) });
}

try {
  assert.equal(ruPrerender, true); assert.equal(enPrerender, true);
  for (const get of [ruGet, enGet]) {
    const response = get();
    assert.equal(response.headers.get('content-type'), 'application/json');
    const first = await response.text();
    assert.deepEqual(JSON.parse(first), []);
    assert.equal(first, '[]');
    assert.equal(await get().text(), first);
  }
  {
    const fixture = root(); add(fixture, A, { ru: published('ru', 'публичная-ворона', { title: 'RU TITLE', alphabet_key: 'В', content: '<p>RU CONTENT</p>' }) });
    const repository = scanContentStore(fixture); const body = serializeRu(repository);
    assert.deepEqual(JSON.parse(body), [{ slug: 'публичная-ворона', title: 'RU TITLE', letter: 'В', text: 'RU CONTENT' }]);
    assert.deepEqual(JSON.parse(serializeEn(repository)), []);
  }
  {
    const fixture = root(); add(fixture, A, { en: published('en', 'public-crow', { title: 'EN TITLE', alphabet_key: 'C', content: '<p>EN CONTENT</p>' }) });
    const repository = scanContentStore(fixture); const body = serializeEn(repository);
    assert.deepEqual(JSON.parse(body), [{ slug: 'public-crow', title: 'EN TITLE', letter: 'C', text: 'EN CONTENT' }]);
    assert.deepEqual(JSON.parse(serializeRu(repository)), []);
  }
  {
    const fixture = root(); add(fixture, A, { ru: draft('ru', 'только-черновик'), en: draft('en', 'draft-only') });
    const repository = scanContentStore(fixture);
    assert.equal(serializeRu(repository), '[]'); assert.equal(serializeEn(repository), '[]');
  }
  {
    const fixture = root(); add(fixture, A, { ru: both('ru', 'секретная-ворона', 'публичная-ворона', { title: 'PUBLIC TITLE', content: '<p>PUBLIC CONTENT</p>' }) });
    const body = serializeRu(scanContentStore(fixture));
    for (const secret of ['секретная-ворона', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) assert.equal(body.includes(secret), false);
    assert.deepEqual(JSON.parse(body), [{ slug: 'публичная-ворона', title: 'PUBLIC TITLE', letter: null, text: 'PUBLIC CONTENT' }]);
  }
  {
    const fixture = root(); add(fixture, A, { ru: published('ru', 'устаревшая-ворона', { based_on_source_revision: 2 }), en: published('en', 'outdated-en', { based_on_source_revision: 2 }) });
    const repository = scanContentStore(fixture);
    assert.equal(JSON.parse(serializeRu(repository)).length, 1); assert.equal(JSON.parse(serializeEn(repository)).length, 1);
  }
  assert.throws(() => listPublishedSearchEntries(scanContentStore('src/data/content/dreams'), 'de'));
  console.log('LOCALE SEARCH ROUTES PASS');
} finally {
  for (const fixture of roots) rmSync(fixture, { recursive: true, force: true });
}
