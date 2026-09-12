import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUuidVersion,
  legacyContentId,
  validateLegacySourceUrl,
} from './content-id-lib.mjs';

const EXPECTED_RECORDS = 5800;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const POSTS_PATH = path.join(ROOT, 'src', 'data', 'posts.json');
const PERMANENT_REGISTRY_PATH = path.join(
  ROOT,
  'src',
  'data',
  'migrations',
  'content-id-registry.v1.json',
);
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_VARIANT_RE = /^[89ab]$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function loadCanonicalPosts() {
  const bytes = readFileSync(POSTS_PATH);
  const posts = JSON.parse(bytes.toString('utf8'));
  requireInvariant(Array.isArray(posts), 'src/data/posts.json must contain an array');
  requireInvariant(posts.length === EXPECTED_RECORDS, `Expected ${EXPECTED_RECORDS} posts, found ${posts.length}`);
  return { bytes, posts };
}

function prepareRecords(posts) {
  return posts.map((record, originalArrayIndex) => {
    requireInvariant(
      typeof record.slug === 'string' && record.slug.length > 0,
      `Record ${originalArrayIndex} has no slug`,
    );
    requireInvariant(
      typeof record.sourceUrl === 'string' && record.sourceUrl.length > 0,
      `Record ${originalArrayIndex} has no sourceUrl`,
    );
    requireInvariant(
      validateLegacySourceUrl(record.sourceUrl) === record.sourceUrl,
      `Record ${originalArrayIndex} sourceUrl validation transformed the stored value`,
    );
    return { originalArrayIndex, record };
  });
}

function generateMapping(preparedRecords) {
  return preparedRecords.map(({ originalArrayIndex, record }) => ({
    original_array_index: originalArrayIndex,
    original_hy_slug: record.slug,
    original_source_url: record.sourceUrl,
    content_id: legacyContentId(record.sourceUrl),
  }));
}

function countDuplicates(values) {
  return values.length - new Set(values).size;
}

function compareBySourceUrl(expected, actual) {
  const expectedBySource = new Map(
    expected.map((entry) => [entry.original_source_url, entry.content_id]),
  );
  let identical = 0;
  for (const entry of actual) {
    if (expectedBySource.get(entry.original_source_url) === entry.content_id) identical += 1;
  }
  return identical;
}

function canonicalMapping(mapping) {
  const ordered = [...mapping].sort(
    (left, right) => left.original_array_index - right.original_array_index,
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function mutatedCopy(preparedRecords) {
  return preparedRecords.map(({ originalArrayIndex, record }) => ({
    originalArrayIndex,
    record: {
      ...record,
      title: `dry-run changed title ${originalArrayIndex}`,
      content: `dry-run changed content ${originalArrayIndex}`,
      date: '2030-12-31',
      categories: ['dry-run-changed'],
      letter: 'dry-run-changed',
    },
  }));
}

const registryExistedBefore = existsSync(PERMANENT_REGISTRY_PATH);
requireInvariant(!registryExistedBefore, 'Permanent content_id registry already exists');

const runASource = loadCanonicalPosts();
const runBSource = loadCanonicalPosts();
const preparedA = prepareRecords(runASource.posts);
const preparedB = prepareRecords(runBSource.posts);

const mappingA = generateMapping(preparedA);
const mappingB = generateMapping(preparedB);
const repeatedIdentical = compareBySourceUrl(mappingA, mappingB);
const reorderedIdentical = compareBySourceUrl(
  mappingA,
  generateMapping([...preparedA].reverse()),
);
const mutableIdentical = compareBySourceUrl(
  mappingA,
  generateMapping(mutatedCopy(preparedA)),
);

const lowercaseEscapes = 'https://erazahan.info/%d5%a5/';
const uppercaseEscapes = 'https://erazahan.info/%D5%A5/';
const oneCharacterA = 'https://erazahan.info/dry-run-a/';
const oneCharacterB = 'https://erazahan.info/dry-run-b/';
const sourceUrlSensitivity = (
  legacyContentId(lowercaseEscapes) !== legacyContentId(uppercaseEscapes)
  && legacyContentId(oneCharacterA) !== legacyContentId(oneCharacterB)
);

const sourceUrls = mappingA.map((entry) => entry.original_source_url);
const slugs = mappingA.map((entry) => entry.original_hy_slug);
const ids = mappingA.map((entry) => entry.content_id);
const missingIds = ids.filter((id) => typeof id !== 'string' || id.length === 0).length;
const malformedIds = ids.filter((id) => typeof id !== 'string' || !UUID_SHAPE_RE.test(id)).length;
const invalidVersions = ids.filter((id) => !isUuidVersion(id, 5)).length;
const invalidVariants = ids.filter(
  (id) => typeof id !== 'string' || !UUID_VARIANT_RE.test(id[19] ?? ''),
).length;

const serializedA = canonicalMapping(mappingA);
const serializedB = canonicalMapping(mappingB);
const mappingHash = sha256(serializedA);
const repeatedHash = sha256(serializedB);

requireInvariant(repeatedIdentical === EXPECTED_RECORDS, 'Repeated-run mapping differs');
requireInvariant(mappingHash === repeatedHash, 'Repeated-run serialized mapping hash differs');
requireInvariant(reorderedIdentical === EXPECTED_RECORDS, 'Array reorder changed IDs');
requireInvariant(mutableIdentical === EXPECTED_RECORDS, 'Mutable fields changed IDs');
requireInvariant(sourceUrlSensitivity, 'Exact sourceUrl sensitivity failed');
requireInvariant(countDuplicates(sourceUrls) === 0, 'Duplicate raw sourceUrl detected');
requireInvariant(countDuplicates(slugs) === 0, 'Duplicate slug detected');
requireInvariant(countDuplicates(ids) === 0, 'Duplicate UUID detected');
requireInvariant(missingIds === 0, 'Missing UUID detected');
requireInvariant(malformedIds === 0, 'Malformed UUID detected');
requireInvariant(invalidVersions === 0, 'Non-v5 UUID detected');
requireInvariant(invalidVariants === 0, 'Invalid UUID variant detected');

const tempDirectory = mkdtempSync(path.join(tmpdir(), 'erazahan-content-id-dry-run-'));
const artifactPath = path.join(tempDirectory, 'mapping.json');
writeFileSync(artifactPath, serializedA, { encoding: 'utf8', flag: 'wx' });

const postsBytesAfter = readFileSync(POSTS_PATH);
const registryExistsAfter = existsSync(PERMANENT_REGISTRY_PATH);
requireInvariant(runASource.bytes.equals(postsBytesAfter), 'src/data/posts.json changed during dry-run');
requireInvariant(!registryExistsAfter, 'Permanent content_id registry was created during dry-run');

const firstSamples = mappingA.slice(0, 3);
const lastSamples = mappingA.slice(-3);
const excludedIndexes = new Set(
  [...firstSamples, ...lastSamples].map((entry) => entry.original_array_index),
);
const armenianEncodedSamples = mappingA.filter(
  (entry) => (
    !excludedIndexes.has(entry.original_array_index)
    && /%(?:d5|d6)/i.test(entry.original_source_url)
  ),
).slice(0, 3);

const report = {
  source: {
    records: runASource.posts.length,
    with_slug: runASource.posts.filter(
      (record) => typeof record.slug === 'string' && record.slug.length > 0,
    ).length,
    with_source_url: runASource.posts.filter(
      (record) => typeof record.sourceUrl === 'string' && record.sourceUrl.length > 0,
    ).length,
    valid_source_url: preparedA.length,
    unique_raw_source_url: new Set(sourceUrls).size,
    duplicate_raw_source_url: countDuplicates(sourceUrls),
    unique_slug: new Set(slugs).size,
    duplicate_slug: countDuplicates(slugs),
  },
  ids: {
    generated: ids.length,
    unique: new Set(ids).size,
    duplicates: countDuplicates(ids),
    missing: missingIds,
    uuid_v5_valid: ids.length - invalidVersions,
    malformed: malformedIds,
    invalid_version: invalidVersions,
    invalid_variant: invalidVariants,
  },
  determinism: {
    repeated_run_identical: `${repeatedIdentical}/${EXPECTED_RECORDS}`,
    repeated_serialized_hash_identical: mappingHash === repeatedHash,
    array_reorder_identical: `${reorderedIdentical}/${EXPECTED_RECORDS}`,
    mutable_fields_identical: `${mutableIdentical}/${EXPECTED_RECORDS}`,
    exact_source_url_sensitivity: sourceUrlSensitivity,
  },
  mapping_sha256: mappingHash,
  posts_json: {
    sha256_before: sha256(runASource.bytes),
    sha256_after: sha256(postsBytesAfter),
    changed: !runASource.bytes.equals(postsBytesAfter),
  },
  permanent_registry_created: registryExistsAfter,
  artifact_path: artifactPath,
  samples: {
    first: firstSamples,
    armenian_percent_encoded: armenianEncodedSamples,
    last: lastSamples,
  },
};

console.log(JSON.stringify(report, null, 2));
