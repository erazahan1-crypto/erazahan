import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { rankSearch } from '../../src/lib/public-search.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { projectPostTranslations, projectTranslationDashboard } from '../../src/lib/content-source/translation-dashboard.mjs';
import { publicPathFor } from '../../src/lib/content-schema/multilingual-contract.mjs';

const source = readFileSync('src/pages/admin/posts/index.astro', 'utf8');
const posts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
const repository = scanContentStore('src/data/content/dreams');
const projection = projectPostTranslations(repository, posts);
const dashboard = new Map(projectTranslationDashboard(repository).map((row) => [row.content_id, row]));
assert.equal(projection.content_ids.length, repository.records.length);
assert.equal(new Set(projection.content_ids).size, repository.records.length);
projection.content_ids.forEach((id, index) => assert.equal(dashboard.get(id).hy.slug, posts[index].slug));
for (const locale of ['ru', 'en']) {
  assert.equal(projection[locale].length, repository.records.filter((row) => row.locales[locale]?.draft || row.locales[locale]?.published).length);
  for (const { content_id, ...state } of projection[locale]) assert.deepEqual(state, dashboard.get(content_id)[locale]);
}
assert.throws(() => projectPostTranslations(repository, posts.slice(1)), /exactly once/);
assert.throws(() => projectPostTranslations(repository, [posts[0], ...posts.slice(0, -1)]), /exactly once/);

// Independent schema-valid fixtures, with no production translation or pilot dependency.
const payload = (locale, slug, title) => ({ slug, title, description: null, content: 'fixture body', image_alts: {}, tags: [], alphabet_key: locale === 'ru' ? 'П' : 'E', updated_at: '2026-09-01T00:00:00Z', generation: { kind: 'human' }, based_on_source_revision: 1, based_on_source_fingerprint: 'a'.repeat(64) });
const records = Array.from({ length: 65 }, (_, index) => {
  const content_id = randomUUID().replace(/^(.{14})./, '$17');
  const item = { schema_version: 1, content_id, type: 'dream_dictionary', source_locale: 'hy', source_revision: index === 4 ? 2 : 1, source_fingerprint: 'a'.repeat(64), fingerprint_spec_version: 1 };
  const locales = { hy: { published: { title: `Աղբյուր ${index}`, slug: `source-${index}` } } };
  for (const locale of ['ru', 'en']) {
    if (index > 4) continue;
    const draft = payload(locale, locale === 'ru' ? `черновик-${index}` : `draft-${index}`, locale === 'ru' ? `Правка ${index}` : `Editable ${index}`);
    const published = { ...payload(locale, locale === 'ru' ? `публикация-${index}` : `public-${index}`, locale === 'ru' ? `Публичный ${index}` : `Public ${index}`), version: 1, published_at: '2026-09-01' };
    locales[locale] = { schema_version: 1, content_id, locale, draft: index === 1 || index === 3 ? draft : null, published: index >= 2 ? published : null };
  }
  return { content_id, item, locales };
});
const fixturePosts = records.map((record, index) => ({ id: String(index), ...record.locales.hy.published, categories: index % 2 ? [' category ', 'category'] : 'other' }));
const fixture = projectPostTranslations({ records }, fixturePosts);
for (const locale of ['ru', 'en']) {
  assert.equal(fixture[locale].length, 4, 'empty documents and absent documents excluded');
  assert.deepEqual(fixture[locale].map((row) => row.publication_state), ['DRAFT', 'PUBLISHED', 'PUBLISHED_WITH_DRAFT', 'PUBLISHED']);
  assert.equal(fixture[locale][3].outdated, true);
}

// Execute the actual Astro client controller against a minimal DOM, as editor tests do.
class Element {
  value = ''; hidden = false; disabled = false; children = []; attributes = {}; listeners = {}; dataset = {}; textContent = '';
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
const elements = new Map();
const buttons = ['hy', 'ru', 'en'].map((language) => Object.assign(new Element(), { dataset: { language } }));
const document = {
  querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
  querySelectorAll() { return buttons; },
  createElement(tagName) { return Object.assign(new Element(), { tagName }); },
};
const node = (name) => document.querySelector(`[data-${name}]`);
document.querySelector('#post-translations-data').textContent = JSON.stringify(fixture);
node('sort').value = 'source';
const requests = [];
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/import \{ rankSearch \} from '[^']+';/, '').replace(/\n    load\(\);/, '');
const controller = Function('document', 'fetch', 'rankSearch', 'window', 'scrollTo', `${stripTypeScriptTypes(script)}; return { load, filteredRows, renderRow, render };`)(document, async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => fixturePosts };
}, rankSearch, { setTimeout: (callback) => { callback(); return 0; } }, () => {});
await controller.load();
const selectLanguage = (locale) => buttons.find((button) => button.dataset.language === locale).listeners.click();
const links = (article) => article.children[2].children;
const hrefParams = (link) => new URL(link.href, 'https://example.test').searchParams;
assert.equal(controller.filteredRows().length, fixturePosts.length);
assert.equal(node('list').children.length, 50);
node('next').listeners.click();
assert.equal(node('list').children.length, fixturePosts.length - 50);
const hyArticle = controller.renderRow(fixturePosts[0]);
assert.equal(links(hyArticle)[0].href, '/admin/posts/edit/?id=0');
assert.equal(links(hyArticle)[1].href, '/source-0/');
fixturePosts.forEach((post, index) => {
  const indicators = links(controller.renderRow(post)).slice(2);
  for (const [offset, locale] of ['ru', 'en'].entries()) {
    assert.equal(hrefParams(indicators[offset]).get('content_id'), records[index].content_id);
    assert.equal(hrefParams(indicators[offset]).get('locale'), locale);
    const state = fixture[locale].find((row) => row.content_id === records[index].content_id);
    assert.match(indicators[offset].textContent, new RegExp({ DRAFT: 'Черновик', PUBLISHED: 'Опубликован', PUBLISHED_WITH_DRAFT: 'Опубликован \\+ черновик', NOT_CREATED: 'Нет' }[state?.publication_state ?? 'NOT_CREATED']));
    assert.equal(indicators[offset].children.length > 0, state?.outdated ?? false);
  }
});
node('search').value = 'source-1';
node('category').value = 'category';
const expectedHy = rankSearch('source-1', fixturePosts, fixturePosts.length).filter((row) => Number(row.id) % 2);
assert.deepEqual(controller.filteredRows(), expectedHy);
node('sort').value = 'title';
assert.deepEqual(controller.filteredRows(), [...expectedHy].sort((a, b) => a.title.localeCompare(b.title, 'hy-AM', { sensitivity: 'base', numeric: true })));
for (const locale of ['ru', 'en']) {
  selectLanguage(locale);
  assert.equal(node('category-control').hidden, true);
  assert.equal(node('category').disabled, true);
  assert.equal(buttons.find((button) => button.dataset.language === locale).attributes['aria-pressed'], 'true');
  assert.equal(controller.filteredRows().length, fixture[locale].length);
  assert.equal(node('list').children.length, fixture[locale].length, 'switch resets pagination');
  assert.equal(node('total').textContent, String(fixture[locale].length));
  node('category').value = 'nonexistent';
  assert.equal(controller.filteredRows().length, fixture[locale].length, 'HY taxonomy cannot filter translations');
  for (const row of controller.filteredRows()) {
    const state = row.translation;
    const editable = state.draft ?? state.published;
    assert.equal(row.title, editable.title);
    assert.equal(row.slug, editable.slug);
    const article = controller.renderRow(row);
    assert.equal(article.children[0].textContent, editable.title);
    assert.equal(article.children[1].textContent, editable.slug);
    assert.equal(hrefParams(links(article)[0]).get('content_id'), state.content_id);
    assert.equal(hrefParams(links(article)[0]).get('locale'), locale);
    assert.equal(links(article).length, state.published ? 2 : 1);
    if (state.published) assert.equal(links(article)[1].href, publicPathFor(locale, state.published.slug));
    assert.equal(article.children[0].children.length, state.outdated ? 2 : 1);
  }
  node('search').value = locale === 'ru' ? 'ПРАВКА' : 'EDITABLE';
  assert.equal(controller.filteredRows().length, 2);
  node('search').value = locale === 'ru' ? 'черновик-3' : 'draft-3';
  assert.equal(controller.filteredRows().length, 1);
  node('search').value = 'Աղբյուր';
  assert.equal(controller.filteredRows().length, 0, 'HY titles are not searched in localized mode');
  node('search').value = '';
  for (const key of ['title', 'slug']) {
    node('sort').value = key;
    const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    const result = controller.filteredRows();
    assert.deepEqual(result, [...result].sort((a, b) => collator.compare(a[key], b[key]) || a.id.localeCompare(b.id)));
  }
  const malicious = { ...controller.filteredRows()[0], title: '</script><img src=x onerror=alert(1)>', slug: '<unsafe>' };
  const rendered = controller.renderRow(malicious);
  assert.equal(rendered.children[0].textContent, malicious.title);
  assert.equal(rendered.children[1].textContent, malicious.slug);
}
selectLanguage('hy');
assert.equal(node('category-control').hidden, false);
assert.equal(node('category').disabled, false);
assert.equal(node('search').value, 'source-1');
assert.equal(node('category').value, 'category');
assert.equal(node('sort').value, 'title');
assert.equal(requests.length, 1, 'switching tabs never fetches or writes');
assert.equal(requests[0].url, '/admin/posts/data.json');
assert.equal(requests[0].options.method, undefined);
assert.doesNotMatch(source, /innerHTML|define:vars|method:\s*['"](?:POST|PUT|PATCH|DELETE)|\/api\//);
assert.doesNotMatch(source, /5800|5 800/);

// Evaluate the exact serializer against an HTML/script-breakout fixture.
const serializer = source.match(/const translationData = ([^\n]+);/)[1];
const hostile = { title: '</script><script>alert(1)</script>&' };
const serialized = Function('translations', `return ${serializer}`)(hostile);
assert.doesNotMatch(serialized, /[<>&]/);
assert.deepEqual(JSON.parse(serialized), hostile);

if (process.argv.includes('--built')) {
  const html = readFileSync('dist/admin/posts/index.html', 'utf8');
  const data = html.match(/<script id="post-translations-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(data);
  assert.deepEqual(JSON.parse(data[1]), projection);
  assert.doesNotMatch(data[1], /[<>&]/);
  const module = html.match(/<script type="module" src="([^\"]+)"><\/script>/);
  assert.ok(module, 'Astro emits executable client as a module asset');
  const asset = readFileSync(`dist${module[1]}`, 'utf8');
  assert.match(asset, /data-language/);
  for (const [, attributes, content] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type="application\/json"/.test(attributes)) continue;
    if (/\bimport\s/.test(content)) assert.match(attributes, /type="module"/);
  }
}
console.log(`ADMIN POST LANGUAGE VIEWS PASS (${projection.content_ids.length} canonical HY identities; fixture lifecycle, DOM, filters, pagination, safety${process.argv.includes('--built') ? ', generated module' : ''})`);
