import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { listLocalizedDreamRouteEntries } from '../../src/lib/content-source/localized-dream-routes.mjs';
import { MultilingualStoreValidationError, scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import { listPublishedLocaleEntries } from '../../src/lib/content-source/published-content.mjs';
import { publicPathFor } from '../../src/lib/content-schema/multilingual-contract.mjs';

const A = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const B = 'cadd4552-097e-5845-b59e-223c36c82488';
const C = '01990c84-9c78-7abc-8def-123456789abc';
const roots = [];

function payload(locale, slug, fingerprint, overrides = {}) {
  return { slug, title: `${locale} title`, description: null, content: `<p>${locale} content</p>`, image_alts: {}, tags: [locale], alphabet_key: null, based_on_source_revision: locale === 'hy' ? null : 1, based_on_source_fingerprint: locale === 'hy' ? null : fingerprint, ...overrides };
}
function published(locale, slug, overrides = {}) { return (fingerprint) => ({ draft: null, published: { ...payload(locale, slug, fingerprint, overrides), version: 1, published_at: '2026-09-14' } }); }
function draft(locale, slug) { return (fingerprint) => ({ draft: payload(locale, slug, fingerprint), published: null }); }
function both(locale, draftSlug, publishedSlug) { return (fingerprint) => ({ draft: payload(locale, draftSlug, fingerprint), published: { ...payload(locale, publishedSlug, fingerprint), version: 1, published_at: '2026-09-14' } }); }
function root() { const value = mkdtempSync(path.join(tmpdir(), 'erazahan-localized-routes-')); roots.push(value); return value; }
function write(rootPath, relative, value) { const target = path.join(rootPath, relative); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`); }
function add(rootPath, id, { ru = null, en = null } = {}) {
  const hyPublished = { ...payload('hy', `hy-${id.slice(0, 8)}`, null), version: 1, published_at: '2026-09-14' };
  const item = { schema_version: 1, content_id: id, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1, source_fingerprint: sourceFingerprintV1(hyPublished), fingerprint_spec_version: 1 };
  const base = `${id.slice(0, 2)}/${id}`;
  write(rootPath, `${base}/item.json`, item); write(rootPath, `${base}/hy.json`, { schema_version: 1, content_id: id, locale: 'hy', draft: null, published: hyPublished });
  if (ru) write(rootPath, `${base}/ru.json`, { schema_version: 1, content_id: id, locale: 'ru', ...ru(item.source_fingerprint) });
  if (en) write(rootPath, `${base}/en.json`, { schema_version: 1, content_id: id, locale: 'en', ...en(item.source_fingerprint) });
}

try {
  { const fixture = root(); add(fixture, A, { ru: draft('ru', 'draft-only') }); assert.deepEqual(listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'), []); }
  { const fixture = root(); add(fixture, A); const repository = scanContentStore(fixture); assert.equal(listLocalizedDreamRouteEntries(repository, 'ru').length, 0); assert.equal(listLocalizedDreamRouteEntries(repository, 'en').length, 0); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'ru-live') }); const routes = listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'); assert.equal(routes.length, 1); assert.equal(routes[0].slug, 'ru-live'); assert.equal(routes[0].path, '/ru/ru-live/'); assert.equal(JSON.stringify(routes[0]).includes('draft'), false); }
  { const fixture = root(); add(fixture, A, { ru: both('ru', 'ru-future', 'ru-old') }); const routes = listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'); assert.equal(routes[0].path, '/ru/ru-old/'); assert.equal(routes.some((route) => route.slug === 'ru-future'), false); }
  { const fixture = root(); add(fixture, A, { ru: both('ru', 'secret-new-slug', 'public-old-slug') }); const file = `${A.slice(0, 2)}/${A}/ru.json`; const doc = JSON.parse(readFileSync(path.join(fixture, file), 'utf8')); doc.published.title = 'PUBLIC TITLE'; doc.published.content = 'PUBLIC CONTENT'; doc.draft.title = 'SECRET DRAFT TITLE'; doc.draft.content = 'SECRET DRAFT CONTENT'; write(fixture, file, doc); const route = listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru')[0]; const serialized = JSON.stringify({ entry: route.entry }); for (const secret of ['secret-new-slug', 'SECRET DRAFT TITLE', 'SECRET DRAFT CONTENT', '"draft"']) assert.equal(serialized.includes(secret), false); for (const publicValue of ['public-old-slug', 'PUBLIC TITLE', 'PUBLIC CONTENT']) assert.equal(serialized.includes(publicValue), true); assert.equal(route.slug, 'public-old-slug'); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'outdated', { based_on_source_revision: 2 }) }); assert.equal(listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru').length, 1); }
  { const fixture = root(); add(fixture, A, { en: published('en', 'same') }); assert.deepEqual(listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'), []); assert.equal(listLocalizedDreamRouteEntries(scanContentStore(fixture), 'en')[0].path, '/en/same/'); }
  { const fixture = root(); add(fixture, B, { ru: published('ru', 'z') }); add(fixture, A, { ru: published('ru', 'a'), en: published('en', 'a') }); add(fixture, C, { en: published('en', 'c') }); const repository = scanContentStore(fixture); const first = listLocalizedDreamRouteEntries(repository, 'ru'); const second = listLocalizedDreamRouteEntries(repository, 'ru'); const enRoutes = listLocalizedDreamRouteEntries(repository, 'en'); assert.deepEqual(first.map((route) => route.entry.content_id), second.map((route) => route.entry.content_id)); assert.equal(new Set(first.map((route) => route.path)).size, first.length); assert.equal(enRoutes.some((route) => route.path === '/en/a/'), true); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'safe') }); const target = `${A.slice(0, 2)}/${A}/ru.json`; const doc = JSON.parse(readFileSync(path.join(fixture, target), 'utf8')); doc.published.slug = 'a%2Fb'; write(fixture, target, doc); assert.throws(() => scanContentStore(fixture), (error) => error instanceof MultilingualStoreValidationError); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'same') }); add(fixture, B, { ru: published('ru', 'same') }); assert.throws(() => listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'), MultilingualStoreValidationError); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'safe') }); const target = `${A.slice(0, 2)}/${A}/ru.json`; const doc = JSON.parse(readFileSync(path.join(fixture, target), 'utf8')); doc.locale = 'en'; write(fixture, target, doc); assert.throws(() => listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'), MultilingualStoreValidationError); }
  { const fixture = root(); add(fixture, A, { ru: published('ru', 'safe') }); const target = `${A.slice(0, 2)}/${A}/ru.json`; const doc = JSON.parse(readFileSync(path.join(fixture, target), 'utf8')); doc.content_id = B; write(fixture, target, doc); assert.throws(() => listLocalizedDreamRouteEntries(scanContentStore(fixture), 'ru'), MultilingualStoreValidationError); }
  {
    const real = scanContentStore('src/data/content/dreams');
    assert.equal(listLocalizedDreamRouteEntries(real, 'ru').length, 0);
    assert.equal(listLocalizedDreamRouteEntries(real, 'en').length, 0);
    const hy = listPublishedLocaleEntries(real, 'hy');
    assert.equal(hy.length, 5800);
    assert.equal(hy.filter((entry) => entry.path !== publicPathFor('hy', entry.slug)).length, 0);
    assert.equal(existsSync(path.resolve('dist/ru')), false);
    assert.equal(existsSync(path.resolve('dist/en')), false);
  }
  console.log('LOCALIZED DREAM ROUTES PASS');
} finally { for (const fixture of roots) rmSync(fixture, { recursive: true, force: true }); }
