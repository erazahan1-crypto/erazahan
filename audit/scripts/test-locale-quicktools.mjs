import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pages = [
  { locale: 'hy', file: 'dist/index.html', endpoint: '/search-index.json', valid: 'առաջին' },
];

const localizedPages = [
  { locale: 'ru', file: 'dist/ru/index.html' },
  { locale: 'en', file: 'dist/en/index.html' },
  { locale: 'ru', file: 'dist/ru/search/index.html' },
  { locale: 'en', file: 'dist/en/search/index.html' },
];

class Element {
  constructor() {
    this.innerHTML = ''; this.value = ''; this.events = new Map(); this.focused = false; this.attrs = {};
    this.classList = { values: new Set(['hidden']), add: (...values) => values.forEach((value) => this.classList.values.add(value)), remove: (...values) => values.forEach((value) => this.classList.values.delete(value)), toggle: (value, enabled) => enabled ? this.classList.values.add(value) : this.classList.values.delete(value), contains: (value) => this.classList.values.has(value) };
  }
  addEventListener(type, listener) { this.events.set(type, listener); }
  setAttribute(name, value) { this.attrs[name] = value; }
  focus() { this.focused = true; }
  fire(type, event = {}) { this.events.get(type)?.({ target: this, ...event }); }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function withGeneratedClient(page, index, { deferFetch = false } = {}, verify) {
  const html = readFileSync(page.file, 'utf8');
  const hasAlphabet = html.includes('id="quick-alpha"');
  if (page.locale === 'hy') {
    assert.equal(hasAlphabet, true, 'HY retains its legacy alphabet action');
    assert.equal(html.includes('id="panel-alpha"'), true, 'HY retains its legacy alphabet panel');
  } else {
    assert.equal(hasAlphabet, false, `${page.locale} zero-group page has no alphabet action`);
    assert.equal(html.includes('id="panel-alpha"'), false, `${page.locale} zero-group page has no alphabet panel`);
  }
  const encoded = html.match(/data-quick-search-config="([^"]+)"/)?.[1];
  const config = JSON.parse((encoded || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  const asset = html.match(/src="(\/_astro\/QuickTools[^\"]+\.js)"/)?.[1];
  assert.ok(asset, `${page.locale} discovers its generated QuickTools asset from built HTML`);
  assert.equal(config.indexEndpoint, page.endpoint, `${page.locale} serializes its own endpoint`);
  assert.ok(html.includes(config.searchCopy.heading), `${page.locale} built DOM contains localized heading`);
  assert.ok(html.includes(config.searchCopy.placeholder), `${page.locale} built DOM contains localized placeholder`);
  const ids = ['to-top', 'quick-overlay', 'panel-menu', 'panel-search', 'quick-menu', 'quick-search', 'quick-search-input', 'quick-search-results'];
  if (hasAlphabet) ids.push('panel-alpha', 'quick-alpha');
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  const close = new Element(); const configElement = new Element(); configElement.dataset = { quickSearchConfig: JSON.stringify(config) };
  const documentEvents = new Map(); const fetched = []; let releaseFetch; let urlReads = 0;
  const previous = { document: globalThis.document, window: globalThis.window, fetch: globalThis.fetch, location: globalThis.location, history: globalThis.history };
  globalThis.document = { getElementById: (id) => elements[id] || null, querySelector: (selector) => selector === '[data-quick-search-config]' ? configElement : null, querySelectorAll: (selector) => selector === '.quick-close' ? [close] : [], addEventListener: (type, listener) => documentEvents.set(type, listener) };
  globalThis.window = new Proxy({ scrollY: 0, addEventListener() {}, scrollTo() {} }, { get(target, property) { if (property === 'location' || property === 'history') { urlReads += 1; throw new Error('QuickTools must not use browser URL state'); } return target[property]; } });
  globalThis.location = new Proxy({}, { get() { urlReads += 1; throw new Error('QuickTools must not read location'); } });
  globalThis.history = new Proxy({}, { get() { urlReads += 1; throw new Error('QuickTools must not write history'); } });
  globalThis.fetch = async (url) => { fetched.push(url); if (deferFetch) await new Promise((resolve) => { releaseFetch = resolve; }); return { json: async () => index }; };
  try {
    await import(`${pathToFileURL(path.resolve('dist', asset.slice(1))).href}?quicktools=${page.locale}-${Math.random()}`);
    await new Promise((resolve) => setImmediate(resolve));
    await verify({ asset, config, elements, fetched, close, documentEvents, hasAlphabet, releaseFetch: () => releaseFetch?.(), urlReads: () => urlReads });
  } finally { Object.assign(globalThis, previous); }
}

for (const page of pages) {
  const invalid = page.locale === 'hy' ? '/slug/' : `/${page.locale}/slug/`;
  await withGeneratedClient(page, [{ slug: page.valid, title: page.valid }, { slug: invalid, title: 'invalid-match' }, { slug: page.valid, title: 'second sibling' }], { deferFetch: true }, async (run) => {
    assert.deepEqual(run.fetched, [], `${page.locale} does not fetch before lazy search open`);
    run.elements['quick-menu'].fire('click');
    assert.ok(run.elements['panel-menu'].classList.contains('flex'), `${page.locale} opens menu panel`);
    run.documentEvents.get('keydown')?.({ key: 'Escape' });
    assert.ok(run.elements['quick-overlay'].classList.contains('hidden'), `${page.locale} closes menu through Escape`);
    run.elements['quick-search'].fire('click');
    assert.deepEqual(run.fetched, [page.endpoint], `${page.locale} fetches only its configured endpoint on open`);
    assert.ok(run.elements['quick-search-results'].innerHTML.includes(run.config.searchCopy.loading), `${page.locale} observes configured loading copy at runtime`);
    assert.equal(run.elements['quick-search-input'].focused, true, `${page.locale} focuses input on open`);
    assert.ok(run.elements['panel-search'].classList.contains('flex'), `${page.locale} opens search panel`);
    run.releaseFetch(); await tick();
    assert.ok(run.elements['quick-search-results'].innerHTML.includes(run.config.searchCopy.empty_query), `${page.locale} observes configured empty-query copy at runtime`);
    run.elements['quick-search-input'].value = page.valid; run.elements['quick-search-input'].fire('input');
    const rendered = run.elements['quick-search-results'].innerHTML;
    assert.equal((rendered.match(/<a href=/g) || []).length, 2, `${page.locale} omits malformed match while retaining valid siblings`);
    assert.ok(rendered.includes(`${run.config.resultPathPrefix}${page.valid}/`), `${page.locale} real client renders raw-slug href`);
    assert.equal(rendered.includes(invalid), false, `${page.locale} real client does not repair malformed slug`);
    assert.equal(rendered.includes(`/${page.locale}/${page.locale}/`), false, `${page.locale} real client has no doubled locale prefix`);
    run.elements['quick-overlay'].fire('click'); assert.ok(run.elements['quick-overlay'].classList.contains('hidden'), `${page.locale} closes through overlay`);
    run.elements['quick-search'].fire('click'); run.close.fire('click'); assert.ok(run.elements['quick-overlay'].classList.contains('hidden'), `${page.locale} closes through close control`);
    run.elements['quick-search'].fire('click'); run.documentEvents.get('keydown')?.({ key: 'Escape' }); assert.ok(run.elements['quick-overlay'].classList.contains('hidden'), `${page.locale} closes through Escape`);
    run.elements['quick-search'].fire('click'); run.elements['quick-search'].fire('click'); await tick();
    assert.deepEqual(run.fetched, [page.endpoint], `${page.locale} keeps fetch-once behavior after repeat opens`);
    assert.equal(run.urlReads(), 0, `${page.locale} client neither reads nor writes URL state`);
  });
  await withGeneratedClient(page, [{ slug: invalid, title: 'all invalid' }], {}, async (run) => {
    run.elements['quick-search'].fire('click'); await tick(); run.elements['quick-search-input'].value = 'all invalid'; run.elements['quick-search-input'].fire('input');
    assert.equal((run.elements['quick-search-results'].innerHTML.match(/<a href=/g) || []).length, 0, `${page.locale} all-invalid set renders zero links`);
    assert.ok(run.elements['quick-search-results'].innerHTML.includes(run.config.searchCopy.no_results), `${page.locale} all-invalid set reaches localized no-results state`);
    assert.ok(run.elements['panel-search'].classList.contains('flex'), `${page.locale} panel remains usable after all-invalid set`);
  });
}

await withGeneratedClient(pages[0], Array.from({ length: 31 }, (_, index) => ({ slug: `rank-${index}`, title: 'same ranking term' })), {}, async (run) => {
  run.elements['quick-search'].fire('click'); await tick(); run.elements['quick-search-input'].value = 'same ranking term'; run.elements['quick-search-input'].fire('input');
  const rendered = run.elements['quick-search-results'].innerHTML;
  assert.equal((rendered.match(/<a href=/g) || []).length, 30, 'real ranking path enforces its 30-result limit');
  assert.ok(rendered.indexOf('/rank-0/') < rendered.indexOf('/rank-1/'), 'real ranking path preserves stable tie order');
});

await withGeneratedClient(pages[0], [], {}, async (run) => {
  assert.equal(run.hasAlphabet, true, 'HY fixture retains alphabet controls');
  run.elements['quick-alpha'].fire('click');
  assert.ok(run.elements['panel-alpha'].classList.contains('flex'), 'HY opens alphabet panel');
  run.elements['quick-overlay'].fire('click');
  assert.ok(run.elements['quick-overlay'].classList.contains('hidden'), 'HY closes alphabet through overlay');
});

for (const page of localizedPages) {
  const html = readFileSync(page.file, 'utf8');
  assert.equal(html.includes('data-quick-search-config'), false, `${page.locale} localized page omits the HY QuickTools search configuration`);
  assert.equal(html.includes('id="quick-search"'), false, `${page.locale} localized page omits the HY QuickTools search control`);
  assert.equal(html.includes('id="quick-alpha"'), false, `${page.locale} localized page omits the HY QuickTools alphabet control`);
}

const hyQuickToolsAsset = readFileSync('dist/index.html', 'utf8').match(/src="(\/_astro\/QuickTools[^\"]+\.js)"/)?.[1];
assert.ok(hyQuickToolsAsset, 'HY output retains its generated QuickTools asset');
const quickToolsAsset = readFileSync(path.join('dist', hyQuickToolsAsset.slice(1)), 'utf8');
for (const forbidden of ['locale-search-ui.mjs', 'node:crypto', 'node:fs', 'node:path', 'fingerprint', 'schema', 'content-repository', 'multilingual-store', 'published-resolver']) assert.equal(quickToolsAsset.includes(forbidden), false, `QuickTools client dependency graph excludes server-only ${forbidden}`);
console.log('LOCALE QUICKTOOLS PASS');
