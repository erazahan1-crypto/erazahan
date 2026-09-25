import { readFileSync } from 'node:fs';
import path from 'node:path';
import { publicPathFor } from '../content-schema/multilingual-contract.mjs';
import { scanContentStore } from './multilingual-store.mjs';
import { buildPublishedSeoContext } from './published-seo.mjs';

export const HY_DREAM_STORE_ROOT = path.resolve(process.cwd(), 'src/data/content/dreams');
export const HY_CONTENT_ID_REGISTRY_FILE = path.resolve(process.cwd(), 'src/data/migrations/content-id-registry.v1.json');

function loadContentIdBySourceUrl(registryFile) {
  const registry = JSON.parse(readFileSync(registryFile, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(registry.entries)) throw new TypeError('HY dream SEO: content-id registry entries are missing');
  const ids = new Map();
  for (const entry of registry.entries) {
    const sourceUrl = entry?.legacy?.original_source_url ?? entry?.native?.source_url;
    if (typeof entry?.content_id !== 'string' || typeof sourceUrl !== 'string' || ids.has(sourceUrl)) {
      throw new TypeError('HY dream SEO: content-id registry is invalid');
    }
    ids.set(sourceUrl, entry.content_id);
  }
  return ids;
}

// Builds once during HY catch-all static-path generation. Identity comes from the
// immutable migration registry, never from an inferred slug.
export function loadHyDreamSeoBySlug(posts, {
  storeRoot = HY_DREAM_STORE_ROOT,
  registryFile = HY_CONTENT_ID_REGISTRY_FILE,
} = {}) {
  const repository = scanContentStore(storeRoot);
  const contentIdBySourceUrl = loadContentIdBySourceUrl(registryFile);
  const seoBySlug = new Map();
  for (const post of posts) {
    const contentId = contentIdBySourceUrl.get(post.sourceUrl);
    if (!contentId) throw new TypeError(`HY dream SEO: missing content_id for ${JSON.stringify(post.sourceUrl)}`);
    const seo = buildPublishedSeoContext(repository, contentId, 'hy');
    if (!seo || seo.canonical_path !== publicPathFor('hy', post.slug)) {
      throw new TypeError(`HY dream SEO: published HY identity mismatch for ${JSON.stringify(post.sourceUrl)}`);
    }
    if (seoBySlug.has(post.slug)) throw new TypeError(`HY dream SEO: duplicate HY slug ${JSON.stringify(post.slug)}`);
    seoBySlug.set(post.slug, seo);
  }
  return seoBySlug;
}
