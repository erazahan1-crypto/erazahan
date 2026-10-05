import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanContentStore } from '../src/lib/content-source/multilingual-store.mjs';
import { listPublishedDreamSitemapEntries } from '../src/lib/content-source/published-sitemaps.mjs';
import { isLocaleIndexingAllowed } from '../src/lib/indexing-policy.mjs';

const ORIGIN = 'https://erazahan.info';
const indexingConfig = {
  PUBLIC_ALLOW_INDEXING: process.env.PUBLIC_ALLOW_INDEXING,
  PUBLIC_ALLOW_LOCALIZED_INDEXING: process.env.PUBLIC_ALLOW_LOCALIZED_INDEXING,
};
const SITEMAP_INDEX_OPEN = '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
const URLSET_OPEN = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';

function sitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function assertSitemapIndex(xml) {
  assert.ok(xml.includes(SITEMAP_INDEX_OPEN) && xml.includes('</sitemapindex>'), 'root sitemap must be a sitemapindex');
  assert.equal(xml.includes('<urlset'), false, 'root sitemap must not be a urlset');
  const urls = sitemapUrls(xml);
  assert.deepEqual(urls, [
    `${ORIGIN}/sitemap-hy.xml`,
    `${ORIGIN}/sitemap-ru.xml`,
    `${ORIGIN}/sitemap-en.xml`,
  ], 'root sitemap must contain exactly the ordered locale children');
  assert.equal(new Set(urls).size, urls.length, 'root sitemap must not contain duplicate children');
  assert.equal(urls.includes(`${ORIGIN}/sitemap.xml`), false, 'root sitemap must not reference itself');
  assert.equal(urls.some((url) => /\/[^/]+\/$/.test(new URL(url).pathname)), false, 'root sitemap must not contain page URLs');
  return urls;
}

function assertUrlset(xml, locale) {
  assert.ok(xml.includes(URLSET_OPEN) && xml.includes('</urlset>'), `${locale} sitemap must be a urlset`);
  assert.equal(xml.includes('<sitemapindex'), false, `${locale} sitemap must not be a sitemapindex`);
  return sitemapUrls(xml);
}

function loadHyNonDreamSitemapUrls() {
  // The HY sitemap's non-dream URLs are legacy static pages owned by
  // src/lib/sitemap-entries.ts. Derive them from that production source of
  // truth (through Vite's SSR loader, as the sitemap-index audit does) instead
  // of hardcoding their count, so native HY growth cannot invalidate the check.
  const script = [
    "import { createServer } from 'vite';",
    "const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });",
    "const entries = await server.ssrLoadModule('/src/lib/sitemap-entries.ts');",
    "console.log(JSON.stringify(entries.listHyNonDreamSitemapEntries().map((entry) => entry.path)));",
    "await server.close()",
  ].join(' ');
  const derivation = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(derivation.status, 0, derivation.stderr);
  const paths = JSON.parse(derivation.stdout.trim().split(/\r?\n/u).at(-1));
  return paths.map((entryPath) => `${ORIGIN}${entryPath}`);
}

function assertExactUrlCoverage(actualUrls, expectedUrls, label) {
  const actual = new Set(actualUrls);
  const expected = new Set(expectedUrls);
  assert.equal(expected.size, expectedUrls.length, `${label} expected URLs must be unique`);
  assert.equal(actual.size, actualUrls.length, `${label} sitemap must not contain duplicate URLs`);
  assert.deepEqual([...expected].filter((url) => !actual.has(url)), [], `${label} sitemap is missing an expected URL`);
  assert.deepEqual([...actual].filter((url) => !expected.has(url)), [], `${label} sitemap contains an unexpected URL`);
}

const posts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
assert.ok(posts.length > 0, 'canonical HY post corpus is non-empty');
assert.equal(new Set(posts.map((post) => post.slug)).size, posts.length, 'every canonical HY post has a unique slug');

for (const post of posts) {
  const outputPath = join('dist', post.slug, 'index.html');
  assert.ok(existsSync(outputPath), `missing public route: ${post.slug}`);
  const html = readFileSync(outputPath, 'utf8');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${post.slug}: expected exactly one h1`);
  if (post.content.trim()) {
    assert.match(html, /class="dream-content mt-6"[^>]*>[^]*?<\/div>/, `${post.slug}: empty public content`);
  }
}

const sample = (predicate, label) => {
  const post = posts.find(predicate);
  assert.ok(post, `missing ${label} source sample`);
  return { post, html: readFileSync(join('dist', post.slug, 'index.html'), 'utf8') };
};

const markdown = sample(
  (post) => !/<[a-z][^>]*>/i.test(post.content) && /(?:^|\n)\s*[-*+]\s+/m.test(post.content),
  'Markdown',
);
assert.match(markdown.html, /<ul>/);

const mixed = sample(
  (post) => /<[a-z][^>]*>/i.test(post.content) && /\*\*[^*]+\*\*/m.test(post.content),
  'mixed HTML/Markdown',
);
assert.match(mixed.html, /<strong>[^]*?<\/strong>/);

const faq = sample((post) => /<script\b[^>]*application\/ld\+json[^>]*>[^]*?FAQPage/i.test(post.content), 'FAQPage');
assert.doesNotMatch(faq.html, /FAQPage/);

const link = sample((post) => /<a\b[^>]*href=/i.test(post.content), 'internal-link');
assert.match(link.html, /<a\b[^>]*href=/);

const table = sample((post) => /<table\b/i.test(post.content), 'table');
assert.match(table.html, /<table>/);

const searchIndex = JSON.parse(readFileSync('dist/search-index.json', 'utf8'));
assert.equal(searchIndex.length, posts.length);
assert.ok(searchIndex.some((entry) => entry.slug === 'erazahan-bad'));

const sitemapIndex = readFileSync('dist/sitemap.xml', 'utf8');
const hySitemapUrls = assertUrlset(readFileSync('dist/sitemap-hy.xml', 'utf8'), 'HY');
const ruSitemapUrls = assertUrlset(readFileSync('dist/sitemap-ru.xml', 'utf8'), 'RU');
const enSitemapUrls = assertUrlset(readFileSync('dist/sitemap-en.xml', 'utf8'), 'EN');
const sitemapChildren = assertSitemapIndex(sitemapIndex);
const hyDreamUrls = posts.map((post) => `${ORIGIN}/${post.slug}/`);
assert.equal(hyDreamUrls.length, posts.length, 'expected HY dream count must equal the canonical post count');
const expectedHyDreamUrls = isLocaleIndexingAllowed('hy', indexingConfig) ? hyDreamUrls : [];
const hyDreamSet = new Set(expectedHyDreamUrls);
const hyActualDreamUrls = hySitemapUrls.filter((url) => hyDreamSet.has(url));
assertExactUrlCoverage(hyActualDreamUrls, expectedHyDreamUrls, 'HY dream');

const expectedHyNonDreamUrls = isLocaleIndexingAllowed('hy', indexingConfig) ? loadHyNonDreamSitemapUrls() : [];
const hyNonDreamSet = new Set(expectedHyNonDreamUrls);
const hyActualNonDreamUrls = hySitemapUrls.filter((url) => hyNonDreamSet.has(url));
assertExactUrlCoverage(hyActualNonDreamUrls, expectedHyNonDreamUrls, 'HY non-dream');
assert.ok([...hySitemapUrls, ...ruSitemapUrls, ...enSitemapUrls]
  .every((url) => !/\/(?:admin|api)(?:\/|$)/.test(new URL(url).pathname)), 'locale sitemaps must exclude admin and API URLs');

const repository = scanContentStore('src/data/content/dreams');
for (const [locale, urls] of [['ru', ruSitemapUrls], ['en', enSitemapUrls]]) {
  const expected = (isLocaleIndexingAllowed(locale, indexingConfig) ? listPublishedDreamSitemapEntries(repository, locale) : [])
    .map((entry) => `${ORIGIN}${entry.path}`);
  assertExactUrlCoverage(urls, expected, locale.toUpperCase());
}

// These pure negative checks freeze the sitemap-index safety boundaries without
// mutating build output.
assert.throws(() => assertSitemapIndex(sitemapIndex.replace(`${ORIGIN}/sitemap-hy.xml`, '')));
assert.throws(() => assertSitemapIndex(sitemapIndex.replace(`${ORIGIN}/sitemap-en.xml`, `${ORIGIN}/sitemap-ru.xml`)));
assert.throws(() => assertSitemapIndex(sitemapIndex.replace(SITEMAP_INDEX_OPEN, URLSET_OPEN)));
assert.throws(() => assertUrlset(sitemapIndex, 'HY'));
assert.throws(() => assertUrlset(URLSET_OPEN, 'HY'));
assert.throws(() => assertExactUrlCoverage(hyDreamUrls.slice(1), hyDreamUrls, 'HY dream'));

const assetFiles = readdirSync('dist/_astro').map((name) => join('dist/_astro', name));
assert.ok(assetFiles.every((file) => !statSync(file).isFile() || statSync(file).size < 7_000_000));

console.log({
  publicPostRoutes: posts.length,
  searchIndexEntries: searchIndex.length,
  sitemapIndexChildren: sitemapChildren.length,
  hySitemapUrls: hySitemapUrls.length,
  hyDreamUrls: hyDreamUrls.length,
  hyNonDreamUrls: expectedHyNonDreamUrls.length,
  ruSitemapUrls: ruSitemapUrls.length,
  enSitemapUrls: enSitemapUrls.length,
  regressionSamples: {
    legacy: 'erazahan-bad',
    markdown: markdown.post.slug,
    mixed: mixed.post.slug,
    faq: faq.post.slug,
    link: link.post.slug,
    table: table.post.slug,
  },
});
