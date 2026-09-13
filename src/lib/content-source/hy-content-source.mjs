import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../content-schema/schema.mjs';

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
  invariant(Array.isArray(registry.entries), 'registry entries must be an array');

  const legacyBySourceUrl = new Map(legacyPosts.map((post) => [post.sourceUrl, post]));
  invariant(legacyBySourceUrl.size === legacyPosts.length, 'legacy sourceUrl values must be unique');

  return registry.entries.map((entry, index) => {
    invariant(entry.legacy?.original_array_index === index, `registry entry ${index} is out of order`);
    const legacyPost = legacyBySourceUrl.get(entry.legacy?.original_source_url);
    invariant(legacyPost, `legacy comments compatibility record is missing for registry entry ${index}`);
    invariant(legacyPost.slug === entry.legacy.original_hy_slug, `legacy slug mismatch for registry entry ${index}`);

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
      sourceUrl: entry.legacy.original_source_url,
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
