import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../content-schema/schema.mjs';
import { validateHyRegistryEntries } from '../content-write/project-hy-post.mjs';

export const HY_CONTENT_SOURCE_ENV = 'ERAZAHAN_HY_CONTENT_SOURCE';
export const DEFAULT_HY_CONTENT_SOURCE = 'legacy';
export const HY_CONTENT_SOURCE_VALUES = Object.freeze(['legacy', 'new']);

// Astro relocates server modules under dist/.prerender before executing static
// routes, so source data must be anchored to the reproducible build root.
const DATA_ROOT = path.resolve(process.cwd(), 'src', 'data');
const POSTS_FILE = path.join(DATA_ROOT, 'posts.json');
const REGISTRY_FILE = path.join(DATA_ROOT, 'migrations', 'content-id-registry.v1.json');
const STORE_ROOT = path.join(DATA_ROOT, 'content', 'dreams');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function invariant(condition, message) {
  if (!condition) throw new Error(`HY content source: ${message}`);
}

export function resolveHyContentSource(value = process.env[HY_CONTENT_SOURCE_ENV]) {
  if (value === undefined) return DEFAULT_HY_CONTENT_SOURCE;
  if (!HY_CONTENT_SOURCE_VALUES.includes(value)) {
    throw new Error(
      `HY content source: ${HY_CONTENT_SOURCE_ENV} must be one of ${HY_CONTENT_SOURCE_VALUES.join(', ')}; received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export function loadLegacyHyPosts() {
  const posts = readJson(POSTS_FILE);
  invariant(Array.isArray(posts), 'legacy posts.json must contain an array');
  return posts;
}

export function loadNewHyPosts() {
  const legacyPosts = loadLegacyHyPosts();
  const registry = readJson(REGISTRY_FILE);
  try {
    validateHyRegistryEntries(registry.entries);
  } catch (error) {
    throw new Error(`HY content source: ${error instanceof Error ? error.message : String(error)}`);
  }

  return registry.entries.map((entry, index) => {
    const postIndex = entry.legacy?.original_array_index ?? entry.native?.post_index;
    invariant(Number.isInteger(postIndex) && postIndex >= 0, `registry entry ${index} has no post identity`);
    const legacyPost = legacyPosts[postIndex];
    invariant(legacyPost, `posts.json record is missing for registry entry ${index}`);
    if (entry.legacy) {
      invariant(entry.legacy.original_array_index === postIndex, `registry entry ${index} is out of order`);
      invariant(legacyPost.sourceUrl === entry.legacy.original_source_url, `legacy source URL mismatch for registry entry ${index}`);
      invariant(legacyPost.slug === entry.legacy.original_hy_slug, `legacy slug mismatch for registry entry ${index}`);
    } else {
      invariant(entry.native?.source_url === legacyPost.sourceUrl, `native source URL mismatch for registry entry ${index}`);
      invariant(entry.native?.slug === legacyPost.slug, `native slug mismatch for registry entry ${index}`);
    }

    const base = path.join(STORE_ROOT, entry.content_id.slice(0, 2), entry.content_id);
    const item = readJson(path.join(base, 'item.json'));
    const locale = readJson(path.join(base, 'hy.json'));
    validateContentItem(item);
    validateLocaleDocument(locale);
    validateItemLocaleRelation(item, locale);
    invariant(locale.locale === 'hy' && locale.published, `published HY locale is missing for ${entry.content_id}`);

    const published = locale.published;
    const post = {
      slug: published.slug,
      title: published.title,
      date: published.published_at,
      letter: published.alphabet_key,
      categories: published.tags,
      content: published.content,
      // Historical provenance comes from the immutable content_id registry.
      sourceUrl: entry.legacy?.original_source_url ?? entry.native.source_url,
      // Comments remain owned by posts.json until the admin/data migration.
      comments: legacyPost.comments,
    };

    // Schema v1 permits a description, while current HY records intentionally
    // keep it null and rely on the existing public excerpt fallback.
    if (published.description !== null) post.description = published.description;
    // Asset migration is out of scope. Preserve an explicit legacy cover if a
    // future posts.json record has one; otherwise current slug/images.json logic applies.
    if (legacyPost.cover !== undefined) post.cover = legacyPost.cover;
    return post;
  });
}

export function loadSelectedHyPosts(source = resolveHyContentSource()) {
  if (source === 'legacy') return loadLegacyHyPosts();
  if (source === 'new') return loadNewHyPosts();
  return resolveHyContentSource(source);
}

export const HY_CONTENT_SOURCE = resolveHyContentSource();
export const selectedHyPosts = loadSelectedHyPosts(HY_CONTENT_SOURCE);
