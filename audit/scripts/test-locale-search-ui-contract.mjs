import assert from 'node:assert/strict';
import { HY_SEARCH_LOCALE, localeSearchUi, searchResultHref } from '../../src/lib/search/locale-search-ui.mjs';

assert.equal(HY_SEARCH_LOCALE, 'hy');

assert.deepEqual(localeSearchUi('hy'), { indexPath: '/search-index.json', searchPagePath: '/search/' });
assert.deepEqual(localeSearchUi('ru'), { indexPath: '/ru/search-index.json', searchPagePath: '/ru/search/' });
assert.deepEqual(localeSearchUi('en'), { indexPath: '/en/search-index.json', searchPagePath: '/en/search/' });

for (const unsupported of ['fr', 'de', 'unknown', '', null, undefined]) {
  assert.throws(() => localeSearchUi(unsupported));
  assert.throws(() => searchResultHref(unsupported, { slug: 'safe-slug' }));
}

assert.equal(searchResultHref('hy', { slug: 'erazahan-dunch' }), '/erazahan-dunch/');
assert.equal(searchResultHref('ru', { slug: 'сон-про-морду' }), '/ru/сон-про-морду/');
assert.equal(searchResultHref('en', { slug: 'muzzle-dream-meaning' }), '/en/muzzle-dream-meaning/');
assert.throws(() => searchResultHref('hy', { slug: '/slug/' }));
assert.throws(() => searchResultHref('ru', { slug: '/ru/slug/' }));
assert.throws(() => searchResultHref('en', { slug: '/en/slug/' }));
assert.throws(() => searchResultHref('ru', { slug: 'ru/сон-про-морду' }));
assert.throws(() => searchResultHref('en', { slug: 'en/muzzle-dream-meaning' }));
assert.throws(() => searchResultHref('ru', null));

assert.deepEqual(localeSearchUi('ru'), localeSearchUi('ru'));
assert.equal(searchResultHref('en', { slug: 'muzzle-dream-meaning' }), searchResultHref('en', { slug: 'muzzle-dream-meaning' }));

console.log('LOCALE SEARCH UI CONTRACT PASS');
