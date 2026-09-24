import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { escapeSitemapXmlText, listPublishedDreamSitemapEntries } from '../../src/lib/content-source/published-sitemaps.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';
const roots = [];
const payload = (locale, slug, fingerprint, extra = {}) => ({ slug, title: `${locale} title`, description: null, content: `<p>${locale}</p>`, image_alts: {}, tags: [], alphabet_key: null, based_on_source_revision: locale === 'hy' ? null : 1, based_on_source_fingerprint: locale === 'hy' ? null : fingerprint, ...extra });
const published = (locale, slug, extra = {}) => (fingerprint) => ({ draft: null, published: { ...payload(locale, slug, fingerprint, extra), version: 1, published_at: '2026-09-14' } });
const draft = (locale, slug) => (fingerprint) => ({ draft: payload(locale, slug, fingerprint), published: null });
const both = (locale, draftSlug, publishedSlug) => (fingerprint) => ({ draft: payload(locale, draftSlug, fingerprint, { title: 'SECRET DRAFT TITLE', content: 'SECRET DRAFT CONTENT' }), published: { ...payload(locale, publishedSlug, fingerprint), version: 1, published_at: '2026-09-14' } });
function write(root, relative, value) { const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); }
function fixture({ ru, en } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-sitemap-')); roots.push(root);
  const hy = { ...payload('hy', 'hy-dream', null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hy), fingerprint_spec_version: 1 };
  const base = `${A.slice(0, 2)}/${A}`; write(root, `${base}/item.json`, item); write(root, `${base}/hy.json`, { schema_version: 1, content_id: A, locale: 'hy', draft: null, published: hy });
  if (ru) write(root, `${base}/ru.json`, { schema_version: 1, content_id: A, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(root, `${base}/en.json`, { schema_version: 1, content_id: A, locale: 'en', ...en(item.source_fingerprint) });
  return root;
}
function addHyRecord(root, id, slug) {
  const hy = { ...payload('hy', slug, null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: id, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hy), fingerprint_spec_version: 1 };
  const base = `${id.slice(0, 2)}/${id}`; write(root, `${base}/item.json`, item); write(root, `${base}/hy.json`, { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hy });
}
try {
  const paths = (options, locale) => listPublishedDreamSitemapEntries(scanContentStore(fixture(options)), locale).map((entry) => entry.path);
  assert.deepEqual(paths({}, 'hy'), ['/hy-dream/']); assert.deepEqual(paths({}, 'ru'), []); assert.deepEqual(paths({}, 'en'), []);
  assert.deepEqual(paths({ ru: published('ru', 'старая-ворона') }, 'ru'), ['/ru/старая-ворона/']);
  assert.deepEqual(paths({ en: published('en', 'old-crow') }, 'en'), ['/en/old-crow/']);
  {
    const repository = scanContentStore(fixture({ ru: published('ru', 'старая-ворона'), en: published('en', 'old-crow') }));
    assert.deepEqual(listPublishedDreamSitemapEntries(repository, 'hy').map(({ locale, path: publicPath }) => [locale, publicPath]), [['hy', '/hy-dream/']]);
    assert.deepEqual(listPublishedDreamSitemapEntries(repository, 'ru').map(({ locale, path: publicPath }) => [locale, publicPath]), [['ru', '/ru/старая-ворона/']]);
    assert.deepEqual(listPublishedDreamSitemapEntries(repository, 'en').map(({ locale, path: publicPath }) => [locale, publicPath]), [['en', '/en/old-crow/']]);
  }
  assert.deepEqual(paths({ ru: draft('ru', 'черновик') }, 'ru'), []); assert.deepEqual(paths({ en: draft('en', 'draft') }, 'en'), []);
  const safe = listPublishedDreamSitemapEntries(scanContentStore(fixture({ ru: both('ru', 'секретная-ворона', 'старая-ворона') })), 'ru');
  assert.deepEqual(safe.map((entry) => entry.path), ['/ru/старая-ворона/']); for (const secret of ['секретная-ворона', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) assert.equal(JSON.stringify(safe).includes(secret), false);
  assert.deepEqual(paths({ ru: published('ru', 'старая-ворона', { based_on_source_revision: 2 }) }, 'ru'), ['/ru/старая-ворона/']);
  {
    const root = fixture(); addHyRecord(root, B, 'zebra'); addHyRecord(root, C, 'alpha');
    const repository = scanContentStore(root);
    const expected = ['/alpha/', '/hy-dream/', '/zebra/'];
    assert.deepEqual(listPublishedDreamSitemapEntries(repository, 'hy').map(({ path: publicPath }) => publicPath), expected);
    assert.deepEqual(listPublishedDreamSitemapEntries(repository, 'hy').map(({ path: publicPath }) => publicPath), expected);
  }
  assert.throws(() => listPublishedDreamSitemapEntries(scanContentStore(fixture()), 'de'));
  assert.equal(escapeSitemapXmlText(`a&<b>"'`), 'a&amp;&lt;b&gt;&quot;&apos;');
  const real = scanContentStore('src/data/content/dreams'); const realHy = listPublishedDreamSitemapEntries(real, 'hy');
  assert.equal(realHy.length, 5800); assert.equal(listPublishedDreamSitemapEntries(real, 'ru').length, 0); assert.deepEqual(listPublishedDreamSitemapEntries(real, 'en').map((entry) => entry.path), ['/en/tar-musical-instrument-dream-meaning/']);
  const sitemapUrls = new Set([...readFileSync('dist/sitemap-hy.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeURI(new URL(match[1]).pathname)));
  assert.equal(realHy.every(({ path: publicPath }) => sitemapUrls.has(publicPath)), true);
  console.log('MULTILINGUAL SITEMAP PROJECTION PASS');
} finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
