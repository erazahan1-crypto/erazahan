import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createServer } from 'vite';
import {
  validateContentItem,
  validateItemLocaleRelation,
  validateLocaleDocument,
} from '../../src/lib/content-schema/schema.mjs';
import {
  EXPECTED_DRY_RUN_SHA256,
  EXPECTED_MAPPING_SHA256,
  EXPECTED_POSTS,
  EXPECTED_POSTS_SHA256,
  EXPECTED_REGISTRY_SHA256,
  POSTS_PATH,
  REGISTRY_PATH,
  ROOT,
  sha256,
} from './dry-run-hy-import.mjs';
import { verifyHyStoreAt } from './verify-hy-store.mjs';

const STORE_ROOT = path.join(ROOT, 'src', 'data', 'content', 'dreams');
const BASELINE_ROOT = path.join(ROOT, 'audit', 'baseline');
const DIST_ROOT = path.join(ROOT, 'dist');
const SITE = 'https://erazahan.info';
const EXPECTED_STORE_SHA256 = '2f17318e01577e913b2b2925d0d2948aa5147bf210e6f64190b47cc6ea752861';
const MAX_DIAGNOSTICS = 10;

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function routeFor(slug) {
  return `/${slug}/`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function equal(left, right) {
  return isDeepStrictEqual(canonicalize(left), canonicalize(right));
}

function attrs(tag) {
  const out = {};
  const body = tag.replace(/^<\/?[^\s>]+/, '').replace(/\/?\s*>$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(body))) out[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return out;
}

function bodyImages(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => {
    const value = attrs(match[0]);
    return canonicalize({
      src: value.src || null,
      alt: value.alt || null,
      width: value.width || null,
      height: value.height || null,
      loading: value.loading || null,
    });
  });
}

function imageRefs(html) {
  return bodyImages(html).map((image) => image.src).filter(Boolean);
}

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"' };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, token) => {
    if (token[0] !== '#') return named[token.toLowerCase()] ?? full;
    const hex = token[1].toLowerCase() === 'x';
    const number = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : full; } catch { return full; }
  });
}

function semanticText(value) {
  return decodeEntities(value).replace(/\s+/gu, ' ').trim();
}

function builtDescription(slug) {
  const file = path.join(DIST_ROOT, slug, 'index.html');
  if (!existsSync(file)) return null;
  const html = readFileSync(file, 'utf8');
  const match = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html);
  return match ? decodeEntities(match[1]) : null;
}

function builtRelated(slug) {
  const file = path.join(DIST_ROOT, slug, 'index.html');
  if (!existsSync(file)) return null;
  const html = readFileSync(file, 'utf8');
  const headingIndex = html.indexOf('Առնչվող երազներ');
  if (headingIndex === -1) return [];
  const start = html.lastIndexOf('<section', headingIndex);
  const end = html.indexOf('</section>', headingIndex);
  if (start === -1 || end === -1) return null;
  const section = html.slice(start, end + '</section>'.length);
  return [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    href: attrs(`<a${match[1]}>`).href || null,
    text: semanticText(match[2].replace(/<[^>]*>/g, '')),
  }));
}

function difference(label, contentId, oldValue, newValue) {
  return {
    invariant: label,
    content_id: contentId,
    old: summarize(oldValue),
    new: summarize(newValue),
  };
}

function summarize(value) {
  if (typeof value === 'string' && value.length > 180) {
    return { type: 'string', length: value.length, sha256: digest(Buffer.from(value, 'utf8')) };
  }
  return value;
}

function counter() {
  return { matched: 0, different: 0, samples: [] };
}

function compare(state, label, contentId, oldValue, newValue) {
  const bucket = state[label];
  if (equal(oldValue, newValue)) bucket.matched += 1;
  else {
    bucket.different += 1;
    if (bucket.samples.length < MAX_DIAGNOSTICS) {
      bucket.samples.push(difference(label, contentId, oldValue, newValue));
    }
  }
}

function publicPostFromStore(item, locale, legacyPost) {
  const published = locale.published;
  return {
    slug: published.slug,
    title: published.title,
    description: published.description,
    date: published.published_at,
    letter: published.alphabet_key,
    categories: published.tags,
    content: published.content,
    sourceUrl: legacyPost.sourceUrl,
    // These fields are not in schema v1. The transitional adapter deliberately
    // preserves current compatibility behavior until their own migrations exist.
    comments: legacyPost.comments,
    cover: legacyPost.cover ?? null,
  };
}

function scanStoreIds() {
  const records = [];
  for (const shard of readdirSync(STORE_ROOT, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    const shardRoot = path.join(STORE_ROOT, shard.name);
    for (const entry of readdirSync(shardRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = path.join(shardRoot, entry.name);
      records.push({
        content_id: entry.name,
        item: existsSync(path.join(base, 'item.json')),
        hy: existsSync(path.join(base, 'hy.json')),
      });
    }
  }
  return records;
}

function currentHtmlHashes(posts) {
  let matched = 0;
  const missing = [];
  const baseline = readJson(path.join(BASELINE_ROOT, 'dictionary-routes.json'));
  const byRoute = new Map(baseline.routes.map((entry) => [entry.route, entry]));
  for (const post of posts) {
    const route = routeFor(post.slug);
    const file = path.join(DIST_ROOT, post.slug, 'index.html');
    if (!existsSync(file)) {
      if (missing.length < MAX_DIAGNOSTICS) missing.push({ route, reason: 'missing dist HTML' });
      continue;
    }
    const actual = digest(readFileSync(file));
    if (actual === byRoute.get(route)?.html_sha256) matched += 1;
    else if (missing.length < MAX_DIAGNOSTICS) missing.push({ route, expected: byRoute.get(route)?.html_sha256, actual });
  }
  return { matched, different_or_missing: posts.length - matched, samples: missing };
}

async function main() {
  const postsBytes = readFileSync(POSTS_PATH);
  const registryBytes = readFileSync(REGISTRY_PATH);
  const oldPosts = JSON.parse(postsBytes.toString('utf8'));
  const registry = JSON.parse(registryBytes.toString('utf8'));
  const baselineRoutes = readJson(path.join(BASELINE_ROOT, 'dictionary-routes.json'));
  const baselineSearch = readJson(path.join(BASELINE_ROOT, 'search.json'));
  const baselineSitemap = readJson(path.join(BASELINE_ROOT, 'sitemap.json'));

  if (sha256(postsBytes) !== EXPECTED_POSTS_SHA256) throw new Error('posts.json SHA-256 changed');
  if (sha256(registryBytes) !== EXPECTED_REGISTRY_SHA256) throw new Error('Registry SHA-256 changed');
  if (registry.mapping_sha256 !== EXPECTED_MAPPING_SHA256) throw new Error('Registry mapping fingerprint changed');
  if (oldPosts.length !== EXPECTED_POSTS || registry.entries.length !== EXPECTED_POSTS) {
    throw new Error('Expected exactly 5800 old posts and registry entries');
  }

  const storeVerification = verifyHyStoreAt();
  const siteRecords = scanStoreIds();
  const registryIdSet = new Set(registry.entries.map((entry) => entry.content_id));
  const orphanRecords = siteRecords.filter((entry) => !registryIdSet.has(entry.content_id));
  const duplicateIds = siteRecords.length - new Set(siteRecords.map((entry) => entry.content_id)).size;
  const missingPairs = siteRecords.filter((entry) => !entry.item || !entry.hy);
  const oldBySource = new Map(oldPosts.map((post) => [post.sourceUrl, post]));

  const records = [];
  const missing = [];
  for (const entry of registry.entries) {
    const oldPost = oldBySource.get(entry.legacy.original_source_url);
    const base = path.join(STORE_ROOT, entry.content_id.slice(0, 2), entry.content_id);
    const itemFile = path.join(base, 'item.json');
    const hyFile = path.join(base, 'hy.json');
    if (!oldPost || !existsSync(itemFile) || !existsSync(hyFile)) {
      missing.push(entry.content_id);
      continue;
    }
    const item = readJson(itemFile);
    const hy = readJson(hyFile);
    validateContentItem(item);
    validateLocaleDocument(hy);
    validateItemLocaleRelation(item, hy);
    records.push({ entry, oldPost, item, hy, newPost: publicPostFromStore(item, hy, oldPost) });
  }

  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  let site;
  let seo;
  let renderer;
  try {
    site = await vite.ssrLoadModule('/src/lib/site.ts');
    seo = await vite.ssrLoadModule('/src/lib/seo.ts');
    renderer = await vite.ssrLoadModule('/src/lib/render-post-content.ts');
  } finally {
    await vite.close();
  }

  const parity = Object.fromEntries([
    'route', 'title', 'description', 'raw_content', 'rendered_content', 'images',
    'inline_images', 'related', 'canonical', 'seo_title', 'seo_description',
    'og_image', 'article_json_ld', 'search_entry', 'sitemap_entry',
  ].map((name) => [name, counter()]));
  const newSearch = [];
  const oldSearch = [];
  const newSitemap = [];
  const oldSitemap = [];
  const newSemanticByRoute = new Map();

  for (const record of records) {
    const { content_id: contentId } = record.entry;
    const oldPost = record.oldPost;
    const newPost = record.newPost;
    const oldRoute = routeFor(oldPost.slug);
    const newRoute = routeFor(newPost.slug);
    const oldDescription = (oldPost.description && oldPost.description.trim()) || site.excerptOf(oldPost, 160);
    const newDescription = (newPost.description && newPost.description.trim()) || site.excerptOf(newPost, 160);
    const oldCover = site.postCover(oldPost);
    const newCover = site.postCover(newPost);
    const renderBody = (post) => site.fixBrokenInternalLinks(site.addInternalLinks(
      site.normalizeHeadings(site.stripBrokenImages(renderer.renderPostContent(post.content))), post.slug,
    ));
    const oldBody = renderBody(oldPost);
    const newBody = renderBody(newPost);
    const oldRelated = site.relatedForPost(oldPost).map((post) => ({ href: routeFor(post.slug), title: post.title, letter: post.letter }));
    const newRelated = site.relatedForPost(newPost).map((post) => ({ href: routeFor(post.slug), title: post.title, letter: post.letter }));
    const oldCanonical = new URL(oldRoute, `${SITE}/`).href;
    const newCanonical = new URL(newRoute, `${SITE}/`).href;
    const oldArticle = JSON.parse(JSON.stringify(seo.articleSchema(oldPost)));
    const newArticle = JSON.parse(JSON.stringify(seo.articleSchema(newPost)));
    const oldImageSet = { cover: oldCover, inline: imageRefs(oldBody) };
    const newImageSet = { cover: newCover, inline: imageRefs(newBody) };
    const oldSearchEntry = { slug: oldPost.slug, title: oldPost.title, letter: oldPost.letter, text: site.stripHtml(oldPost.content).slice(0, 220) };
    const newSearchEntry = { slug: newPost.slug, title: newPost.title, letter: newPost.letter, text: site.stripHtml(newPost.content).slice(0, 220) };
    const oldSitemapLoc = `${SITE}${oldRoute}`;
    const newSitemapLoc = `${SITE}${newRoute}`;
    const oldSitemapEntry = oldPost.date ? { loc: oldSitemapLoc, lastmod: oldPost.date } : { loc: oldSitemapLoc };
    const newSitemapEntry = newPost.date ? { loc: newSitemapLoc, lastmod: newPost.date } : { loc: newSitemapLoc };

    compare(parity, 'route', contentId, oldRoute, newRoute);
    compare(parity, 'title', contentId, oldPost.title, newPost.title);
    compare(parity, 'description', contentId, oldDescription, newDescription);
    compare(parity, 'raw_content', contentId, oldPost.content, newPost.content);
    compare(parity, 'rendered_content', contentId, oldBody, newBody);
    compare(parity, 'images', contentId, oldImageSet, newImageSet);
    compare(parity, 'inline_images', contentId, imageRefs(oldBody), imageRefs(newBody));
    compare(parity, 'related', contentId, oldRelated, newRelated);
    compare(parity, 'canonical', contentId, oldCanonical, newCanonical);
    compare(parity, 'seo_title', contentId, oldPost.title, newPost.title);
    compare(parity, 'seo_description', contentId, oldDescription, newDescription);
    compare(parity, 'og_image', contentId, oldCover ? new URL(oldCover, `${SITE}/`).href : null, newCover ? new URL(newCover, `${SITE}/`).href : null);
    compare(parity, 'article_json_ld', contentId, oldArticle, newArticle);
    compare(parity, 'search_entry', contentId, oldSearchEntry, newSearchEntry);
    compare(parity, 'sitemap_entry', contentId, oldSitemapEntry, newSitemapEntry);
    oldSearch.push(oldSearchEntry);
    newSearch.push(newSearchEntry);
    oldSitemap.push(oldSitemapEntry);
    newSitemap.push(newSitemapEntry);
    newSemanticByRoute.set(newRoute, {
      title: newPost.title,
      description: newDescription,
      built_description: builtDescription(newPost.slug),
      canonical: newCanonical,
      article_json_ld: canonicalize(newArticle),
      images: newImageSet,
      related: newRelated,
      built_related: builtRelated(newPost.slug),
    });
  }

  const baselineByRoute = new Map(baselineRoutes.routes.map((entry) => [entry.route, entry]));
  const contentIdByRoute = new Map(records.map((record) => [routeFor(record.newPost.slug), record.entry.content_id]));
  const baselineParity = Object.fromEntries([
    'route', 'title', 'description', 'canonical', 'json_ld', 'images', 'related',
  ].map((name) => [name, counter()]));
  for (const [route, semantic] of newSemanticByRoute) {
    const baseline = baselineByRoute.get(route);
    const contentId = contentIdByRoute.get(route) ?? route;
    compare(baselineParity, 'route', contentId, route, baseline?.route ?? null);
    compare(baselineParity, 'title', contentId, semanticText(semantic.title), baseline?.title ?? null);
    // dictionary-routes.v1 used a tag regexp that truncates meta tags when a
    // description contains a literal `>` (1275 legacy excerpts). The saved HTML
    // is authoritative for those values and is parsed here with a quoted-value
    // regexp; its hash is independently checked against the saved baseline.
    compare(baselineParity, 'description', contentId, semantic.description, semantic.built_description);
    compare(baselineParity, 'canonical', contentId, semantic.canonical, baseline?.canonical ?? null);
    const baselineArticle = baseline?.json_ld?.find((value) => value?.['@type'] === 'Article') ?? null;
    compare(baselineParity, 'json_ld', contentId, semantic.article_json_ld, baselineArticle);
    const baselineImages = baseline ? {
      cover: baseline.images.open_graph[0] ? new URL(baseline.images.open_graph[0]).pathname : null,
      inline: baseline.images.content.filter((image) => image.loading !== 'eager').map((image) => image.src),
    } : null;
    compare(baselineParity, 'images', contentId, semantic.images, baselineImages);
    const renderedRelated = semantic.related.map((item) => ({ href: item.href, text: semanticText(`${item.letter || '🌙'}${item.title}`) }));
    // dictionary-routes.v1 also stops article extraction at the first nested
    // legacy </article>. Read the related section from the hash-verified saved
    // HTML so such legacy markup cannot hide a generated section.
    compare(baselineParity, 'related', contentId, renderedRelated, semantic.built_related);
  }

  const routes = records.map((record) => routeFor(record.newPost.slug));
  const routeSet = new Set(routes);
  const baselineDictionarySitemap = baselineSitemap.entries.filter((entry) => {
    try { return routeSet.has(decodeURIComponent(new URL(entry.loc).pathname)); }
    catch { return false; }
  });
  const currentSearchFile = path.join(DIST_ROOT, 'search-index.json');
  const currentSearch = existsSync(currentSearchFile) ? readJson(currentSearchFile) : null;
  const oldSearchSlugs = new Set(oldSearch.map((entry) => entry.slug));
  const newSearchSlugs = new Set(newSearch.map((entry) => entry.slug));
  const search = {
    old_entries: oldSearch.length,
    new_entries: newSearch.length,
    missing: oldSearch.filter((entry) => !newSearchSlugs.has(entry.slug)).length,
    extra: newSearch.filter((entry) => !oldSearchSlugs.has(entry.slug)).length,
    different: parity.search_entry.different,
    order_parity: oldSearch.every((entry, index) => entry.slug === newSearch[index]?.slug),
    baseline_parity: equal(newSearch, baselineSearch.entries),
    current_artifact_parity: currentSearch ? equal(newSearch, currentSearch) : null,
    baseline_sha256: baselineSearch.sha256,
    current_artifact_sha256: existsSync(currentSearchFile) ? digest(readFileSync(currentSearchFile)) : null,
  };
  const oldSitemapLocs = new Set(oldSitemap.map((entry) => entry.loc));
  const newSitemapLocs = new Set(newSitemap.map((entry) => entry.loc));
  const sitemap = {
    old_dictionary_entries: oldSitemap.length,
    new_dictionary_entries: newSitemap.length,
    missing: oldSitemap.filter((entry) => !newSitemapLocs.has(entry.loc)).length,
    extra: newSitemap.filter((entry) => !oldSitemapLocs.has(entry.loc)).length,
    different_metadata: parity.sitemap_entry.different,
    order_parity: oldSitemap.every((entry, index) => entry.loc === newSitemap[index]?.loc),
    baseline_parity: equal(newSitemap, baselineDictionarySitemap),
    baseline_other_entries_unchanged_scope: baselineSitemap.analysis.other_entry_count,
  };
  const html = currentHtmlHashes(oldPosts);

  const failures = [];
  if (missing.length) failures.push(`${missing.length} mappings are incomplete`);
  if (orphanRecords.length) failures.push(`${orphanRecords.length} store records are outside registry`);
  if (duplicateIds) failures.push(`${duplicateIds} duplicate store content IDs`);
  if (missingPairs.length) failures.push(`${missingPairs.length} incomplete store pairs`);
  for (const [name, result] of Object.entries(parity)) if (result.different) failures.push(`${name}: ${result.different} differences`);
  for (const [name, result] of Object.entries(baselineParity)) if (result.different) failures.push(`baseline ${name}: ${result.different} differences`);
  if (!search.baseline_parity || search.current_artifact_parity === false || !search.order_parity) failures.push('search parity failed');
  if (!sitemap.baseline_parity || !sitemap.order_parity) failures.push('sitemap parity failed');
  if (html.different_or_missing) failures.push(`current HTML differs from baseline for ${html.different_or_missing} routes`);
  if (storeVerification.fingerprints.permanent_logical_sha256 !== EXPECTED_DRY_RUN_SHA256) failures.push('HY logical SHA changed');
  if (storeVerification.fingerprints.full_permanent_store_sha256 !== EXPECTED_STORE_SHA256) failures.push('HY full store SHA changed');

  const report = {
    status: failures.length ? 'REVIEW REQUIRED' : 'PASS',
    mapping: {
      old_posts: oldPosts.length,
      registry: registry.entries.length,
      new_items: records.length,
      new_hy_published: records.filter((record) => record.hy.published).length,
      matched: records.length,
      missing: missing.length,
      orphans: orphanRecords.length,
      duplicates: duplicateIds,
    },
    core_parity: parity,
    seo_parity: {
      canonical: parity.canonical,
      title: parity.seo_title,
      description: parity.seo_description,
      og_image: parity.og_image,
      json_ld: parity.article_json_ld,
    },
    search,
    sitemap,
    baseline_parity: baselineParity,
    html_parity: {
      current_production_vs_saved_baseline: html,
      new_adapter_full_page_build: 'not generated',
      justification: 'All post inputs and every post-specific rendered/SEO/baseline invariant are exact; production route wiring is intentionally unchanged in Stage 9.',
    },
    isolation: {
      adapter_scope: 'audit-only dictionary adapter',
      non_dictionary_routes_touched: 0,
      baseline_other_sitemap_entries: baselineSitemap.analysis.other_entry_count,
    },
    safety: {
      hy_logical_sha256: storeVerification.fingerprints.permanent_logical_sha256,
      hy_full_store_sha256: storeVerification.fingerprints.full_permanent_store_sha256,
      registry_mapping_fingerprint: registry.mapping_sha256,
      registry_full_sha256: sha256(registryBytes),
      posts_sha256: sha256(postsBytes),
      changed: false,
    },
    diagnostics: {
      failures,
      samples: [
        ...Object.values(parity).flatMap((value) => value.samples),
        ...Object.values(baselineParity).flatMap((value) => value.samples),
        ...html.samples,
      ].slice(0, MAX_DIAGNOSTICS),
    },
  };

  console.log(failures.length ? 'HY OLD/NEW PARITY REVIEW REQUIRED' : 'HY OLD/NEW PARITY PASS');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`HY OLD/NEW PARITY FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
});
