import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { buildPublishedSeoContext, localeSeoMetadata } from '../../src/lib/content-source/published-seo.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
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

function published(locale, slug, overrides = {}) {
  return (fingerprint) => ({
    draft: null,
    published: { ...payload(locale, slug, fingerprint, overrides), version: 1, published_at: '2026-09-14' },
  });
}

function draft(locale, slug) {
  return (fingerprint) => ({ draft: payload(locale, slug, fingerprint), published: null });
}

function both(locale, draftSlug, publishedSlug, draftOverrides = {}, publishedOverrides = {}) {
  return (fingerprint) => ({
    draft: payload(locale, draftSlug, fingerprint, draftOverrides),
    published: { ...payload(locale, publishedSlug, fingerprint, publishedOverrides), version: 1, published_at: '2026-09-14' },
  });
}

function write(rootPath, relative, value) {
  const target = path.join(rootPath, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function addRecord(rootPath, id, { ru = null, en = null } = {}) {
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
  const directory = `${id.slice(0, 2)}/${id}`;
  write(rootPath, `${directory}/item.json`, item);
  write(rootPath, `${directory}/hy.json`, { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hyPublished });
  if (ru) write(rootPath, `${directory}/ru.json`, { schema_version: 1, content_id: id, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(rootPath, `${directory}/en.json`, { schema_version: 1, content_id: id, locale: 'en', ...en(item.source_fingerprint) });
}

function repository(options = {}) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'erazahan-multilingual-seo-'));
  roots.push(fixture);
  addRecord(fixture, A, options);
  return scanContentStore(fixture);
}

function alternates(context) {
  return context.alternates.map(({ locale, path: alternatePath }) => [locale, alternatePath]);
}

function assertLayoutRenders(expectations) {
  const root = process.cwd();
  const routeDirectory = path.join(root, 'src/pages/stage12fa-layout-test');
  const routeFile = path.join(routeDirectory, '[mode].astro');
  const outputDirectory = mkdtempSync(path.join(tmpdir(), 'erazahan-layout-render-'));
  try {
    mkdirSync(routeDirectory, { recursive: true });
    writeFileSync(routeFile, `---
import Layout from '../../layouts/Layout.astro';
export function getStaticPaths() {
  return [
    { params: { mode: 'omitted' }, props: {} },
    { params: { mode: 'null' }, props: { alternates: null } },
    { params: { mode: 'empty' }, props: { alternates: [] } },
    { params: { mode: 'ru' }, props: { locale: 'ru', alternates: [] } },
    { params: { mode: 'en' }, props: { locale: 'en', alternates: [] } },
  ];
}
const props = Astro.props;
---
<Layout {...props}><p>layout test</p></Layout>
`);
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--force', '--outDir', outputDirectory], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const [mode, expected] of Object.entries(expectations)) {
      const html = readFileSync(path.join(outputDirectory, 'stage12fa-layout-test', mode, 'index.html'), 'utf8');
      assert.equal((html.match(/hreflang=/g) ?? []).length, 0);
      assert.match(html, expected.html);
      assert.match(html, expected.og);
      assert.match(html, /<link rel="canonical" href="https:\/\/erazahan\.info\/stage12fa-layout-test\//);
    }
  } finally {
    if (existsSync(routeDirectory)) rmSync(routeDirectory, { recursive: true, force: true });
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

try {
  assert.deepEqual(localeSeoMetadata('hy'), { html_lang: 'hy', og_locale: 'hy_AM' });
  assert.deepEqual(localeSeoMetadata('ru'), { html_lang: 'ru', og_locale: 'ru_RU' });
  assert.deepEqual(localeSeoMetadata('en'), { html_lang: 'en', og_locale: 'en_US' });
  assert.throws(() => localeSeoMetadata('fr'));

  assertLayoutRenders({
    omitted: { html: /<html lang="hy">/, og: /<meta property="og:locale" content="hy_AM">/ },
    null: { html: /<html lang="hy">/, og: /<meta property="og:locale" content="hy_AM">/ },
    empty: { html: /<html lang="hy">/, og: /<meta property="og:locale" content="hy_AM">/ },
    ru: { html: /<html lang="ru">/, og: /<meta property="og:locale" content="ru_RU">/ },
    en: { html: /<html lang="en">/, og: /<meta property="og:locale" content="en_US">/ },
  });

  { // HY-only retains its canonical URL and emits no hreflang alternates.
    const context = buildPublishedSeoContext(repository(), A, 'hy');
    assert.equal(context.canonical_path, `/hy-${A.slice(0, 8)}/`);
    assert.deepEqual(alternates(context), []);
  }
  { // HY/RU contexts are reciprocal and include only published variants.
    const store = repository({ ru: published('ru', 'ru-published') });
    for (const locale of ['hy', 'ru']) {
      const context = buildPublishedSeoContext(store, A, locale);
      assert.deepEqual(alternates(context), [['hy', `/hy-${A.slice(0, 8)}/`], ['ru', '/ru/ru-published/']]);
    }
    const ru = buildPublishedSeoContext(store, A, 'ru');
    assert.equal(ru.html_lang, 'ru');
    assert.equal(ru.og_locale, 'ru_RU');
    assert.equal(ru.canonical_path, '/ru/ru-published/');
  }
  { // HY/EN contexts are reciprocal and never invent an RU translation.
    const store = repository({ en: published('en', 'en-published') });
    for (const locale of ['hy', 'en']) {
      const context = buildPublishedSeoContext(store, A, locale);
      assert.deepEqual(alternates(context), [['hy', `/hy-${A.slice(0, 8)}/`], ['en', '/en/en-published/']]);
    }
  }
  { // Canonical locale ordering is stable across all published variants.
    const store = repository({ ru: published('ru', 'ru'), en: published('en', 'en') });
    for (const locale of ['hy', 'ru', 'en']) {
      const context = buildPublishedSeoContext(store, A, locale);
      assert.deepEqual(alternates(context), [['hy', `/hy-${A.slice(0, 8)}/`], ['ru', '/ru/ru/'], ['en', '/en/en/']]);
    }
  }
  { // Draft-only variants never become alternates; published outdated variants remain public.
    const context = buildPublishedSeoContext(repository({
      ru: published('ru', 'outdated', { based_on_source_revision: 2 }),
      en: draft('en', 'en-draft'),
    }), A, 'ru');
    assert.deepEqual(alternates(context), [['hy', `/hy-${A.slice(0, 8)}/`], ['ru', '/ru/outdated/']]);
  }
  { // SEO receives only the published projection, never a newer editorial draft.
    const fixture = mkdtempSync(path.join(tmpdir(), 'erazahan-multilingual-seo-'));
    roots.push(fixture);
    addRecord(fixture, A, {
      ru: both(
        'ru',
        'secret-new-slug',
        'public-old-slug',
        { title: 'SECRET DRAFT TITLE', content: 'SECRET DRAFT CONTENT' },
        { title: 'PUBLIC TITLE', content: 'PUBLIC CONTENT' },
      ),
    });
    const context = buildPublishedSeoContext(scanContentStore(fixture), A, 'ru');
    const serialized = JSON.stringify(context);
    for (const secret of ['secret-new-slug', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) {
      assert.equal(serialized.includes(secret), false, `${secret} must not leak`);
    }
    assert.deepEqual(alternates(context), [['hy', `/hy-${A.slice(0, 8)}/`], ['ru', '/ru/public-old-slug/']]);
  }
  assert.equal(buildPublishedSeoContext(repository(), '01990c84-9c78-7abc-8def-123456789abd', 'hy'), null);
  assert.throws(() => buildPublishedSeoContext(repository(), A, 'fr'));
  console.log('MULTILINGUAL SEO PASS');
} finally {
  for (const fixture of roots) rmSync(fixture, { recursive: true, force: true });
}
