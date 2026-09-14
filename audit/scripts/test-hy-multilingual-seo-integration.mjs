import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { loadHyDreamSeoBySlug } from '../../src/lib/content-source/hy-dream-seo.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const roots = [];

const ruFixtureSlug = (slug) => [...slug].map((character) => character.codePointAt(0)).join('-');

function payload(locale, slug, fingerprint, overrides = {}) {
  return {
    slug: locale === 'ru' ? ruFixtureSlug(slug) : slug, title: `${locale} title`, description: null, content: `<p>${locale} content</p>`, image_alts: {}, tags: [locale], alphabet_key: null,
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

function both(locale, draftSlug, publishedSlug, draftOverrides = {}, publishedOverrides = {}) {
  return (fingerprint) => ({
    draft: payload(locale, draftSlug, fingerprint, draftOverrides),
    published: { ...payload(locale, publishedSlug, fingerprint, publishedOverrides), version: 1, published_at: '2026-09-14' },
  });
}

function write(root, relative, value) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture({ ru = null, en = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-hy-seo-'));
  roots.push(root);
  const storeRoot = path.join(root, 'store');
  const sourceUrl = 'https://erazahan.info/hy-dream/';
  const hyPublished = { ...payload('hy', 'hy-dream', null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: A, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hyPublished), fingerprint_spec_version: 1 };
  const base = `${A.slice(0, 2)}/${A}`;
  write(storeRoot, `${base}/item.json`, item);
  write(storeRoot, `${base}/hy.json`, { schema_version: 1, content_id: A, locale: 'hy', draft: null, published: hyPublished });
  if (ru) write(storeRoot, `${base}/ru.json`, { schema_version: 1, content_id: A, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(storeRoot, `${base}/en.json`, { schema_version: 1, content_id: A, locale: 'en', ...en(item.source_fingerprint) });
  const registryFile = path.join(root, 'content-id-registry.v1.json');
  write(root, 'content-id-registry.v1.json', { entries: [{ content_id: A, legacy: { original_source_url: sourceUrl } }] });
  return { storeRoot, registryFile, posts: [{ slug: 'hy-dream', sourceUrl }] };
}

function seo(options) {
  const value = fixture(options);
  return loadHyDreamSeoBySlug(value.posts, { storeRoot: value.storeRoot, registryFile: value.registryFile }).get('hy-dream');
}

function locales(context) {
  return context.alternates.map((alternate) => alternate.locale);
}

try {
  assert.deepEqual(locales(seo()), []);
  assert.deepEqual(locales(seo({ ru: published('ru', 'ru-live') })), ['hy', 'ru']);
  assert.deepEqual(locales(seo({ en: published('en', 'en-live') })), ['hy', 'en']);
  assert.deepEqual(locales(seo({ ru: published('ru', 'ru-live'), en: published('en', 'en-live') })), ['hy', 'ru', 'en']);
  assert.deepEqual(locales(seo({ ru: draft('ru', 'ru-draft') })), []);
  assert.deepEqual(locales(seo({ ru: published('ru', 'ru-outdated', { based_on_source_revision: 2 }) })), ['hy', 'ru']);
  {
    const context = seo({ ru: both('ru', 'secret-new-slug', 'public-old-slug', { title: 'SECRET DRAFT TITLE', content: 'SECRET DRAFT CONTENT' }) });
    assert.deepEqual(context.alternates.map(({ locale, path: publicPath }) => [locale, publicPath]), [['hy', '/hy-dream/'], ['ru', `/ru/${ruFixtureSlug('public-old-slug')}/`]]);
    const serialized = JSON.stringify(context);
    for (const secret of ['secret-new-slug', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) assert.equal(serialized.includes(secret), false);
  }
  {
    const value = fixture();
    assert.throws(() => loadHyDreamSeoBySlug([{ slug: 'hy-dream', sourceUrl: 'https://erazahan.info/missing/' }], { storeRoot: value.storeRoot, registryFile: value.registryFile }));
  }
  {
    const realPosts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
    const real = loadHyDreamSeoBySlug(realPosts);
    assert.equal(real.size, 5800);
    assert.equal([...real.values()].every((context) => context.locale === 'hy' && context.alternates.length === 0), true);
  }
  console.log('HY MULTILINGUAL SEO INTEGRATION PASS');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
