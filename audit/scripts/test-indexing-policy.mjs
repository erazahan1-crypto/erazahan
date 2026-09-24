import assert from 'node:assert/strict';
import { isLocaleIndexingAllowed } from '../../src/lib/indexing-policy.mjs';

const disabled = { PUBLIC_ALLOW_INDEXING: 'false', PUBLIC_ALLOW_LOCALIZED_INDEXING: 'false' };
const globalOnly = { PUBLIC_ALLOW_INDEXING: 'true' };
const released = { PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_ALLOW_LOCALIZED_INDEXING: 'true' };
const localizedOnly = { PUBLIC_ALLOW_INDEXING: 'false', PUBLIC_ALLOW_LOCALIZED_INDEXING: 'true' };

for (const locale of ['hy', 'ru', 'en']) assert.equal(isLocaleIndexingAllowed(locale, disabled), false);
assert.equal(isLocaleIndexingAllowed('hy', globalOnly), true);
assert.equal(isLocaleIndexingAllowed('ru', globalOnly), false);
assert.equal(isLocaleIndexingAllowed('en', globalOnly), false);
for (const locale of ['hy', 'ru', 'en']) assert.equal(isLocaleIndexingAllowed(locale, released), true);
assert.equal(isLocaleIndexingAllowed('hy', localizedOnly), false);
assert.equal(isLocaleIndexingAllowed('ru', localizedOnly), false);
assert.equal(isLocaleIndexingAllowed('en', localizedOnly), false);
for (const value of [undefined, '', 'false', '0', 'TRUE', 'yes']) {
  assert.equal(isLocaleIndexingAllowed('ru', { PUBLIC_ALLOW_INDEXING: 'true', PUBLIC_ALLOW_LOCALIZED_INDEXING: value }), false);
}
assert.throws(() => isLocaleIndexingAllowed('de', released));
console.log('INDEXING POLICY PASS');
