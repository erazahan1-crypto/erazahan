import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { serializeSitemapIndexXml } from '../../src/lib/content-source/sitemap-index-xml.mjs';
import { isRuntimeLocaleIndexingAllowed } from '../../src/lib/indexing-policy.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { listPublishedLocaleEntries } from '../../src/lib/content-source/published-content.mjs';

const origin = 'https://erazahan.info';
const children = ['/sitemap-hy.xml', '/sitemap-ru.xml', '/sitemap-en.xml'];
const urls = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const publicPaths = (xml) => urls(xml).map((url) => decodeURI(new URL(url).pathname));
function assertExactPathSet(expectedPaths, actualPaths, label) {
  const expected = new Set(expectedPaths); const actual = new Set(actualPaths);
  assert.equal(expectedPaths.length, expected.size, `${label} expected paths must be unique`);
  assert.equal(actualPaths.length, actual.size, `${label} serialized paths must be unique`);
  assert.deepEqual([...expected].filter((path) => !actual.has(path)), [], `${label} must not miss eligible paths`);
  assert.deepEqual([...actual].filter((path) => !expected.has(path)), [], `${label} must not add ineligible paths`);
}
const legacyEntries = spawnSync(process.execPath, ['--input-type=module', '-e', "import { createServer } from 'vite'; const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' }); const entries = await server.ssrLoadModule('/src/lib/sitemap-entries.ts'); console.log(JSON.stringify(entries.listCurrentSitemapEntries().map((entry) => entry.path))); await server.close()"], { encoding: 'utf8' });
assert.equal(legacyEntries.status, 0, legacyEntries.stderr);
const legacyUrls = JSON.parse(legacyEntries.stdout.trim().split(/\r?\n/u).at(-1));

const index = readFileSync('dist/sitemap.xml', 'utf8');
const hy = readFileSync('dist/sitemap-hy.xml', 'utf8');
const ru = readFileSync('dist/sitemap-ru.xml', 'utf8');
const en = readFileSync('dist/sitemap-en.xml', 'utf8');

assert.equal(index.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
assert.deepEqual(urls(index), children.map((path) => `${origin}${path}`));
assert.equal(new Set(urls(index)).size, 3);
assert.equal(index.includes(`${origin}/sitemap.xml`), false);
assert.equal(index.includes('<lastmod>'), false);
assert.equal(index.includes('<urlset'), false);
assert.equal(index.includes('/erazahan-'), false);
assert.equal(serializeSitemapIndexXml(children, origin), serializeSitemapIndexXml(children, origin));
assert.equal(serializeSitemapIndexXml(['/a&b.xml'], origin).includes('/a&amp;b.xml'), true);
const repository = scanContentStore('src/data/content/dreams');
const expectedPaths = {
  hy: isRuntimeLocaleIndexingAllowed('hy') ? legacyUrls : [],
  ru: isRuntimeLocaleIndexingAllowed('ru') ? listPublishedLocaleEntries(repository, 'ru').map((entry) => entry.path) : [],
  en: isRuntimeLocaleIndexingAllowed('en') ? listPublishedLocaleEntries(repository, 'en').map((entry) => entry.path) : [],
};
const serializedPaths = { hy: publicPaths(hy), ru: publicPaths(ru), en: publicPaths(en) };
for (const locale of ['hy', 'ru', 'en']) assertExactPathSet(expectedPaths[locale], serializedPaths[locale], `${locale} sitemap`);
assert.throws(() => assertExactPathSet(legacyUrls, [...legacyUrls.slice(0, -1), legacyUrls[0]], 'fixture'));
assert.throws(() => assertExactPathSet(legacyUrls, [...legacyUrls.slice(0, -1), '/unexpected/'], 'fixture'));
for (const locale of ['ru', 'en']) assert.equal(serializedPaths[locale].every((path) => path.startsWith(`/${locale}/`)), true, `${locale} sitemap has no wrong-locale paths`);
assert.equal(ru.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
assert.equal(en.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
assert.equal(readFileSync('src/pages/robots.txt.ts', 'utf8').includes('Sitemap: ${SITE}/sitemap.xml'), true);
for (const route of ['src/pages/sitemap.xml.ts', 'src/pages/sitemap-hy.xml.ts', 'src/pages/sitemap-ru.xml.ts', 'src/pages/sitemap-en.xml.ts']) {
  assert.equal(readFileSync(route, 'utf8').includes("Content-Type': 'application/xml; charset=utf-8'"), true);
}
console.log('SITEMAP INDEX PASS');
