import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import { scanContentStore } from '../../src/lib/content-source/multilingual-store.mjs';
import {
  PUBLIC_LOCALES,
  assertPublicLocale,
  localeAlphabet,
  localeDream,
  localeHome,
  localeMetadata,
  localeNavigation,
  localeSearch,
  localeUiCopy,
  publishedLocaleHref,
  publishedLocaleVariants,
} from '../../src/lib/public-locale.mjs';

const ID = 'efa61838-86c8-56b8-815c-0a38b0a83242';
const roots = [];
const ruFixtureSlug = (slug) => [...slug].map((character) => character.codePointAt(0)).join('-');

function payload(locale, slug, fingerprint) {
  return {
    slug: locale === 'ru' ? ruFixtureSlug(slug) : slug,
    title: `${locale} title`, description: null, content: `<p>${locale} content</p>`, image_alts: {}, tags: [locale], alphabet_key: null,
    based_on_source_revision: locale === 'hy' ? null : 1,
    based_on_source_fingerprint: locale === 'hy' ? null : fingerprint,
  };
}

function localeDocument(locale, state, slug, fingerprint, publishedSlug = null) {
  const draft = state === 'draft' || state === 'both' ? payload(locale, slug, fingerprint) : null;
  const published = state === 'published' || state === 'both'
    ? { ...payload(locale, publishedSlug ?? slug, fingerprint), version: 1, published_at: '2026-09-14' }
    : null;
  return { schema_version: 1, content_id: ID, locale, draft, published };
}

function repository({ ru = null, en = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'erazahan-public-locale-'));
  roots.push(root);
  const hyPublished = { ...payload('hy', 'hy-dream', null), version: 1, published_at: '2026-09-14' };
  const item = {
    schema_version: 1, content_id: ID, type: 'dream_dictionary', source_locale: 'hy', source_revision: 1,
    source_fingerprint: sourceFingerprintV1(hyPublished), fingerprint_spec_version: 1,
  };
  const directory = path.join(root, ID.slice(0, 2), ID);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'item.json'), `${JSON.stringify(item)}\n`);
  writeFileSync(path.join(directory, 'hy.json'), `${JSON.stringify({ schema_version: 1, content_id: ID, locale: 'hy', draft: null, published: hyPublished })}\n`);
  for (const [locale, document] of Object.entries({ ru, en })) {
    if (document) {
      const [state, slug, publishedSlug] = document;
      writeFileSync(path.join(directory, `${locale}.json`), `${JSON.stringify(localeDocument(locale, state, slug, item.source_fingerprint, publishedSlug))}\n`);
    }
  }
  return scanContentStore(root);
}

try {
  assert.deepEqual(PUBLIC_LOCALES, ['hy', 'ru', 'en']);
  for (const locale of PUBLIC_LOCALES) assert.equal(assertPublicLocale(locale), locale);
  for (const invalid of ['', 'HY', 'ru-RU', 'fr', null, undefined]) assert.throws(() => assertPublicLocale(invalid));

  assert.deepEqual(localeMetadata('hy'), { code: 'hy', root_path: '/', html_lang: 'hy', og_locale: 'hy_AM' });
  assert.deepEqual(localeMetadata('ru'), { code: 'ru', root_path: '/ru/', html_lang: 'ru', og_locale: 'ru_RU' });
  assert.deepEqual(localeMetadata('en'), { code: 'en', root_path: '/en/', html_lang: 'en', og_locale: 'en_US' });
  assert.equal(localeHome('hy'), '/');
  assert.equal(localeHome('ru'), '/ru/');
  assert.equal(localeHome('en'), '/en/');
  assert.equal(localeSearch('hy'), '/search/');
  assert.equal(localeSearch('ru'), '/ru/search/');
  assert.equal(localeSearch('en'), '/en/search/');
  assert.equal(localeAlphabet('hy'), '/erazahan-online/');
  assert.equal(localeAlphabet('ru'), '/ru/letter/');
  assert.equal(localeAlphabet('en'), '/en/letter/');

  assert.equal(localeDream('hy', 'hy-dream'), '/hy-dream/');
  assert.equal(localeDream('ru', ruFixtureSlug('ru-dream')), `/ru/${ruFixtureSlug('ru-dream')}/`);
  assert.equal(localeDream('en', 'en-dream'), '/en/en-dream/');
  for (const invalidSlug of ['ru/en-dream', '/en-dream', 'en-dream/']) assert.throws(() => localeDream('en', invalidSlug));
  assert.throws(() => localeDream('fr', 'dream'));

  assert.deepEqual(localeNavigation('hy'), [
    { id: 'home', label: '\u0533\u056c\u056d\u0561\u057e\u0578\u0580', href: '/' },
    { id: 'search', label: '\u0548\u0580\u0578\u0576\u0578\u0582\u0574', href: '/search/' },
    { id: 'alphabet', label: '\u0531\u0575\u0562\u0578\u0582\u0562\u0565\u0576', href: '/erazahan-online/' },
  ]);
  assert.deepEqual(localeNavigation('ru'), [
    { id: 'home', label: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f', href: '/ru/' },
    { id: 'search', label: '\u041f\u043e\u0438\u0441\u043a', href: '/ru/search/' },
    { id: 'alphabet', label: '\u0410\u043b\u0444\u0430\u0432\u0438\u0442', href: '/ru/letter/' },
  ]);
  assert.deepEqual(localeNavigation('en'), [
    { id: 'home', label: 'Home', href: '/en/' },
    { id: 'search', label: 'Search', href: '/en/search/' },
    { id: 'alphabet', label: 'Alphabet', href: '/en/letter/' },
  ]);
  assert.throws(() => localeNavigation('fr'));
  for (const locale of PUBLIC_LOCALES) {
    assert.ok(localeUiCopy(locale).search.heading);
    assert.equal(localeNavigation(locale).every((item) => item.href !== null && item.href.startsWith('/')), true);
  }

  { // Draft-only translation remains absent and cannot resolve to HY.
    const store = repository({ ru: ['draft', 'ru-draft'] });
    assert.equal(publishedLocaleHref(store, ID, 'ru'), null);
    assert.equal(publishedLocaleHref(store, ID, 'en'), null);
    assert.deepEqual(publishedLocaleVariants(store, ID), [{ locale: 'hy', href: '/hy-dream/' }]);
  }
  { // A published translation is public at its own locale path.
    const store = repository({ ru: ['published', 'ru-published'], en: ['published', 'en-published'] });
    assert.equal(publishedLocaleHref(store, ID, 'ru'), `/ru/${ruFixtureSlug('ru-published')}/`);
    assert.equal(publishedLocaleHref(store, ID, 'en'), '/en/en-published/');
    assert.deepEqual(publishedLocaleVariants(store, ID), [
      { locale: 'hy', href: '/hy-dream/' },
      { locale: 'ru', href: `/ru/${ruFixtureSlug('ru-published')}/` },
      { locale: 'en', href: '/en/en-published/' },
    ]);
  }
  { // PUBLISHED_WITH_DRAFT exposes only the retained published URL.
    const store = repository({ ru: ['both', 'secret-draft', 'public-published'] });
    const href = publishedLocaleHref(store, ID, 'ru');
    assert.equal(href, `/ru/${ruFixtureSlug('public-published')}/`);
    assert.equal(href.includes('secret-draft'), false);
    assert.deepEqual(publishedLocaleVariants(store, ID).find((entry) => entry.locale === 'ru'), { locale: 'ru', href });
  }
  console.log('PUBLIC LOCALE PRIMITIVES PASS');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
