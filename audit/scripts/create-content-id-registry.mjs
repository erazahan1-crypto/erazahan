import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  PROJECT_CONTENT_ID_NAMESPACE,
  isUuidVersion,
  legacyContentId,
  validateLegacySourceUrl,
} from './content-id-lib.mjs';

export const EXPECTED_RECORDS = 5800;
export const EXPECTED_NAMESPACE = 'ebb2a826-eae8-511a-af05-0acf27425d75';
export const EXPECTED_SOURCE_SHA256 = '558ce9b0cbbc7acc94302daaf7cae43eb684907ec4fa078b2fc21c1dc4646ba3';
export const EXPECTED_MAPPING_SHA256 = '9ff7d6863936db65784723646d3874c3b7a94b5b87eaec42003175ce7030d1be';
export const ID_ALGORITHM = 'uuidv5';
export const SEED_RULE = 'legacy:v1:<exact original_source_url>';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const POSTS_PATH = path.join(ROOT, 'src', 'data', 'posts.json');
export const REGISTRY_PATH = path.join(
  ROOT,
  'src',
  'data',
  'migrations',
  'content-id-registry.v1.json',
);
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_VARIANT_RE = /^[89ab]$/i;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function requireInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function readCanonicalSource() {
  const bytes = readFileSync(POSTS_PATH);
  const sourceSha256 = sha256(bytes);
  requireInvariant(
    sourceSha256 === EXPECTED_SOURCE_SHA256,
    `posts.json SHA-256 ${sourceSha256} differs from approved ${EXPECTED_SOURCE_SHA256}`,
  );
  const posts = JSON.parse(bytes.toString('utf8'));
  requireInvariant(Array.isArray(posts), 'src/data/posts.json must contain an array');
  requireInvariant(
    posts.length === EXPECTED_RECORDS,
    `Expected ${EXPECTED_RECORDS} posts, found ${posts.length}`,
  );
  return { bytes, posts, sourceSha256 };
}

export function buildCanonicalMapping(posts) {
  requireInvariant(Array.isArray(posts), 'Source posts must be an array');
  requireInvariant(
    posts.length === EXPECTED_RECORDS,
    `Expected ${EXPECTED_RECORDS} posts, found ${posts.length}`,
  );
  return posts.map((post, originalArrayIndex) => {
    requireInvariant(
      typeof post.slug === 'string' && post.slug.length > 0,
      `Record ${originalArrayIndex} has no slug`,
    );
    requireInvariant(
      typeof post.sourceUrl === 'string' && post.sourceUrl.length > 0,
      `Record ${originalArrayIndex} has no sourceUrl`,
    );
    requireInvariant(
      validateLegacySourceUrl(post.sourceUrl) === post.sourceUrl,
      `Record ${originalArrayIndex} sourceUrl validation transformed the stored value`,
    );
    return {
      original_array_index: originalArrayIndex,
      original_hy_slug: post.slug,
      original_source_url: post.sourceUrl,
      content_id: legacyContentId(post.sourceUrl),
    };
  });
}

function countDuplicates(values) {
  return values.length - new Set(values).size;
}

export function inspectMapping(mapping) {
  const ids = mapping.map((entry) => entry.content_id);
  const sourceUrls = mapping.map((entry) => entry.original_source_url);
  const slugs = mapping.map((entry) => entry.original_hy_slug);
  const indexes = mapping.map((entry) => entry.original_array_index);
  const missingFields = mapping.filter((entry) => (
    !Number.isInteger(entry.original_array_index)
    || typeof entry.original_hy_slug !== 'string'
    || entry.original_hy_slug.length === 0
    || typeof entry.original_source_url !== 'string'
    || entry.original_source_url.length === 0
    || typeof entry.content_id !== 'string'
    || entry.content_id.length === 0
  )).length;
  const malformedIds = ids.filter(
    (id) => typeof id !== 'string' || !UUID_SHAPE_RE.test(id),
  ).length;
  const invalidVersions = ids.filter((id) => !isUuidVersion(id, 5)).length;
  const invalidVariants = ids.filter(
    (id) => typeof id !== 'string' || !UUID_VARIANT_RE.test(id[19] ?? ''),
  ).length;

  return {
    entries: mapping.length,
    unique_content_id: new Set(ids).size,
    duplicate_content_id: countDuplicates(ids),
    unique_source_url: new Set(sourceUrls).size,
    duplicate_source_url: countDuplicates(sourceUrls),
    unique_slug: new Set(slugs).size,
    duplicate_slug: countDuplicates(slugs),
    unique_original_array_index: new Set(indexes).size,
    missing_fields: missingFields,
    uuid_v5_valid: ids.length - invalidVersions,
    malformed_ids: malformedIds,
    invalid_versions: invalidVersions,
    invalid_variants: invalidVariants,
  };
}

export function assertMappingIntegrity(mapping) {
  const integrity = inspectMapping(mapping);
  requireInvariant(integrity.entries === EXPECTED_RECORDS, 'Registry mapping entry count is not 5800');
  requireInvariant(integrity.unique_content_id === EXPECTED_RECORDS, 'content_id values are not unique');
  requireInvariant(integrity.duplicate_content_id === 0, 'Duplicate content_id detected');
  requireInvariant(integrity.unique_source_url === EXPECTED_RECORDS, 'sourceUrl values are not unique');
  requireInvariant(integrity.duplicate_source_url === 0, 'Duplicate sourceUrl detected');
  requireInvariant(integrity.unique_slug === EXPECTED_RECORDS, 'HY slug values are not unique');
  requireInvariant(integrity.duplicate_slug === 0, 'Duplicate HY slug detected');
  requireInvariant(integrity.unique_original_array_index === EXPECTED_RECORDS, 'Array indexes are not unique');
  requireInvariant(integrity.missing_fields === 0, 'Missing registry mapping field detected');
  requireInvariant(integrity.uuid_v5_valid === EXPECTED_RECORDS, 'Invalid UUIDv5 detected');
  requireInvariant(integrity.malformed_ids === 0, 'Malformed UUID detected');
  requireInvariant(integrity.invalid_versions === 0, 'Non-v5 UUID detected');
  requireInvariant(integrity.invalid_variants === 0, 'Invalid UUID variant detected');
  mapping.forEach((entry, index) => {
    requireInvariant(
      entry.original_array_index === index,
      `Registry mapping order differs at array index ${index}`,
    );
  });
  return integrity;
}

export function canonicalMappingJson(mapping) {
  const ordered = [...mapping].sort(
    (left, right) => left.original_array_index - right.original_array_index,
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function mappingFingerprint(mapping) {
  return sha256(canonicalMappingJson(mapping));
}

export function createRegistryDocument(mapping, sourceSha256) {
  return {
    schema_version: 1,
    migration_version: 1,
    namespace: EXPECTED_NAMESPACE,
    id_algorithm: ID_ALGORITHM,
    seed_rule: SEED_RULE,
    source: {
      canonical_file: 'src/data/posts.json',
      source_record_count: EXPECTED_RECORDS,
      source_sha256: sourceSha256,
    },
    mapping_sha256: EXPECTED_MAPPING_SHA256,
    entries: mapping.map((entry) => ({
      content_id: entry.content_id,
      legacy: {
        original_array_index: entry.original_array_index,
        original_hy_slug: entry.original_hy_slug,
        original_source_url: entry.original_source_url,
      },
      migration: {
        version: 1,
      },
    })),
  };
}

export function registryJson(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function createRegistry() {
  requireInvariant(
    PROJECT_CONTENT_ID_NAMESPACE === EXPECTED_NAMESPACE,
    `Executable namespace ${PROJECT_CONTENT_ID_NAMESPACE} differs from permanent registry namespace ${EXPECTED_NAMESPACE}`,
  );
  requireInvariant(!existsSync(REGISTRY_PATH), `Refusing to overwrite existing registry: ${REGISTRY_PATH}`);

  const source = readCanonicalSource();
  const mapping = buildCanonicalMapping(source.posts);
  const integrity = assertMappingIntegrity(mapping);
  const actualMappingSha256 = mappingFingerprint(mapping);
  requireInvariant(
    actualMappingSha256 === EXPECTED_MAPPING_SHA256,
    `Dry-run mapping SHA-256 ${actualMappingSha256} differs from approved ${EXPECTED_MAPPING_SHA256}`,
  );

  const document = createRegistryDocument(mapping, source.sourceSha256);
  const serialized = registryJson(document);
  mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, serialized, { encoding: 'utf8', flag: 'wx' });

  const writtenBytes = readFileSync(REGISTRY_PATH);
  const postsBytesAfter = readFileSync(POSTS_PATH);
  requireInvariant(source.bytes.equals(postsBytesAfter), 'src/data/posts.json changed during registry creation');

  return {
    path: path.relative(ROOT, REGISTRY_PATH).replaceAll(path.sep, '/'),
    entries: integrity.entries,
    mapping_sha256: actualMappingSha256,
    registry_sha256: sha256(writtenBytes),
    source_sha256: source.sourceSha256,
  };
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    console.log(JSON.stringify(createRegistry(), null, 2));
  } catch (error) {
    console.error(`CONTENT_ID REGISTRY CREATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
