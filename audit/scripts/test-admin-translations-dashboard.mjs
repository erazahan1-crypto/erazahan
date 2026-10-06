import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicPathFor } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { projectTranslationDashboard, translationDashboardSearchText } from '../../src/lib/content-source/translation-dashboard.mjs';

const dashboard = readFileSync('src/pages/admin/translations/index.astro', 'utf8');
const layout = readFileSync('src/layouts/AdminLayout.astro', 'utf8');
assert.match(dashboard, /projectTranslationDashboard\(scanContentStore\('src\/data\/content\/dreams'\)\)/);
assert.match(dashboard, /const PAGE_SIZE = 50/);
assert.match(dashboard, /data-search/);
assert.match(dashboard, /data-locale/);
assert.match(dashboard, /data-state/);
assert.match(dashboard, /data-sort/);
assert.match(dashboard, /'NOT_CREATED' \? 'Создать перевод' : 'Редактировать'/);
assert.match(dashboard, /if \(data\.published\).*'Открыть'/s);
assert.match(dashboard, /new URLSearchParams\(\{ content_id: contentId, locale \}\)/);
assert.match(dashboard, /translationDashboardSearchText\(row\)/);
assert.match(dashboard, /<script id="translation-dashboard-data" type="application\/json" set:html=\{dashboardData\}><\/script>/);
assert.match(dashboard, /<script>\s+import \{ translationDashboardSearchText \}/);
assert.doesNotMatch(dashboard, /<script define:vars=[\s\S]*?\bimport\s/s, 'a define:vars script cannot contain a raw ES import');
assert.equal(/fetch\(/.test(dashboard), false, 'dashboard needs no runtime API');
assert.equal(/method:\s*['"]POST/.test(dashboard), false, 'dashboard cannot write');
assert.match(layout, /href="\/admin\/translations\/"[^>]*>Переводы/);

const dashboardHtml = readFileSync('dist/admin/translations/index.html', 'utf8');
assert.match(dashboardHtml, /<script id="translation-dashboard-data" type="application\/json">/, 'dashboard data is serialized separately from executable JavaScript');
assert.match(dashboardHtml, /<script type="module" src="\/_astro\/[^\"]+\.js"><\/script>/, 'dashboard executable JavaScript is emitted as an Astro module asset');
for (const script of dashboardHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const [, attributes, content] = script;
  if (/type="application\/json"/i.test(attributes)) continue;
  if (/\bimport\s/.test(content)) assert.match(attributes, /type="module"/i, 'raw ES imports are permitted only in module scripts');
}

const repository = scanContentStore('src/data/content/dreams');
const canonicalHyPosts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
const rows = projectTranslationDashboard(repository);
assert.equal(rows.length, repository.counts.hy_documents, 'every HY logical item projects once');
assert.equal(rows.length, canonicalHyPosts.length, 'every current canonical HY post projects once');
assert.equal(new Set(rows.map((row) => row.content_id)).size, rows.length, 'no duplicate content IDs');
for (const row of rows) assert.ok(row.hy.title && row.hy.slug, 'HY context is present');

for (const locale of ['ru', 'en']) {
  const expectedNotCreated = repository.records.filter((record) => !record.locales[locale]).length;
  assert.equal(rows.filter((row) => row[locale].publication_state === 'NOT_CREATED').length, expectedNotCreated, `${locale} not-created count follows persisted locale documents`);
}

for (const record of repository.records) {
  const row = rows.find((candidate) => candidate.content_id === record.content_id);
  for (const locale of ['ru', 'en']) {
    const document = record.locales[locale];
    if (!document) { assert.equal(row[locale].publication_state, 'NOT_CREATED'); continue; }
    assert.equal(row[locale].draft?.title ?? null, document.draft?.title ?? null);
    assert.equal(row[locale].published?.title ?? null, document.published?.title ?? null);
    assert.equal(row[locale].published?.path ?? null, document.published ? publicPathFor(locale, document.published.slug) : null);
  }
}

const prototype = repository.records.find((record) => record.locales.en?.published)?.locales.en;
assert.ok(prototype?.published, 'production contains a localized payload without identifying a pilot');
const source = repository.records[0];
const { version: ignoredVersion, published_at: ignoredPublishedAt, ...localizedPayload } = prototype.published;
const payload = (title, slug) => ({ ...localizedPayload, title, slug, alphabet_key: title[0], based_on_source_revision: source.item.source_revision, based_on_source_fingerprint: source.item.source_fingerprint });
const document = ({ draft = null, published = null }) => ({ schema_version: 1, content_id: source.content_id, locale: 'en', draft, published });
const fixture = (item, en = null) => ({ records: [{ content_id: source.content_id, item, locales: { hy: source.locales.hy, ...(en ? { en } : {}) } }] });
const notCreatedRow = projectTranslationDashboard(fixture(source.item))[0];
const draftOnlyRow = projectTranslationDashboard(fixture(source.item, document({ draft: payload('Draft searchable title', 'draft-searchable-slug') })))[0];
const publishedOnlyRow = projectTranslationDashboard(fixture(source.item, document({ published: { ...payload('Published title', 'published-slug'), version: 1, published_at: '2026-09-15' } })))[0];
const bothRow = projectTranslationDashboard(fixture(source.item, document({ draft: payload('New draft title', 'new-draft-slug'), published: { ...payload('Public title', 'public-slug'), version: 1, published_at: '2026-09-15' } })))[0];
const outdatedRow = projectTranslationDashboard(fixture({ ...source.item, source_revision: source.item.source_revision + 1, source_fingerprint: 'a'.repeat(64) }, document({ published: { ...payload('Old public title', 'old-public-slug'), version: 1, published_at: '2026-09-15' } })))[0];
const { en: notCreated } = notCreatedRow; const { en: draftOnly } = draftOnlyRow; const { en: publishedOnly } = publishedOnlyRow; const { en: both } = bothRow; const { en: outdated } = outdatedRow;
assert.equal(notCreated.publication_state, 'NOT_CREATED');
assert.equal(draftOnly.publication_state, 'DRAFT'); assert.equal(draftOnly.published, null);
assert.equal(publishedOnly.publication_state, 'PUBLISHED'); assert.equal(publishedOnly.published.path, publicPathFor('en', 'published-slug'));
assert.equal(both.publication_state, 'PUBLISHED_WITH_DRAFT'); assert.equal(both.published.path, publicPathFor('en', 'public-slug'));
assert.equal(outdated.publication_state, 'PUBLISHED'); assert.equal(outdated.outdated, true, 'freshness is derived separately from lifecycle');
assert.match(translationDashboardSearchText(draftOnlyRow), /draft searchable title/);
assert.match(translationDashboardSearchText(draftOnlyRow), /draft-searchable-slug/);
assert.match(translationDashboardSearchText(bothRow), /new draft title/);
assert.match(translationDashboardSearchText(bothRow), /public-slug/);
assert.equal(JSON.stringify(rows).includes('SECRET DRAFT'), false, 'current public dashboard data does not create public artifacts');

console.log('ADMIN TRANSLATIONS DASHBOARD PASS');
