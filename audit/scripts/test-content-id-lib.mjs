import assert from 'node:assert/strict';
import {
  LEGACY_SEED_PREFIX,
  PROJECT_CONTENT_ID_NAMESPACE,
  UUID_NAMESPACE_DNS,
  isUuidVersion,
  legacyContentId,
  legacyIdentitySeed,
  validateLegacySourceUrl,
  uuidV5,
  uuidV7,
} from './content-id-lib.mjs';

assert.equal(PROJECT_CONTENT_ID_NAMESPACE, 'ebb2a826-eae8-511a-af05-0acf27425d75');
assert.equal(LEGACY_SEED_PREFIX, 'legacy:v1:');
assert.equal(UUID_NAMESPACE_DNS, '6ba7b810-9dad-11d1-80b4-00c04fd430c8');
assert.equal(
  uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
  '2ed6657d-e927-568b-95e1-2665a8aea6a2',
  'UUIDv5 must match RFC 9562 Appendix A.4',
);
assert.equal(
  uuidV5('erazahan.info', UUID_NAMESPACE_DNS),
  PROJECT_CONTENT_ID_NAMESPACE,
  'The committed project namespace derivation must remain stable',
);

const historicalSourceUrl = 'https://erazahan.info/example/';
assert.equal(validateLegacySourceUrl(historicalSourceUrl), historicalSourceUrl);
assert.equal(legacyIdentitySeed(historicalSourceUrl), `${LEGACY_SEED_PREFIX}${historicalSourceUrl}`);
const paddedSourceUrl = `  ${historicalSourceUrl}  `;
assert.equal(legacyIdentitySeed(paddedSourceUrl), `${LEGACY_SEED_PREFIX}${paddedSourceUrl}`);

const lowercaseEscapes = 'https://erazahan.info/%d5%a5/';
const uppercaseEscapes = 'https://erazahan.info/%D5%A5/';
assert.notEqual(legacyIdentitySeed(lowercaseEscapes), legacyIdentitySeed(uppercaseEscapes));
assert.notEqual(legacyContentId(lowercaseEscapes), legacyContentId(uppercaseEscapes));

const deterministicId = legacyContentId(historicalSourceUrl);
assert.equal(legacyContentId(historicalSourceUrl), deterministicId);
assert.ok(isUuidVersion(deterministicId, 5));
assert.match(deterministicId, /^[0-9a-f-]{36}$/);
assert.equal(Number.parseInt(deterministicId[19], 16) & 0x8, 0x8, 'UUID variant must be RFC 4122/9562');

for (const invalid of [
  '',
  '/example/',
  'http://erazahan.info/example/',
  'https://www.erazahan.info/example/',
  'https://user@erazahan.info/example/',
  'https://erazahan.info/example/?preview=1',
  'https://erazahan.info/example/#fragment',
]) {
  assert.throws(() => validateLegacySourceUrl(invalid), { name: 'TypeError' });
}

const records = [
  { sourceUrl: 'https://erazahan.info/alpha/', title: 'A', content: 'one', date: '2020-01-01', categories: ['one'], letter: 'a' },
  { sourceUrl: 'https://erazahan.info/beta/', title: 'B', content: 'two', date: '2020-01-02', categories: ['two'], letter: 'b' },
  { sourceUrl: 'https://erazahan.info/gamma/', title: 'C', content: 'three', date: '2020-01-03', categories: ['three'], letter: 'g' },
];
const mapping = (items) => new Map(items.map((record) => [record.sourceUrl, legacyContentId(record.sourceUrl)]));
assert.deepEqual(mapping(records), mapping([...records].reverse()), 'Input order must not affect source-to-ID mapping');
assert.equal(
  legacyContentId(records[0].sourceUrl),
  legacyContentId({
    ...records[0],
    title: 'Changed',
    content: 'Changed',
    date: '2030-12-31',
    categories: ['changed'],
    letter: 'changed',
  }.sourceUrl),
  'Mutable fields must not affect the legacy ID',
);

assert.equal(
  uuidV7({ unixMs: 0x0123456789ab, random: Buffer.alloc(10) }),
  '01234567-89ab-7000-8000-000000000000',
);
const newId = uuidV7();
assert.ok(isUuidVersion(newId, 7));
assert.equal(Number.parseInt(newId[19], 16) & 0x8, 0x8, 'UUID variant must be RFC 4122/9562');

console.log('content_id primitives: permanent literals, exact raw seed, UUIDv5 RFC vector, determinism, reorder independence, mutable-field independence, and UUIDv7 layout PASS');
