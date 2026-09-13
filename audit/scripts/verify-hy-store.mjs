import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import {
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../../src/lib/content-schema/schema.mjs';
import {
  EXPECTED_DRY_RUN_SHA256,
  EXPECTED_POSTS,
  EXPECTED_POSTS_SHA256,
  EXPECTED_REGISTRY_SHA256,
  POSTS_PATH,
  REGISTRY_PATH,
  ROOT,
  baselineRouteSet,
  buildImport,
  canonicalSerialization,
  invariant,
  readJsonWithBytes,
  sha256,
} from './dry-run-hy-import.mjs';

export const STORE_ROOT = path.join(ROOT, 'src', 'data', 'content', 'dreams');
const BASELINE_ROUTES_PATH = path.join(ROOT, 'audit', 'baseline', 'dictionary-routes.json');
const CONTENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[57][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHARD_RE = /^[0-9a-f]{2}$/;
const INVALID_WINDOWS_SEGMENT_RE = /[<>:"/\\|?*\u0000-\u001f]/;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function jsonFile(file, errors) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${toPosix(path.relative(ROOT, file))}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function firstDifference(expected, actual, at = '$') {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== 'object') {
    return { path: at, expected, actual };
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path: at, expected, actual };
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return { path: `${at}.length`, expected: expected.length, actual: actual.length };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${at}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const keyDifference = firstDifference(expectedKeys, actualKeys, `${at} keys`);
  if (keyDifference) return keyDifference;
  for (const key of expectedKeys) {
    const difference = firstDifference(expected[key], actual[key], `${at}.${key}`);
    if (difference) return difference;
  }
  return null;
}

function conciseDifferenceValue(value) {
  if (typeof value === 'string' && value.length > 160) {
    return { type: 'string', length: value.length, sha256: sha256(Buffer.from(value, 'utf8')) };
  }
  return value;
}

function logicalDifferenceDiagnostic(difference, registryIds) {
  if (!difference) return null;
  const indexed = /^\$\.(?:content_items|hy_locale_documents)\[(\d+)]/.exec(difference.path);
  return {
    content_id: indexed ? registryIds[Number(indexed[1])] ?? null : null,
    field: difference.path,
    expected: conciseDifferenceValue(difference.expected),
    actual: conciseDifferenceValue(difference.actual),
  };
}

function physicalInventory(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        files.push({
          path: toPosix(path.relative(root, absolute)),
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } else {
        files.push({ path: toPosix(path.relative(root, absolute)), size: -1, sha256: null });
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const serialized = canonicalSerialization({
    schema_version: 1,
    artifact: 'permanent-hy-store-physical-inventory',
    files,
  });
  return {
    files,
    total_bytes: files.reduce((sum, file) => sum + Math.max(0, file.size), 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
  };
}

export function verifyHyStoreAt(root = STORE_ROOT) {
  invariant(existsSync(root), `Permanent HY store does not exist: ${root}`);

  const postsSource = readJsonWithBytes(POSTS_PATH);
  const registrySource = readJsonWithBytes(REGISTRY_PATH);
  const baseline = readJsonWithBytes(BASELINE_ROUTES_PATH).value;
  const posts = postsSource.value;
  const registry = registrySource.value;
  invariant(sha256(postsSource.bytes) === EXPECTED_POSTS_SHA256, 'posts.json SHA-256 changed');
  invariant(sha256(registrySource.bytes) === EXPECTED_REGISTRY_SHA256, 'Registry SHA-256 changed');
  invariant(Array.isArray(posts) && posts.length === EXPECTED_POSTS, 'Canonical source does not contain 5800 posts');
  invariant(Array.isArray(registry.entries) && registry.entries.length === EXPECTED_POSTS, 'Registry does not contain 5800 entries');

  const approved = buildImport(posts, registry);
  invariant(approved.sha256 === EXPECTED_DRY_RUN_SHA256, `Stage 7 logical SHA changed to ${approved.sha256}`);
  invariant(approved.missingRegistrySourceUrls.length === 0, 'Approved mapping has missing registry entries');
  invariant(approved.itemValidationErrors.length === 0, 'Approved mapping has invalid items');
  invariant(approved.localeValidationErrors.length === 0, 'Approved mapping has invalid locales');
  invariant(approved.relationValidationErrors.length === 0, 'Approved mapping has invalid relations');

  const inventory = physicalInventory(root);
  const parseErrors = [];
  const structureErrors = [];
  const invalidItemSchemas = [];
  const invalidHySchemas = [];
  const invalidRelations = [];
  const records = [];
  let itemFileCount = 0;
  let hyFileCount = 0;
  let ruFileCount = 0;
  let enFileCount = 0;
  let invalidShardPlacement = 0;

  for (const shardEntry of readdirSync(root, { withFileTypes: true })) {
    if (!shardEntry.isDirectory() || !SHARD_RE.test(shardEntry.name)) {
      structureErrors.push(`Unexpected root entry: ${shardEntry.name}`);
      continue;
    }
    const shardPath = path.join(root, shardEntry.name);
    for (const idEntry of readdirSync(shardPath, { withFileTypes: true })) {
      if (!idEntry.isDirectory() || !CONTENT_ID_RE.test(idEntry.name)) {
        structureErrors.push(`Unexpected shard entry: ${shardEntry.name}/${idEntry.name}`);
        continue;
      }
      const directory = path.join(shardPath, idEntry.name);
      if (idEntry.name.slice(0, 2) !== shardEntry.name) invalidShardPlacement += 1;
      const names = readdirSync(directory, { withFileTypes: true });
      const fileNames = names.filter((entry) => entry.isFile()).map((entry) => entry.name);
      const unexpected = names.filter((entry) => !entry.isFile() || !['item.json', 'hy.json'].includes(entry.name));
      for (const entry of unexpected) structureErrors.push(`Unexpected content entry: ${shardEntry.name}/${idEntry.name}/${entry.name}`);
      ruFileCount += fileNames.filter((name) => name === 'ru.json').length;
      enFileCount += fileNames.filter((name) => name === 'en.json').length;
      const itemPath = path.join(directory, 'item.json');
      const hyPath = path.join(directory, 'hy.json');
      const hasItem = fileNames.includes('item.json');
      const hasHy = fileNames.includes('hy.json');
      itemFileCount += Number(hasItem);
      hyFileCount += Number(hasHy);
      const item = hasItem ? jsonFile(itemPath, parseErrors) : null;
      const hy = hasHy ? jsonFile(hyPath, parseErrors) : null;
      records.push({ directoryContentId: idEntry.name, shard: shardEntry.name, item, hy, hasItem, hasHy });
    }
  }

  for (const record of records) {
    if (record.item) {
      try { validateContentItem(record.item); } catch (error) {
        invalidItemSchemas.push({ content_id: record.directoryContentId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (record.hy) {
      try { validateLocaleDocument(record.hy); } catch (error) {
        invalidHySchemas.push({ content_id: record.directoryContentId, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (record.item && record.hy) {
      try { validateItemLocaleRelation(record.item, record.hy); } catch (error) {
        invalidRelations.push({ content_id: record.directoryContentId, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  const recordIds = records.map((record) => record.directoryContentId);
  const registryIds = registry.entries.map((entry) => entry.content_id);
  const registryIdSet = new Set(registryIds);
  const recordIdSet = new Set(recordIds);
  const missingRegistryIds = registryIds.filter((contentId) => !recordIdSet.has(contentId));
  const idsOutsideRegistry = recordIds.filter((contentId) => !registryIdSet.has(contentId));
  const duplicateDirectoryIds = recordIds.length - recordIdSet.size;
  const itemIds = records.flatMap((record) => record.item ? [record.item.content_id] : []);
  const hyIds = records.flatMap((record) => record.hy ? [record.hy.content_id] : []);
  const duplicateItemIds = itemIds.length - new Set(itemIds).size;
  const duplicateHyIds = hyIds.length - new Set(hyIds).size;
  const missingItems = records.filter((record) => !record.hasItem).length + missingRegistryIds.length;
  const missingHy = records.filter((record) => !record.hasHy).length + missingRegistryIds.length;
  const orphanItems = records.filter((record) => record.hasItem && !record.hasHy).length;
  const orphanHy = records.filter((record) => record.hasHy && !record.hasItem).length;
  const directoryIdMismatches = records.filter((record) => (
    (record.item && record.item.content_id !== record.directoryContentId)
    || (record.hy && record.hy.content_id !== record.directoryContentId)
  )).length;
  const itemLocaleIdMismatches = records.filter((record) => record.item && record.hy && record.item.content_id !== record.hy.content_id).length;
  const byDirectoryId = new Map(records.map((record) => [record.directoryContentId, record]));
  const expectedById = new Map(approved.generated.map((record) => [record.item.content_id, record]));

  let slugParity = 0;
  let titleParity = 0;
  let contentParity = 0;
  let categoriesParity = 0;
  let letterParity = 0;
  let dateParity = 0;
  let fingerprintParity = 0;
  let descriptionNull = 0;
  let imageAltsEmpty = 0;
  let draftNull = 0;
  let versionOne = 0;
  let sourceRevisionOne = 0;
  let fingerprintSpecOne = 0;
  let inventedTimestamps = 0;
  let exactItemParity = 0;
  let exactHyParity = 0;

  for (const contentId of registryIds) {
    const actual = byDirectoryId.get(contentId);
    const expected = expectedById.get(contentId);
    if (!actual?.item || !actual.hy || !expected) continue;
    const published = actual.hy.published;
    slugParity += Number(published?.slug === expected.legacy.slug);
    titleParity += Number(published?.title === expected.legacy.title);
    contentParity += Number(published?.content === expected.legacy.content);
    categoriesParity += Number(isDeepStrictEqual(published?.tags, expected.legacy.categories));
    letterParity += Number(published?.alphabet_key === expected.legacy.letter);
    dateParity += Number(published?.published_at === expected.legacy.date);
    fingerprintParity += Number(published && actual.item.source_fingerprint === sourceFingerprintV1(published));
    descriptionNull += Number(published?.description === null);
    imageAltsEmpty += Number(published && isDeepStrictEqual(published.image_alts, {}));
    draftNull += Number(actual.hy.draft === null);
    versionOne += Number(published?.version === 1);
    sourceRevisionOne += Number(actual.item.source_revision === 1);
    fingerprintSpecOne += Number(actual.item.fingerprint_spec_version === 1);
    inventedTimestamps += Number(published && Object.hasOwn(published, 'updated_at'));
    inventedTimestamps += Number(Boolean(published?.generation && Object.hasOwn(published.generation, 'generated_at')));
    exactItemParity += Number(isDeepStrictEqual(actual.item, expected.item));
    exactHyParity += Number(isDeepStrictEqual(actual.hy, expected.localeDocument));
  }

  const canReconstruct = registryIds.every((contentId) => {
    const record = byDirectoryId.get(contentId);
    return record?.item && record?.hy;
  });
  const permanentArtifact = canReconstruct ? {
    schema_version: 1,
    artifact: 'hy-import-dry-run',
    order_rule: 'registry legacy.original_array_index ascending',
    content_items: registryIds.map((contentId) => byDirectoryId.get(contentId).item),
    hy_locale_documents: registryIds.map((contentId) => byDirectoryId.get(contentId).hy),
  } : null;
  const permanentLogicalSerialization = permanentArtifact ? canonicalSerialization(permanentArtifact) : '';
  const permanentLogicalSha256 = permanentArtifact
    ? sha256(Buffer.from(permanentLogicalSerialization, 'utf8'))
    : null;
  const logicalDifference = permanentArtifact ? firstDifference(approved.artifact, permanentArtifact) : {
    path: '$', expected: 'complete store', actual: 'incomplete store',
  };
  const targetRoutes = new Set(records.flatMap((record) => record.hy?.published?.slug ? [`/${record.hy.published.slug}/`] : []));
  const savedRoutes = baselineRouteSet(baseline);
  const routeParity = targetRoutes.size === savedRoutes.size && [...targetRoutes].every((route) => savedRoutes.has(route));
  const caseFoldedPaths = inventory.files.map((file) => file.path.toLowerCase());
  const caseInsensitiveCollisions = caseFoldedPaths.length - new Set(caseFoldedPaths).size;
  const invalidWindowsPaths = inventory.files.filter((file) => file.path.split('/').some((segment) => INVALID_WINDOWS_SEGMENT_RE.test(segment)));
  const maxPathLength = Math.max(...inventory.files.map((file) => path.resolve(root, ...file.path.split('/')).length));
  const largestItem = inventory.files.filter((file) => file.path.endsWith('/item.json')).sort((a, b) => b.size - a.size)[0] ?? null;
  const largestHy = inventory.files.filter((file) => file.path.endsWith('/hy.json')).sort((a, b) => b.size - a.size)[0] ?? null;
  const commentsTotal = posts.reduce((sum, post) => sum + post.comments.length, 0);
  const inlineImagePosts = posts.filter((post) => /<img\b|!\[[^\]]*\]\(/i.test(post.content)).length;

  const failures = [
    [inventory.files.length !== EXPECTED_POSTS * 2, `Expected 11600 files, found ${inventory.files.length}`],
    [itemFileCount !== EXPECTED_POSTS, `Expected 5800 item.json files, found ${itemFileCount}`],
    [hyFileCount !== EXPECTED_POSTS, `Expected 5800 hy.json files, found ${hyFileCount}`],
    [ruFileCount !== 0 || enFileCount !== 0, 'RU or EN files exist'],
    [structureErrors.length > 0, `${structureErrors.length} structure errors`],
    [parseErrors.length > 0, `${parseErrors.length} JSON parse errors`],
    [invalidShardPlacement > 0, `${invalidShardPlacement} invalid shard placements`],
    [invalidItemSchemas.length > 0, `${invalidItemSchemas.length} invalid item schemas`],
    [invalidHySchemas.length > 0, `${invalidHySchemas.length} invalid HY schemas`],
    [invalidRelations.length > 0, `${invalidRelations.length} invalid item/HY relations`],
    [missingRegistryIds.length > 0, `${missingRegistryIds.length} registry IDs missing`],
    [idsOutsideRegistry.length > 0, `${idsOutsideRegistry.length} IDs outside registry`],
    [duplicateDirectoryIds + duplicateItemIds + duplicateHyIds > 0, 'Duplicate content_id detected'],
    [missingItems + missingHy + orphanItems + orphanHy > 0, 'Missing or orphan files detected'],
    [directoryIdMismatches + itemLocaleIdMismatches > 0, 'content_id mismatch detected'],
    [exactItemParity !== EXPECTED_POSTS || exactHyParity !== EXPECTED_POSTS, 'Permanent files differ from approved mapping'],
    [fingerprintParity !== EXPECTED_POSTS, 'Source fingerprint parity failed'],
    [permanentLogicalSha256 !== EXPECTED_DRY_RUN_SHA256, `Permanent logical SHA is ${permanentLogicalSha256}`],
    [!routeParity, 'Permanent HY routes differ from baseline'],
    [inventedTimestamps !== 0, 'Invented timestamps detected'],
    [caseInsensitiveCollisions !== 0, 'Case-insensitive path collision detected'],
    [invalidWindowsPaths.length !== 0, 'Invalid Windows path characters detected'],
  ].filter(([failed]) => failed).map(([, message]) => message);

  const report = {
    status: failures.length ? 'FAIL' : 'PASS',
    store_root: toPosix(path.relative(ROOT, root)),
    counts: {
      logical_items: records.length,
      item_files: itemFileCount,
      hy_files: hyFileCount,
      ru_files: ruFileCount,
      en_files: enFileCount,
      total_files: inventory.files.length,
      total_bytes: inventory.total_bytes,
      unique_content_ids: recordIdSet.size,
      missing_items: missingItems,
      missing_hy: missingHy,
      orphan_items: orphanItems,
      orphan_hy: orphanHy,
      ids_outside_registry: idsOutsideRegistry.length,
      duplicate_ids: duplicateDirectoryIds + duplicateItemIds + duplicateHyIds,
      id_mismatches: directoryIdMismatches + itemLocaleIdMismatches,
      invalid_item_schema: invalidItemSchemas.length,
      invalid_hy_schema: invalidHySchemas.length,
      invalid_relations: invalidRelations.length,
      invalid_shard_placement: invalidShardPlacement,
    },
    parity: {
      slug: `${slugParity}/${EXPECTED_POSTS}`,
      route: routeParity ? `${targetRoutes.size}/${savedRoutes.size}` : 'FAIL',
      title: `${titleParity}/${EXPECTED_POSTS}`,
      content: `${contentParity}/${EXPECTED_POSTS}`,
      categories_tags: `${categoriesParity}/${EXPECTED_POSTS}`,
      letter_alphabet: `${letterParity}/${EXPECTED_POSTS}`,
      date_published_at: `${dateParity}/${EXPECTED_POSTS}`,
      fingerprint: `${fingerprintParity}/${EXPECTED_POSTS}`,
      exact_items: `${exactItemParity}/${EXPECTED_POSTS}`,
      exact_hy: `${exactHyParity}/${EXPECTED_POSTS}`,
      description_null: `${descriptionNull}/${EXPECTED_POSTS}`,
      image_alts_empty: `${imageAltsEmpty}/${EXPECTED_POSTS}`,
      draft_null: `${draftNull}/${EXPECTED_POSTS}`,
      published_version_one: `${versionOne}/${EXPECTED_POSTS}`,
      source_revision_one: `${sourceRevisionOne}/${EXPECTED_POSTS}`,
      fingerprint_spec_one: `${fingerprintSpecOne}/${EXPECTED_POSTS}`,
      invented_timestamps: inventedTimestamps,
    },
    fingerprints: {
      expected_stage7_logical_sha256: EXPECTED_DRY_RUN_SHA256,
      permanent_logical_sha256: permanentLogicalSha256,
      logical_match: permanentLogicalSha256 === EXPECTED_DRY_RUN_SHA256,
      full_permanent_store_sha256: inventory.sha256,
      first_logical_difference: logicalDifferenceDiagnostic(logicalDifference, registryIds),
    },
    safety: {
      posts_sha256: sha256(postsSource.bytes),
      registry_sha256: sha256(registrySource.bytes),
      legacy_comments_outside_store: commentsTotal,
      inline_image_posts_preserved_in_content: inlineImagePosts,
      invalid_windows_paths: invalidWindowsPaths.length,
      case_insensitive_path_collisions: caseInsensitiveCollisions,
      max_absolute_path_length: maxPathLength,
    },
    repository_impact: {
      store_files: inventory.files.length,
      store_bytes: inventory.total_bytes,
      approximate_git_staging_bytes: inventory.total_bytes,
      largest_item: largestItem,
      largest_hy: largestHy,
    },
    diagnostics: {
      failures,
      structure_errors: structureErrors.slice(0, 20),
      parse_errors: parseErrors.slice(0, 20),
      invalid_item_schemas: invalidItemSchemas.slice(0, 20),
      invalid_hy_schemas: invalidHySchemas.slice(0, 20),
      invalid_relations: invalidRelations.slice(0, 20),
    },
  };
  if (failures.length) {
    const error = new Error(`Permanent HY store validation failed: ${failures.join('; ')}`);
    error.report = report;
    throw error;
  }
  return report;
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    const report = verifyHyStoreAt();
    console.log('PERMANENT HY STORE VERIFY PASS');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`PERMANENT HY STORE VERIFY FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error && typeof error === 'object' && error.report) console.error(JSON.stringify(error.report, null, 2));
    process.exitCode = 1;
  }
}
