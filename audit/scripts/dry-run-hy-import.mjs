import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceFingerprintV1 } from '../../src/lib/content-schema/fingerprint.mjs';
import {
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../../src/lib/content-schema/schema.mjs';

export const EXPECTED_POSTS = 5800;
export const EXPECTED_POSTS_SHA256 = '558ce9b0cbbc7acc94302daaf7cae43eb684907ec4fa078b2fc21c1dc4646ba3';
export const EXPECTED_MAPPING_SHA256 = '9ff7d6863936db65784723646d3874c3b7a94b5b87eaec42003175ce7030d1be';
export const EXPECTED_REGISTRY_SHA256 = '7f29716afc886f1423b30b132449e4c8a81c71db10075ad1f54f984be845691a';
export const EXPECTED_DRY_RUN_SHA256 = 'adafc2b5edf2f602fb59170ee87b750547db7cc17743178369e7e863546755c2';
const LEGACY_FIELDS = [
  'slug',
  'title',
  'date',
  'letter',
  'categories',
  'content',
  'sourceUrl',
  'comments',
];

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const POSTS_PATH = path.join(ROOT, 'src', 'data', 'posts.json');
export const REGISTRY_PATH = path.join(ROOT, 'src', 'data', 'migrations', 'content-id-registry.v1.json');
const IMAGES_PATH = path.join(ROOT, 'src', 'data', 'images.json');
const BASELINE_ROUTES_PATH = path.join(ROOT, 'audit', 'baseline', 'dictionary-routes.json');

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalSerialization(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function readJsonWithBytes(file) {
  const bytes = readFileSync(file);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function duplicateCount(values) {
  return values.length - new Set(values).size;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function baselineRouteSet(baseline) {
  return new Set(baseline.routes.map((route) => {
    invariant(
      typeof route.output_file === 'string' && route.output_file.endsWith('/index.html'),
      'Baseline dictionary route has an unexpected output_file',
    );
    return `/${route.output_file.slice(0, -'index.html'.length)}`;
  }));
}

function currentCover(post, uploadedFiles) {
  if (typeof post.cover === 'string' && post.cover.trim()) return post.cover.trim();
  for (const file of [`${post.slug}.webp`, `${post.slug}-1.webp`]) {
    if (uploadedFiles.has(file)) return `/uploads/${file}`;
  }
  return null;
}

function hasInlineImage(post) {
  return /<img\b|!\[[^\]]*\]\(/i.test(post.content);
}

export function buildImport(sourcePosts, registry) {
  const entryBySourceUrl = new Map(
    registry.entries.map((entry) => [entry.legacy.original_source_url, entry]),
  );
  const generated = [];
  const missingRegistrySourceUrls = [];
  const itemValidationErrors = [];
  const localeValidationErrors = [];
  const relationValidationErrors = [];

  for (const post of sourcePosts) {
    const entry = entryBySourceUrl.get(post.sourceUrl);
    if (!entry) {
      missingRegistrySourceUrls.push(post.sourceUrl);
      continue;
    }

    const published = {
      slug: post.slug,
      title: post.title,
      description: null,
      content: post.content,
      image_alts: {},
      tags: [...post.categories],
      alphabet_key: post.letter,
      based_on_source_revision: null,
      based_on_source_fingerprint: null,
      version: 1,
      published_at: post.date,
    };
    const sourceFingerprint = sourceFingerprintV1(published);
    const item = {
      schema_version: 1,
      content_id: entry.content_id,
      type: 'dream_dictionary',
      source_locale: 'hy',
      source_revision: 1,
      source_fingerprint: sourceFingerprint,
      fingerprint_spec_version: 1,
    };
    const localeDocument = {
      schema_version: 1,
      content_id: entry.content_id,
      locale: 'hy',
      draft: null,
      published,
    };

    for (const [errors, validate] of [
      [itemValidationErrors, () => validateContentItem(item)],
      [localeValidationErrors, () => validateLocaleDocument(localeDocument)],
      [relationValidationErrors, () => validateItemLocaleRelation(item, localeDocument)],
    ]) {
      try {
        validate();
      } catch (error) {
        errors.push({
          content_id: entry.content_id,
          source_url: post.sourceUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    generated.push({
      original_array_index: entry.legacy.original_array_index,
      legacy: post,
      item,
      localeDocument,
    });
  }

  generated.sort((left, right) => left.original_array_index - right.original_array_index);
  const artifact = {
    schema_version: 1,
    artifact: 'hy-import-dry-run',
    order_rule: 'registry legacy.original_array_index ascending',
    content_items: generated.map((record) => record.item),
    hy_locale_documents: generated.map((record) => record.localeDocument),
  };
  const serialized = canonicalSerialization(artifact);

  return {
    artifact,
    generated,
    missingRegistrySourceUrls,
    itemValidationErrors,
    localeValidationErrors,
    relationValidationErrors,
    serialized,
    sha256: sha256(Buffer.from(serialized, 'utf8')),
  };
}

function chooseSamples(generated, uploadedFiles) {
  const candidates = [
    ['first record', generated[0]],
    ['Armenian slug', generated.find((record) => /[\u0531-\u058f]/u.test(record.legacy.slug))],
    ['letter null', generated.find((record) => record.legacy.letter === null)],
    ['multiple categories', generated.find((record) => record.legacy.categories.length > 1)],
    ['image relation', generated.find((record) => currentCover(record.legacy, uploadedFiles) || hasInlineImage(record.legacy))],
    ['last record', generated.at(-1)],
  ];
  const used = new Set();
  return candidates.flatMap(([role, record]) => {
    if (!record || used.has(record.item.content_id)) return [];
    used.add(record.item.content_id);
    return [{
      role,
      content_id: record.item.content_id,
      original_array_index: record.original_array_index,
      legacy_slug: record.legacy.slug,
      item_source_revision: record.item.source_revision,
      item_source_fingerprint: record.item.source_fingerprint,
      hy_slug: record.localeDocument.published.slug,
      hy_title: record.localeDocument.published.title,
      publication_state: 'PUBLISHED',
      published_version: record.localeDocument.published.version,
      ...(role === 'image relation' ? {
        legacy_cover: currentCover(record.legacy, uploadedFiles),
        inline_image_in_content: hasInlineImage(record.legacy),
        imported_image_alts: record.localeDocument.published.image_alts,
      } : {}),
    }];
  });
}

export function runDryRun() {
  const postsSource = readJsonWithBytes(POSTS_PATH);
  const registrySource = readJsonWithBytes(REGISTRY_PATH);
  const imagesSource = readJsonWithBytes(IMAGES_PATH);
  const baselineSource = readJsonWithBytes(BASELINE_ROUTES_PATH);
  const posts = postsSource.value;
  const registry = registrySource.value;
  const images = imagesSource.value;
  const baseline = baselineSource.value;

  invariant(Array.isArray(posts), 'Canonical posts source must be an array');
  invariant(posts.length === EXPECTED_POSTS, `Expected ${EXPECTED_POSTS} posts, found ${posts.length}`);
  invariant(sha256(postsSource.bytes) === EXPECTED_POSTS_SHA256, 'Canonical posts SHA-256 changed');
  invariant(Array.isArray(registry.entries), 'Registry entries must be an array');
  invariant(registry.entries.length === EXPECTED_POSTS, 'Registry entry count is not 5800');
  invariant(registry.mapping_sha256 === EXPECTED_MAPPING_SHA256, 'Registry mapping fingerprint changed');
  invariant(sha256(registrySource.bytes) === EXPECTED_REGISTRY_SHA256, 'Full registry SHA-256 changed');
  invariant(Array.isArray(images), 'images.json must be an array');

  const actualLegacyFields = [...new Set(posts.flatMap((post) => Object.keys(post)))].sort();
  invariant(
    JSON.stringify(actualLegacyFields) === JSON.stringify([...LEGACY_FIELDS].sort()),
    `Unexpected legacy field set: ${JSON.stringify(actualLegacyFields)}`,
  );
  for (const [index, post] of posts.entries()) {
    invariant(
      LEGACY_FIELDS.every((field) => Object.hasOwn(post, field)),
      `Legacy record ${index} is missing a required field`,
    );
  }

  const firstRun = buildImport(posts, registry);
  const secondRun = buildImport(JSON.parse(postsSource.bytes.toString('utf8')), registry);
  const reorderedRun = buildImport([...posts].reverse(), registry);
  const generated = firstRun.generated;
  const itemIds = generated.map((record) => record.item.content_id);
  const localeIds = generated.map((record) => record.localeDocument.content_id);
  const itemIdSet = new Set(itemIds);
  const localeIdSet = new Set(localeIds);
  const generatedBySourceUrl = new Map(generated.map((record) => [record.legacy.sourceUrl, record]));
  const targetRoutes = new Set(generated.map((record) => `/${record.localeDocument.published.slug}/`));
  const currentRoutes = new Set(posts.map((post) => `/${post.slug}/`));
  const savedBaselineRoutes = baselineRouteSet(baseline);
  const uploadedFiles = new Set(images.map((image) => image.file));
  const fingerprintMatches = generated.filter((record) => (
    sourceFingerprintV1(record.localeDocument.published) === record.item.source_fingerprint
  )).length;
  const fingerprintRecomputationMatches = generated.filter((record) => (
    sourceFingerprintV1(record.localeDocument.published)
      === sourceFingerprintV1(structuredClone(record.localeDocument.published))
  )).length;
  const slugMatches = generated.filter((record) => record.localeDocument.published.slug === record.legacy.slug).length;
  const titleMatches = generated.filter((record) => record.localeDocument.published.title === record.legacy.title).length;
  const contentMatches = generated.filter((record) => record.localeDocument.published.content === record.legacy.content).length;
  const letterMatches = generated.filter((record) => record.localeDocument.published.alphabet_key === record.legacy.letter).length;
  const categoryMatches = generated.filter((record) => (
    JSON.stringify(record.localeDocument.published.tags) === JSON.stringify(record.legacy.categories)
  )).length;
  const postBySourceUrl = new Map(posts.map((post) => [post.sourceUrl, post]));
  const registryMatches = registry.entries.filter((entry) => {
    const post = postBySourceUrl.get(entry.legacy.original_source_url);
    return post
      && post.slug === entry.legacy.original_hy_slug
      && generatedBySourceUrl.get(entry.legacy.original_source_url)?.item.content_id === entry.content_id;
  }).length;
  const contentIdMismatches = generated.filter((record) => record.item.content_id !== record.localeDocument.content_id).length;
  const orphanItems = [...itemIdSet].filter((contentId) => !localeIdSet.has(contentId)).length;
  const orphanLocales = [...localeIdSet].filter((contentId) => !itemIdSet.has(contentId)).length;
  const letterNonNull = posts.filter((post) => post.letter !== null).length;
  const categoryCounts = new Map();
  for (const post of posts) categoryCounts.set(post.categories.length, (categoryCounts.get(post.categories.length) ?? 0) + 1);
  const categoryLengthDistribution = Object.fromEntries([...categoryCounts].sort((a, b) => a[0] - b[0]));
  const postsWithComments = posts.filter((post) => post.comments.length > 0).length;
  const commentsTotal = posts.reduce((sum, post) => sum + post.comments.length, 0);
  const postsWithCovers = posts.filter((post) => currentCover(post, uploadedFiles)).length;
  const postsWithInlineImages = posts.filter(hasInlineImage).length;

  invariant(firstRun.itemValidationErrors.length === 0, `${firstRun.itemValidationErrors.length} ContentItems failed schema validation`);
  invariant(firstRun.localeValidationErrors.length === 0, `${firstRun.localeValidationErrors.length} locale documents failed schema validation`);
  invariant(firstRun.relationValidationErrors.length === 0, `${firstRun.relationValidationErrors.length} item/locale relations failed validation`);
  invariant(firstRun.missingRegistrySourceUrls.length === 0, 'Missing registry mapping detected');
  invariant(firstRun.serialized === secondRun.serialized, 'Independent repeated run differs');
  invariant(firstRun.sha256 === secondRun.sha256, 'Independent repeated-run SHA differs');
  invariant(firstRun.serialized === reorderedRun.serialized, 'Reordered source produced a different artifact');
  invariant(slugMatches === EXPECTED_POSTS, 'Slug parity failed');
  invariant(titleMatches === EXPECTED_POSTS, 'Title parity failed');
  invariant(contentMatches === EXPECTED_POSTS, 'Content parity failed');
  invariant(letterMatches === EXPECTED_POSTS, 'Letter parity failed');
  invariant(categoryMatches === EXPECTED_POSTS, 'Category/tag parity failed');
  invariant(fingerprintMatches === EXPECTED_POSTS, 'Fingerprint parity failed');
  invariant(fingerprintRecomputationMatches === EXPECTED_POSTS, 'Fingerprint recomputation failed');
  invariant(sameSet(targetRoutes, currentRoutes), 'Target route set differs from current canonical route set');
  invariant(sameSet(targetRoutes, savedBaselineRoutes), 'Target route set differs from saved HY baseline');
  invariant(contentIdMismatches === 0, 'Item/locale content_id mismatch detected');
  invariant(orphanItems === 0 && orphanLocales === 0, 'Orphan item or locale detected');
  invariant(duplicateCount(itemIds) === 0, 'Duplicate content_id detected');
  invariant(!existsSync(path.join(ROOT, 'src', 'content', 'dreams')), 'Permanent HY content store already exists');

  const artifactDirectory = mkdtempSync(path.join(tmpdir(), 'erazahan-hy-import-v1-'));
  const artifactPath = path.join(artifactDirectory, 'hy-import-dry-run.v1.json');
  writeFileSync(artifactPath, firstRun.serialized, { encoding: 'utf8', flag: 'wx' });
  invariant(readFileSync(artifactPath, 'utf8') === firstRun.serialized, 'Temporary artifact verification failed');

  const report = {
    status: 'PASS',
    contract: {
      description: 'null; current public description remains a reader-derived excerpt of content',
      tags: 'exact copy of legacy categories in original order',
      image_alts: 'empty object; inline image markup/ALT remains in exact content and slug-based covers stay outside schema v1',
      published_at: 'exact legacy date interpreted as the existing date-only publication date',
      updated_at: 'omitted because the legacy corpus has no historical update timestamp',
      source_revision: 1,
      published_version: 1,
      hy_basis: 'based_on_source_revision and based_on_source_fingerprint are null',
    },
    counts: {
      legacy_posts: posts.length,
      registry_matches: registryMatches,
      generated_content_items: generated.length,
      generated_hy_locale_documents: generated.length,
      valid_content_items: generated.length - firstRun.itemValidationErrors.length,
      valid_hy_locale_documents: generated.length - firstRun.localeValidationErrors.length,
      missing_registry_mappings: firstRun.missingRegistrySourceUrls.length,
      duplicate_content_id: duplicateCount(itemIds),
      orphan_items: orphanItems,
      orphan_locales: orphanLocales,
      content_id_mismatches: contentIdMismatches,
      ru_records_generated: 0,
      en_records_generated: 0,
    },
    parity: {
      hy_slug: `${slugMatches}/${posts.length}`,
      hy_route_current_canonical: `${targetRoutes.size}/${currentRoutes.size}`,
      hy_route_saved_baseline: `${targetRoutes.size}/${savedBaselineRoutes.size}`,
      title: `${titleMatches}/${posts.length}`,
      content: `${contentMatches}/${posts.length}`,
      fingerprint: `${fingerprintMatches}/${posts.length}`,
      fingerprint_recomputation: `${fingerprintRecomputationMatches}/${posts.length}`,
      alphabet_key: `${letterMatches}/${posts.length}`,
      category_to_tags: `${categoryMatches}/${posts.length}`,
    },
    coverage: {
      legacy_fields: actualLegacyFields,
      letter_non_null: letterNonNull,
      letter_null: posts.length - letterNonNull,
      categories_empty: posts.filter((post) => post.categories.length === 0).length,
      categories_length_distribution: categoryLengthDistribution,
      posts_with_comments: postsWithComments,
      comments_total: commentsTotal,
      posts_with_slug_based_or_explicit_cover: postsWithCovers,
      posts_with_inline_images_in_content: postsWithInlineImages,
    },
    determinism: {
      repeated_run_serialized_identical: firstRun.serialized === secondRun.serialized,
      repeated_run_sha_identical: firstRun.sha256 === secondRun.sha256,
      reorder_independence: firstRun.serialized === reorderedRun.serialized,
      reorder_stable_records: `${reorderedRun.generated.length}/${posts.length}`,
      order_rule: firstRun.artifact.order_rule,
      hy_import_dry_run_sha256: firstRun.sha256,
    },
    safety: {
      posts_sha256: sha256(postsSource.bytes),
      registry_mapping_sha256: registry.mapping_sha256,
      registry_sha256: sha256(registrySource.bytes),
      temporary_artifact: artifactPath,
      forbidden_astro_content_store_paths_checked: ['src/content/dreams'],
      forbidden_astro_content_store_created: existsSync(path.join(ROOT, 'src', 'content', 'dreams')),
    },
    samples: chooseSamples(generated, uploadedFiles),
    validation_errors: {
      content_items: firstRun.itemValidationErrors,
      hy_locale_documents: firstRun.localeValidationErrors,
      item_locale_relations: firstRun.relationValidationErrors,
    },
  };

  console.log('HY IMPORT DRY-RUN PASS');
  console.log(JSON.stringify(report, null, 2));
}

const isMain = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    runDryRun();
  } catch (error) {
    console.error(`HY IMPORT DRY-RUN FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
