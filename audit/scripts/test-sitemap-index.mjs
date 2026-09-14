import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { serializeSitemapIndexXml } from '../../src/lib/content-source/sitemap-index-xml.mjs';

const origin = 'https://erazahan.info';
const children = ['/sitemap-hy.xml', '/sitemap-ru.xml', '/sitemap-en.xml'];
const urls = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
const urlCount = (xml) => [...xml.matchAll(/<url>/g)].length;
function assertExactUrlSet(legacyUrls, hyUrls) {
  const legacy = new Set(legacyUrls); const hy = new Set(hyUrls);
  assert.equal(legacyUrls.length - legacy.size, 0, 'legacy URLs must be unique');
  assert.equal(hyUrls.length - hy.size, 0, 'HY URLs must be unique');
  assert.deepEqual([...legacy].filter((url) => !hy.has(url)), [], 'HY must not miss legacy URLs');
  assert.deepEqual([...hy].filter((url) => !legacy.has(url)), [], 'HY must not add URLs');
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
assert.equal(urlCount(hy), 5920); assert.equal(urlCount(ru), 0); assert.equal(urlCount(en), 0);
const hyPaths = urls(hy).map((url) => decodeURI(new URL(url).pathname));
assert.equal(legacyUrls.length, 5920); assert.equal(hyPaths.length, 5920);
assertExactUrlSet(legacyUrls, hyPaths);
assert.throws(() => assertExactUrlSet(legacyUrls, [...legacyUrls.slice(0, -1), legacyUrls[0]]));
assert.throws(() => assertExactUrlSet(legacyUrls, [...legacyUrls.slice(0, -1), '/unexpected/']));
assert.equal(ru.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
assert.equal(en.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), true);
assert.equal(readFileSync('src/pages/robots.txt.ts', 'utf8').includes('Sitemap: ${SITE}/sitemap.xml'), true);
for (const route of ['src/pages/sitemap.xml.ts', 'src/pages/sitemap-hy.xml.ts', 'src/pages/sitemap-ru.xml.ts', 'src/pages/sitemap-en.xml.ts']) {
  assert.equal(readFileSync(route, 'utf8').includes("Content-Type': 'application/xml; charset=utf-8'"), true);
}
console.log('SITEMAP INDEX PASS');
