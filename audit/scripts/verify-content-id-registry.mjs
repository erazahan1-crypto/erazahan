import { readFileSync } from 'node:fs';
import {
  EXPECTED_MAPPING_SHA256,
  EXPECTED_NAMESPACE,
  EXPECTED_RECORDS,
  EXPECTED_SOURCE_SHA256,
  ID_ALGORITHM,
  REGISTRY_PATH,
  SEED_RULE,
  assertMappingIntegrity,
  buildCanonicalMapping,
  mappingFingerprint,
  readCanonicalSource,
  requireInvariant,
  sha256,
} from './create-content-id-registry.mjs';

function assertExactKeys(value, expected, label) {
  requireInvariant(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  requireInvariant(
    JSON.stringify(actual) === JSON.stringify(required),
    `${label} keys ${JSON.stringify(actual)} differ from ${JSON.stringify(required)}`,
  );
}

function verifyRegistry() {
  const registryBytes = readFileSync(REGISTRY_PATH);
  const registry = JSON.parse(registryBytes.toString('utf8'));
  assertExactKeys(
    registry,
    [
      'schema_version',
      'migration_version',
      'namespace',
      'id_algorithm',
      'seed_rule',
      'source',
      'mapping_sha256',
      'entries',
    ],
    'registry',
  );
  requireInvariant(registry.schema_version === 1, 'schema_version must be 1');
  requireInvariant(registry.migration_version === 1, 'migration_version must be 1');
  requireInvariant(registry.namespace === EXPECTED_NAMESPACE, `namespace must be ${EXPECTED_NAMESPACE}`);
  requireInvariant(registry.id_algorithm === ID_ALGORITHM, `id_algorithm must be ${ID_ALGORITHM}`);
  requireInvariant(registry.seed_rule === SEED_RULE, `seed_rule must be ${SEED_RULE}`);
  requireInvariant(registry.mapping_sha256 === EXPECTED_MAPPING_SHA256, 'Stored mapping fingerprint differs from approved fingerprint');
  assertExactKeys(
    registry.source,
    ['canonical_file', 'source_record_count', 'source_sha256'],
    'registry.source',
  );
  requireInvariant(registry.source.canonical_file === 'src/data/posts.json', 'Unexpected canonical source file');
  requireInvariant(registry.source.source_record_count === EXPECTED_RECORDS, 'Unexpected source record count');
  requireInvariant(registry.source.source_sha256 === EXPECTED_SOURCE_SHA256, 'Unexpected source SHA-256');
  requireInvariant(Array.isArray(registry.entries), 'entries must be an array');
  requireInvariant(registry.entries.length === EXPECTED_RECORDS, `Expected ${EXPECTED_RECORDS} registry entries`);

  const registryMapping = registry.entries.map((entry, index) => {
    assertExactKeys(entry, ['content_id', 'legacy', 'migration'], `entries[${index}]`);
    assertExactKeys(
      entry.legacy,
      ['original_array_index', 'original_hy_slug', 'original_source_url'],
      `entries[${index}].legacy`,
    );
    assertExactKeys(entry.migration, ['version'], `entries[${index}].migration`);
    requireInvariant(entry.migration.version === 1, `entries[${index}].migration.version must be 1`);
    requireInvariant(
      entry.legacy.original_array_index === index,
      `entries[${index}] is not in canonical historical order`,
    );
    return {
      original_array_index: entry.legacy.original_array_index,
      original_hy_slug: entry.legacy.original_hy_slug,
      original_source_url: entry.legacy.original_source_url,
      content_id: entry.content_id,
    };
  });

  const integrity = assertMappingIntegrity(registryMapping);
  const source = readCanonicalSource();
  const expectedMapping = buildCanonicalMapping(source.posts);
  let mappingMatches = 0;
  for (let index = 0; index < EXPECTED_RECORDS; index += 1) {
    const expected = expectedMapping[index];
    const actual = registryMapping[index];
    if (
      actual.original_array_index === expected.original_array_index
      && actual.original_hy_slug === expected.original_hy_slug
      && actual.original_source_url === expected.original_source_url
      && actual.content_id === expected.content_id
    ) {
      mappingMatches += 1;
    }
  }
  requireInvariant(mappingMatches === EXPECTED_RECORDS, `Registry mapping matches ${mappingMatches}/${EXPECTED_RECORDS}`);

  const actualMappingSha256 = mappingFingerprint(registryMapping);
  requireInvariant(
    actualMappingSha256 === EXPECTED_MAPPING_SHA256,
    `Registry mapping SHA-256 ${actualMappingSha256} differs from approved ${EXPECTED_MAPPING_SHA256}`,
  );

  return {
    metadata: {
      schema_version: registry.schema_version,
      migration_version: registry.migration_version,
      namespace: registry.namespace,
      id_algorithm: registry.id_algorithm,
      seed_rule: registry.seed_rule,
      entries: registry.entries.length,
    },
    integrity,
    mapping_matches_source: `${mappingMatches}/${EXPECTED_RECORDS}`,
    mapping_sha256: actualMappingSha256,
    registry_sha256: sha256(registryBytes),
    source_sha256: source.sourceSha256,
  };
}

try {
  console.log('CONTENT_ID REGISTRY VERIFY PASS');
  console.log(JSON.stringify(verifyRegistry(), null, 2));
} catch (error) {
  console.error(`CONTENT_ID REGISTRY VERIFY FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
