import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { listPublishedDreamSitemapEntries } from '../../src/lib/content-source/published-sitemaps.mjs';
import { listLocaleSitemapEntries, serializeSitemapXml } from '../../src/lib/content-source/locale-sitemap-xml.mjs';

const ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const roots = [];
const origin = 'https://erazahan.info';
const preReleaseIndexing = { PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_ALLOW_LOCALIZED_INDEXING: 'false' };
const releasedIndexing = { PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_ALLOW_LOCALIZED_INDEXING: 'true' };
const localizedIndexingReleased = process.env.PUBLIC_ALLOW_INDEXING === 'true'
  && process.env.PUBLIC_ALLOW_LOCALIZED_INDEXING === 'true';
const payload = (locale, slug, fingerprint, extra = {}) => ({ slug, title: `${locale} title`, description: null, content: `<p>${locale}</p>`, image_alts: {}, tags: [], alphabet_key: null, based_on_source_revision: locale === 'hy' ? null : 1, based_on_source_fingerprint: locale === 'hy' ? null : fingerprint, ...extra });
const published = (locale, slug, extra = {}) => (fingerprint) => ({ draft: null, published: { ...payload(locale, slug, fingerprint, extra), version: 1, published_at: '2026-09-14' } });
const draft = (locale, slug) => (fingerprint) => ({ draft: payload(locale, slug, fingerprint), published: null });
const both = (locale, draftSlug, publishedSlug) => (fingerprint) => ({ draft: payload(locale, draftSlug, fingerprint, { title: 'SECRET DRAFT TITLE', content: 'SECRET DRAFT CONTENT' }), published: { ...payload(locale, publishedSlug, fingerprint), version: 1, published_at: '2026-09-14' } });
function write(root, relative, value) { const target = path.join(root, relative); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); }
function fixture({ ru, en } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-locale-sitemap-')); roots.push(root);
  const hy = { ...payload('hy', 'hy-dream', null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: ID, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hy), fingerprint_spec_version: 1 };
  const base = `${ID.slice(0, 2)}/${ID}`;
  write(root, `${base}/item.json`, item); write(root, `${base}/hy.json`, { schema_version: 1, content_id: ID, locale: 'hy', draft: null, published: hy });
  if (ru) write(root, `${base}/ru.json`, { schema_version: 1, content_id: ID, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(root, `${base}/en.json`, { schema_version: 1, content_id: ID, locale: 'en', ...en(item.source_fingerprint) });
  return root;
}
const xmlUrls = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const publicPaths = (xml) => xmlUrls(xml).map((url) => decodeURI(new URL(url).pathname));
try {
  const hyOnly = scanContentStore(fixture());
  assert.deepEqual(listLocaleSitemapEntries(hyOnly, 'ru'), []); assert.deepEqual(listLocaleSitemapEntries(hyOnly, 'en'), []);
  assert.deepEqual(listLocaleSitemapEntries(hyOnly, 'hy', { indexingConfig: { PUBLIC_ALLOW_INDEXING: 'false' } }), []);
  assert.deepEqual(listLocaleSitemapEntries(hyOnly, 'hy', { indexingConfig: preReleaseIndexing }).map((entry) => entry.path), ['/hy-dream/']);
  assert.equal(serializeSitemapXml([], origin), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>');

  const ruXml = serializeSitemapXml(listLocaleSitemapEntries(scanContentStore(fixture({ ru: published('ru', 'ворона-во-сне') })), 'ru', { indexingConfig: releasedIndexing }), origin);
  assert.deepEqual(xmlUrls(ruXml), ['https://erazahan.info/ru/ворона-во-сне/']);
  const enXml = serializeSitemapXml(listLocaleSitemapEntries(scanContentStore(fixture({ en: published('en', 'crow-dream-meaning') })), 'en', { indexingConfig: releasedIndexing }), origin);
  assert.deepEqual(xmlUrls(enXml), ['https://erazahan.info/en/crow-dream-meaning/']);
  assert.deepEqual(listLocaleSitemapEntries(scanContentStore(fixture({ ru: draft('ru', 'черновик'), en: draft('en', 'draft') })), 'ru', { indexingConfig: releasedIndexing }), []);
  assert.deepEqual(listLocaleSitemapEntries(scanContentStore(fixture({ ru: draft('ru', 'черновик'), en: draft('en', 'draft') })), 'en', { indexingConfig: releasedIndexing }), []);

  const publishedDraft = serializeSitemapXml(listLocaleSitemapEntries(scanContentStore(fixture({ ru: both('ru', 'секретная-ворона', 'старая-ворона') })), 'ru', { indexingConfig: releasedIndexing }), origin);
  assert.deepEqual(xmlUrls(publishedDraft), ['https://erazahan.info/ru/старая-ворона/']);
  for (const secret of ['секретная-ворона', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) assert.equal(publishedDraft.includes(secret), false);
  const outdatedRu = listLocaleSitemapEntries(scanContentStore(fixture({ ru: published('ru', 'старая-ворона', { based_on_source_revision: 2 }) })), 'ru', { indexingConfig: releasedIndexing });
  const outdatedEn = listLocaleSitemapEntries(scanContentStore(fixture({ en: published('en', 'old-crow', { based_on_source_revision: 2 }) })), 'en', { indexingConfig: releasedIndexing });
  assert.deepEqual(outdatedRu.map((entry) => entry.path), ['/ru/старая-ворона/']); assert.deepEqual(outdatedEn.map((entry) => entry.path), ['/en/old-crow/']);
  assert.equal(serializeSitemapXml([{ path: '/a&b/' }], origin).includes('a&amp;b'), true);
  assert.equal(serializeSitemapXml([{ path: '/a/' }], origin), serializeSitemapXml([{ path: '/a/' }], origin));

  for (const route of ['src/pages/sitemap-hy.xml.ts', 'src/pages/sitemap-ru.xml.ts', 'src/pages/sitemap-en.xml.ts']) {
    assert.equal(readFileSync(route, 'utf8').includes("Content-Type': 'application/xml; charset=utf-8'"), true);
  }
  const hy = readFileSync('dist/sitemap-hy.xml', 'utf8');
  const ru = readFileSync('dist/sitemap-ru.xml', 'utf8');
  const en = readFileSync('dist/sitemap-en.xml', 'utf8');
  const real = scanContentStore('src/data/content/dreams');
  assert.deepEqual(listPublishedDreamSitemapEntries(real, 'en').map((entry) => entry.path), ['/en/tar-musical-instrument-dream-meaning/']);
  assert.deepEqual(listLocaleSitemapEntries(real, 'en', { indexingConfig: preReleaseIndexing }), []);
  const dreamPaths = new Set(listPublishedDreamSitemapEntries(real, 'hy').map((entry) => entry.path));
  assert.equal(xmlUrls(hy).length, 5920); assert.equal(xmlUrls(ru).length, 0);
  assert.equal(xmlUrls(en).length, localizedIndexingReleased ? 1 : 0);
  assert.equal(en.includes('https://erazahan.info/en/tar-musical-instrument-dream-meaning/'), localizedIndexingReleased);
  assert.equal(publicPaths(hy).filter((publicPath) => dreamPaths.has(publicPath)).length, 5800);
  assert.equal(publicPaths(hy).filter((publicPath) => !dreamPaths.has(publicPath)).length, 120);
  assert.equal(/<sitemapindex\b/u.test(hy + ru + en), false);
  console.log('LOCALE SITEMAP ROUTES PASS');
} finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
