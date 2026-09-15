import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resultHref, renderSearchResult } from '../../src/lib/search/search-result-renderer.mjs';

const origin = 'https://erazahan.info';
const pages = [
  { locale: 'hy', file: 'dist/search/index.html', endpoint: '/search-index.json', canonical: `${origin}/search/`, heading: 'Որոնում', prefix: '/' },
  { locale: 'ru', file: 'dist/ru/search/index.html', endpoint: '/ru/search-index.json', canonical: `${origin}/ru/search/`, heading: 'Поиск', prefix: '/ru/' },
  { locale: 'en', file: 'dist/en/search/index.html', endpoint: '/en/search-index.json', canonical: `${origin}/en/search/`, heading: 'Search', prefix: '/en/' },
];

for (const page of pages) {
  assert.ok(existsSync(page.file), `${page.locale} search page exists`);
  const html = readFileSync(page.file, 'utf8');
  assert.ok(html.includes(page.heading), `${page.locale} localized heading`);
  assert.ok(html.includes(`<link rel="canonical" href="${page.canonical}">`), `${page.locale} self canonical`);
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'), `${page.locale} noindex`);
  const config = JSON.parse(html.match(/data-search-config="([^"]+)"/)?.[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&') || '');
  assert.equal(config.indexEndpoint, page.endpoint, `${page.locale} own index endpoint`);
  assert.equal(config.resultPathPrefix, page.prefix, `${page.locale} raw-slug prefix`);
}

for (const file of ['dist/sitemap.xml', 'dist/sitemap-hy.xml', 'dist/sitemap-ru.xml', 'dist/sitemap-en.xml']) {
  const xml = readFileSync(file, 'utf8');
  for (const route of ['/search/', '/ru/search/', '/en/search/']) assert.equal(xml.includes(route), false, `${file} excludes ${route}`);
}
assert.deepEqual(JSON.parse(readFileSync('dist/ru/search-index.json', 'utf8')), []);
assert.deepEqual(JSON.parse(readFileSync('dist/en/search-index.json', 'utf8')), []);

const fixture = (slug, title = slug) => ({ slug, title });
for (const [prefix, valid, invalid, expected] of [
  ['/', 'առաջին', '/slug/', '/առաջին/'],
  ['/ru/', 'ворона', '/ru/плохой/', '/ru/ворона/'],
  ['/en/', 'crow-in-a-dream', '/en/bad/', '/en/crow-in-a-dream/'],
]) {
  assert.equal(resultHref(prefix, valid), expected, `valid ${prefix} href`);
  assert.throws(() => resultHref(prefix, invalid), TypeError, `path-like ${prefix} slug remains rejected`);
  const rendered = [fixture(valid), fixture(invalid), fixture(valid, 'second')]
    .map((item) => renderSearchResult(item, prefix)).join('');
  assert.equal((rendered.match(/<a href=/g) || []).length, 2, `valid siblings survive ${prefix} invalid result`);
  assert.ok(rendered.includes(expected), `valid ${prefix} link rendered`);
  assert.equal(rendered.includes(invalid), false, `invalid ${prefix} path omitted`);
  assert.equal(rendered.includes(`${prefix}ru/ru/`) || rendered.includes(`${prefix}en/en/`), false, `no doubled ${prefix} prefix`);
}
assert.equal(renderSearchResult(fixture('/ru/invalid/'), '/ru/'), '', 'all-invalid entry is omitted without throwing');

async function executeBuiltClient(page, query, index) {
  const html = readFileSync(page.file, 'utf8');
  const script = html.match(/src="(\/_astro\/(?:SearchPage|search\.astro)[^"]+\.js)"/)?.[1];
  assert.ok(script, `${page.locale} search client asset exists`);
  const input = { value: '', listeners: new Map(), addEventListener(name, handler) { this.listeners.set(name, handler); } };
  const results = { innerHTML: '' };
  const config = { dataset: { searchConfig: JSON.stringify({ indexEndpoint: page.endpoint, resultPathPrefix: page.prefix, copy: { empty_query: 'EMPTY', no_results: 'NONE' } }) } };
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch };
  const fetched = [];
  globalThis.document = { querySelector: () => config, getElementById: (id) => id === 'search-input' ? input : results };
  globalThis.window = { location: { search: query ? `?q=${encodeURIComponent(query)}` : '' } };
  globalThis.fetch = async (url) => { fetched.push(url); return { json: async () => index }; };
  try {
    await import(`${pathToFileURL(path.resolve('dist', script.slice(1))).href}?focused=${page.locale}-${Math.random()}`);
    await new Promise((resolve) => setImmediate(resolve));
    return { input, results, fetched };
  } finally { Object.assign(globalThis, previous); }
}

const [hy, ru, en] = pages;
for (const [page, query, item, href] of [
  [hy, 'առաջին', fixture('առաջին'), '/առաջին/'],
  [ru, 'ворона', fixture('ворона'), '/ru/ворона/'],
  [en, 'crow', fixture('crow-in-a-dream', 'crow'), '/en/crow-in-a-dream/'],
]) {
  const run = await executeBuiltClient(page, query, [item]);
  assert.equal(run.input.value, query, `${page.locale} q query retained`);
  assert.deepEqual(run.fetched, [page.endpoint], `${page.locale} only fetches own index`);
  assert.ok(run.results.innerHTML.includes(href), `${page.locale} client renders configured href`);
}
const empty = await executeBuiltClient(hy, '', []);
assert.equal(empty.results.innerHTML, '', 'HY retains checkpoint empty-without-input behavior after fetch');
const noResults = await executeBuiltClient(hy, 'missing', []);
assert.ok(noResults.results.innerHTML.includes('Ոչինչ չի գտնվել:'), 'HY no-results state preserves checkpoint copy after an unmatched q');
const allInvalid = await executeBuiltClient(en, 'crow', [fixture('/en/crow/')]);
assert.equal(allInvalid.results.innerHTML.includes('<a href='), false, 'all-invalid result set renders no links');
assert.ok(allInvalid.results.innerHTML.includes('NONE'), 'all-invalid result set reaches the no-results state');
for (const page of [ru, en]) {
  const run = await executeBuiltClient(page, 'crow', []);
  assert.equal(run.results.innerHTML.includes('crow-in-a-dream'), false, `${page.locale} cannot fall back to HY results`);
  assert.deepEqual(run.fetched, [page.endpoint], `${page.locale} has no secondary HY fetch`);
}

const assets = readdirSync('dist/_astro').map((name) => readFileSync(path.join('dist/_astro', name), 'utf8')).join('\n');
for (const forbidden of ['node:crypto', 'node:fs', 'node:path', 'multilingual-store', 'fingerprint.mjs']) assert.equal(assets.includes(forbidden), false, `client assets exclude ${forbidden}`);

console.log('LOCALE SEARCH PAGES PASS');
