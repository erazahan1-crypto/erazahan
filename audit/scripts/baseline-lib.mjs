import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const BASELINE_TYPE = 'hy-production-pre-multilingual';
export const GENERATOR_VERSION = '1.0.0';
export const EXPECTED_POST_COUNT = 5800;
export const SITE_ORIGIN = 'https://erazahan.info';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DIST = path.join(ROOT, 'dist');
export const POSTS_FILE = path.join(ROOT, 'src', 'data', 'posts.json');
export const BASELINE_DIR = path.join(ROOT, 'audit', 'baseline');

const RELATED_HEADING = 'Առնչվող երազներ';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

export function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(absolute, out);
    else if (entry.isFile()) out.push(absolute);
  }
  return out;
}

export function inventoryDist() {
  if (!fs.existsSync(DIST)) throw new Error(`Missing build output: ${DIST}`);
  return walkFiles(DIST)
    .map((absolute) => {
      const bytes = fs.readFileSync(absolute);
      return {
        path: toPosix(path.relative(DIST, absolute)),
        size: bytes.length,
        sha256: sha256(bytes),
      };
    })
    .sort((a, b) => compareText(a.path, b.path));
}

function decodeEntities(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (full, token) => {
    if (token[0] === '#') {
      const hexadecimal = token[1].toLowerCase() === 'x';
      const number = Number.parseInt(token.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try { return Number.isFinite(number) ? String.fromCodePoint(number) : full; } catch { return full; }
    }
    return named[token.toLowerCase()] ?? full;
  });
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function attributes(tag) {
  const out = {};
  const body = tag.replace(/^<\/?[^\s>]+/, '').replace(/\/?\s*>$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(body))) {
    out[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return out;
}

function allTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => ({
    raw: match[0],
    index: match.index,
    attrs: attributes(match[0]),
  }));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function semanticJsonLd(html) {
  const values = [];
  const diagnostics = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let jsonLdIndex = 0;
  while ((match = re.exec(html))) {
    const attrs = attributes(`<script${match[1]}>`);
    if ((attrs.type || '').toLowerCase() !== 'application/ld+json') continue;
    const raw = match[2];
    const diagnostic = { index: jsonLdIndex, raw_sha256: sha256(Buffer.from(raw, 'utf8')), valid: true };
    try {
      values.push(canonicalize(JSON.parse(raw)));
    } catch (error) {
      values.push(null);
      diagnostic.valid = false;
      diagnostic.error = error instanceof Error ? error.message : String(error);
      diagnostic.raw = raw;
    }
    diagnostics.push(diagnostic);
    jsonLdIndex += 1;
  }
  return { values, diagnostics };
}

function collectJsonLdImages(value, out = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectJsonLdImages(child, out);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'image') {
      if (typeof child === 'string') out.push(child);
      else if (Array.isArray(child)) {
        for (const item of child) {
          if (typeof item === 'string') out.push(item);
          else if (item && typeof item === 'object') {
            if (typeof item.url === 'string') out.push(item.url);
            if (typeof item.contentUrl === 'string') out.push(item.contentUrl);
          }
        }
      } else if (child && typeof child === 'object') {
        if (typeof child.url === 'string') out.push(child.url);
        if (typeof child.contentUrl === 'string') out.push(child.contentUrl);
      }
    }
    collectJsonLdImages(child, out);
  }
  return out;
}

function imageObject(tag) {
  const attrs = attributes(tag);
  return canonicalize({
    src: attrs.src || null,
    alt: attrs.alt || null,
    width: attrs.width || null,
    height: attrs.height || null,
    loading: attrs.loading || null,
  });
}

function extractArticle(html) {
  const articleStartMatch = /<article\b[^>]*class=(?:"[^"]*\bpost-article\b[^"]*"|'[^']*\bpost-article\b[^']*')[^>]*>/i.exec(html);
  if (!articleStartMatch) return null;
  const start = articleStartMatch.index;
  const end = html.indexOf('</article>', start);
  return end === -1 ? html.slice(start) : html.slice(start, end + '</article>'.length);
}

function extractRelated(article) {
  if (!article) return { found: false, links: [] };
  const headingMatches = [...article.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const heading = headingMatches.find((match) => stripTags(match[1]) === RELATED_HEADING);
  if (!heading) return { found: false, links: [] };
  const sectionStart = article.lastIndexOf('<section', heading.index);
  const sectionEnd = article.indexOf('</section>', heading.index + heading[0].length);
  if (sectionStart === -1 || sectionEnd === -1) return { found: true, links: [] };
  const section = article.slice(sectionStart, sectionEnd + '</section>'.length);
  const links = [...section.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => {
    const attrs = attributes(`<a${match[1]}>`);
    return { href: attrs.href || null, text: stripTags(match[2]) };
  });
  return { found: true, links };
}

function normalizeInternalRoute(href) {
  if (!href) return null;
  try {
    const url = new URL(href, `${SITE_ORIGIN}/`);
    if (url.origin !== SITE_ORIGIN) return null;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname !== '/' && !pathname.endsWith('/')) pathname += '/';
    return pathname;
  } catch {
    return null;
  }
}

function internalAssetExists(reference) {
  if (!reference) return true;
  try {
    const url = new URL(reference, `${SITE_ORIGIN}/`);
    if (url.origin !== SITE_ORIGIN || url.protocol === 'data:') return true;
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    return fs.existsSync(path.join(DIST, ...relative.split('/')));
  } catch {
    return false;
  }
}

function parsePostHtml(html, route, expectedRoutes) {
  const titleMatches = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  const metas = allTags(html, 'meta');
  const links = allTags(html, 'link');
  const descriptions = metas.filter((tag) => (tag.attrs.name || '').toLowerCase() === 'description');
  const canonicals = links.filter((tag) => (tag.attrs.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
  const jsonLd = semanticJsonLd(html);
  const article = extractArticle(html);
  const contentImages = article ? allTags(article, 'img').map((tag) => imageObject(tag.raw)) : [];
  const openGraph = uniqueStrings(metas
    .filter((tag) => (tag.attrs.property || '').toLowerCase() === 'og:image')
    .map((tag) => tag.attrs.content));
  const twitter = uniqueStrings(metas
    .filter((tag) => (tag.attrs.name || '').toLowerCase() === 'twitter:image')
    .map((tag) => tag.attrs.content));
  const jsonLdImages = uniqueStrings(jsonLd.values.flatMap((value) => collectJsonLdImages(value)));
  const related = extractRelated(article);
  const relatedRoutes = related.links.map((link) => normalizeInternalRoute(link.href));
  const duplicateRelated = uniqueStrings(relatedRoutes.filter((value, index) => value && relatedRoutes.indexOf(value) !== index));
  const brokenRelated = related.links.filter((link, index) => !relatedRoutes[index] || !expectedRoutes.has(relatedRoutes[index]));
  const allImageRefs = [
    ...contentImages.map((image) => image.src),
    ...openGraph,
    ...twitter,
    ...jsonLdImages,
  ];
  const brokenImageRefs = uniqueStrings(allImageRefs.filter((reference) => !internalAssetExists(reference)));
  const canonical = canonicals[0]?.attrs.href ?? null;
  const expectedCanonical = new URL(route, `${SITE_ORIGIN}/`).href;
  const invalidJsonLd = jsonLd.diagnostics.filter((entry) => !entry.valid).length;
  return {
    record: {
      route,
      output_file: `${route.slice(1)}index.html`,
      html_sha256: sha256(Buffer.from(html, 'utf8')),
      title: titleMatches.length ? stripTags(titleMatches[0][1]) : null,
      description: descriptions[0]?.attrs.content ?? null,
      canonical,
      json_ld: jsonLd.values,
      json_ld_diagnostics: jsonLd.diagnostics,
      images: {
        content: contentImages,
        open_graph: openGraph,
        twitter,
        json_ld: jsonLdImages,
      },
      related_posts: related.links,
    },
    anomalies: {
      missing_title: titleMatches.length === 0,
      multiple_titles: titleMatches.length > 1,
      missing_description: descriptions.length === 0,
      multiple_descriptions: descriptions.length > 1,
      missing_canonical: canonicals.length === 0,
      multiple_canonicals: canonicals.length > 1,
      canonical_mismatch: canonical !== expectedCanonical,
      missing_post_article: !article,
      invalid_json_ld: invalidJsonLd,
      related_section_missing: !related.found,
      broken_related_links: brokenRelated,
      duplicate_related_routes: duplicateRelated,
      broken_image_refs: brokenImageRefs,
    },
  };
}

function counter() {
  return {
    missing_output_files: 0,
    missing_titles: 0,
    multiple_titles: 0,
    missing_descriptions: 0,
    multiple_descriptions: 0,
    missing_canonicals: 0,
    multiple_canonicals: 0,
    canonical_mismatches: 0,
    missing_post_articles: 0,
    json_ld_blocks: 0,
    invalid_json_ld_blocks: 0,
    posts_with_images: 0,
    posts_without_images: 0,
    total_image_references: 0,
    missing_related_sections: 0,
    posts_with_related: 0,
    posts_without_related: 0,
    total_related_links: 0,
    broken_related_links: 0,
    posts_with_duplicate_related_links: 0,
    duplicate_related_routes: 0,
    broken_image_refs: 0,
  };
}

function parseDictionary(posts) {
  if (!Array.isArray(posts) || posts.length !== EXPECTED_POST_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_POST_COUNT} posts in src/data/posts.json; found ${Array.isArray(posts) ? posts.length : 'non-array'}`);
  }
  const slugs = posts.map((post) => post?.slug);
  if (slugs.some((slug) => typeof slug !== 'string' || !slug.trim())) throw new Error('Every canonical post must have a non-empty string slug');
  const unique = new Set(slugs);
  if (unique.size !== EXPECTED_POST_COUNT) throw new Error(`Expected ${EXPECTED_POST_COUNT} unique post slugs; found ${unique.size}`);
  const expectedRoutes = new Set(slugs.map((slug) => `/${slug}/`));
  const routes = [];
  const analysis = counter();
  const anomaly_samples = {
    canonical_mismatches: [], invalid_json_ld: [], broken_related_links: [],
    duplicate_related_links: [], broken_image_refs: [],
  };
  for (const post of posts) {
    const route = `/${post.slug}/`;
    const outputFile = path.join(DIST, post.slug, 'index.html');
    if (!fs.existsSync(outputFile)) {
      analysis.missing_output_files += 1;
      throw new Error(`Missing expected dictionary route output: ${route} (${toPosix(path.relative(ROOT, outputFile))})`);
    }
    const parsed = parsePostHtml(fs.readFileSync(outputFile, 'utf8'), route, expectedRoutes);
    routes.push(parsed.record);
    const a = parsed.anomalies;
    analysis.missing_titles += Number(a.missing_title);
    analysis.multiple_titles += Number(a.multiple_titles);
    analysis.missing_descriptions += Number(a.missing_description);
    analysis.multiple_descriptions += Number(a.multiple_descriptions);
    analysis.missing_canonicals += Number(a.missing_canonical);
    analysis.multiple_canonicals += Number(a.multiple_canonicals);
    analysis.canonical_mismatches += Number(a.canonical_mismatch);
    analysis.missing_post_articles += Number(a.missing_post_article);
    analysis.json_ld_blocks += parsed.record.json_ld.length;
    analysis.invalid_json_ld_blocks += a.invalid_json_ld;
    const imageReferenceCount = parsed.record.images.content.length
      + parsed.record.images.open_graph.length
      + parsed.record.images.twitter.length
      + parsed.record.images.json_ld.length;
    analysis.posts_with_images += Number(imageReferenceCount > 0);
    analysis.posts_without_images += Number(imageReferenceCount === 0);
    analysis.total_image_references += imageReferenceCount;
    analysis.missing_related_sections += Number(a.related_section_missing);
    analysis.posts_with_related += Number(parsed.record.related_posts.length > 0);
    analysis.posts_without_related += Number(parsed.record.related_posts.length === 0);
    analysis.total_related_links += parsed.record.related_posts.length;
    analysis.broken_related_links += a.broken_related_links.length;
    analysis.posts_with_duplicate_related_links += Number(a.duplicate_related_routes.length > 0);
    analysis.duplicate_related_routes += a.duplicate_related_routes.length;
    analysis.broken_image_refs += a.broken_image_refs.length;
    if (a.canonical_mismatch && anomaly_samples.canonical_mismatches.length < 25) {
      anomaly_samples.canonical_mismatches.push({ route, actual: parsed.record.canonical, expected: new URL(route, `${SITE_ORIGIN}/`).href });
    }
    if (a.invalid_json_ld && anomaly_samples.invalid_json_ld.length < 25) anomaly_samples.invalid_json_ld.push(route);
    if (a.broken_related_links.length && anomaly_samples.broken_related_links.length < 25) anomaly_samples.broken_related_links.push({ route, links: a.broken_related_links });
    if (a.duplicate_related_routes.length && anomaly_samples.duplicate_related_links.length < 25) anomaly_samples.duplicate_related_links.push({ route, routes: a.duplicate_related_routes });
    if (a.broken_image_refs.length && anomaly_samples.broken_image_refs.length < 25) anomaly_samples.broken_image_refs.push({ route, refs: a.broken_image_refs });
  }
  return {
    expectedRoutes,
    artifact: {
      schema_version: SCHEMA_VERSION,
      artifact: 'dictionary-routes',
      source: 'src/data/posts.json',
      extraction_rules: {
        route_set: 'Only canonical src/data/posts.json slugs define the 5,800 expected HY dictionary routes; every value below is extracted from its built dist/<slug>/index.html.',
        title_description_canonical: 'First semantic <title>, meta[name=description], and link[rel~=canonical]; duplicate and missing tags are counted as anomalies.',
        json_ld: 'All script[type=application/ld+json] blocks in document order are parsed, recursively key-sorted, and stored semantically. Every raw block has a SHA-256 diagnostic; invalid blocks additionally retain raw text and parse error.',
        images: 'content contains every <img> inside article.post-article (cover plus article-content images), with src/alt/dimensions/loading. open_graph and twitter contain their image meta values. json_ld recursively extracts image/image URL references. Common layout assets and data-URI favicon are excluded.',
        related_posts: `Only anchors in the article section headed “${RELATED_HEADING}” are included, in rendered order; inline article links are not mixed into this field.`,
        inline_internal_links: 'Not included in v1: arbitrary nested legacy article markup makes DOM-free extraction less reliable, while the required related-post block has an unambiguous generated structure.',
      },
      route_count: routes.length,
      unique_route_count: expectedRoutes.size,
      duplicate_route_count: routes.length - expectedRoutes.size,
      analysis,
      anomaly_samples,
      routes,
    },
  };
}

function routeFromSlug(slug) {
  return typeof slug === 'string' && slug ? `/${slug}/` : null;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort((a, b) => compareText(String(a), String(b)));
}

function parseSearch(expectedRoutes) {
  const file = path.join(DIST, 'search-index.json');
  const bytes = fs.readFileSync(file);
  const entries = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(entries)) throw new Error('dist/search-index.json must contain an array');
  const routes = entries.map((entry) => routeFromSlug(entry?.slug));
  const uniqueValidRoutes = new Set(routes.filter(Boolean));
  const broken = uniqueStrings(routes.filter((route) => !route || !expectedRoutes.has(route)));
  const missing = [...expectedRoutes].filter((route) => !uniqueValidRoutes.has(route));
  const duplicates = duplicateValues(routes.filter(Boolean));
  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'search-index',
    source_file: 'dist/search-index.json',
    sha256: sha256(bytes),
    entry_count: entries.length,
    entries,
    analysis: {
      unique_route_count: uniqueValidRoutes.size,
      dictionary_entry_count: routes.filter((route) => route && expectedRoutes.has(route)).length,
      duplicate_route_count: duplicates.length,
      duplicate_routes: duplicates,
      broken_route_count: broken.length,
      broken_routes: broken,
      dictionary_coverage_count: EXPECTED_POST_COUNT - missing.length,
      dictionary_missing_count: missing.length,
      dictionary_missing_routes: missing,
    },
  };
}

function parseDreamContent(expectedRoutes) {
  const file = path.join(DIST, 'dream-content-index.json');
  const bytes = fs.readFileSync(file);
  const entries = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(entries)) throw new Error('dist/dream-content-index.json must contain an array');
  const routes = entries.map((entry) => routeFromSlug(entry?.slug));
  const uniqueValidRoutes = new Set(routes.filter(Boolean));
  const broken = uniqueStrings(routes.filter((route) => !route || !expectedRoutes.has(route)));
  const duplicates = duplicateValues(routes.filter(Boolean));
  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'dream-content-index',
    source_file: 'dist/dream-content-index.json',
    role: 'Publicly built subset containing full canonical article text for server-side admin previews and future AI context.',
    included_in_baseline: true,
    inclusion_reason: 'It is a current public build artifact derived from canonical HY content; changing its membership, order, fields, or text during multilingual work would be a regression.',
    sha256: sha256(bytes),
    entry_count: entries.length,
    entries,
    analysis: {
      unique_route_count: uniqueValidRoutes.size,
      duplicate_route_count: duplicates.length,
      duplicate_routes: duplicates,
      broken_route_count: broken.length,
      broken_routes: broken,
      dictionary_coverage_count: [...expectedRoutes].filter((route) => uniqueValidRoutes.has(route)).length,
      dictionary_total_count: expectedRoutes.size,
    },
  };
}

function xmlText(block, tagName) {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(block);
  return match ? decodeEntities(match[1].trim()) : null;
}

function urlToOutputFile(urlValue) {
  try {
    const pathname = decodeURIComponent(new URL(urlValue, `${SITE_ORIGIN}/`).pathname);
    if (pathname === '/') return 'index.html';
    if (pathname.endsWith('/')) return `${pathname.slice(1)}index.html`;
    return pathname.slice(1);
  } catch {
    return null;
  }
}

function parseSitemap(expectedRoutes) {
  const file = path.join(DIST, 'sitemap.xml');
  const bytes = fs.readFileSync(file);
  const xml = bytes.toString('utf8');
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)].map((match) => {
    const loc = xmlText(match[1], 'loc');
    const lastmod = xmlText(match[1], 'lastmod');
    return lastmod ? { loc, lastmod } : { loc };
  });
  const normalized = entries.map((entry) => {
    try { return new URL(entry.loc).href; } catch { return entry.loc; }
  });
  const expectedUrls = new Map([...expectedRoutes].map((route) => [new URL(route, `${SITE_ORIGIN}/`).href, route]));
  const actualSet = new Set(normalized);
  const dictionaryEntries = normalized.filter((loc) => expectedUrls.has(loc));
  const missing = [...expectedUrls.keys()].filter((loc) => !actualSet.has(loc));
  const duplicates = duplicateValues(normalized);
  const otherEntries = entries.filter((entry, index) => !expectedUrls.has(normalized[index]));
  const unexpectedDictionaryLike = otherEntries.filter((entry) => {
    const output = urlToOutputFile(entry.loc);
    if (!output) return false;
    const full = path.join(DIST, ...output.split('/'));
    return fs.existsSync(full) && fs.statSync(full).isFile() && /\bpost-article\b/.test(fs.readFileSync(full, 'utf8'));
  });
  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'sitemap',
    source_file: 'dist/sitemap.xml',
    sha256: sha256(bytes),
    entry_count: entries.length,
    entries,
    analysis: {
      dictionary_entry_count: dictionaryEntries.length,
      unique_entry_count: new Set(normalized).size,
      other_entry_count: otherEntries.length,
      duplicate_entry_count: duplicates.length,
      duplicate_locs: duplicates,
      missing_dictionary_entry_count: missing.length,
      missing_dictionary_locs: missing,
      unexpected_dictionary_like_count: unexpectedDictionaryLike.length,
      unexpected_dictionary_like_entries: unexpectedDictionaryLike,
      unexpected_dictionary_like_rule: 'Non-canonical sitemap entries whose built HTML contains the generated post-article marker.',
    },
  };
}

function htmlRouteFromOutput(output) {
  if (output === 'index.html') return '/';
  if (output.endsWith('/index.html')) return `/${output.slice(0, -'index.html'.length)}`;
  if (output.endsWith('.html')) return `/${output}`;
  return null;
}

function classifyRoute(output) {
  if (output.startsWith('admin/')) return 'admin';
  if (output === '404.html') return 'error';
  return 'visitor';
}

function nonDictionaryRoutes(inventory, expectedRoutes, sitemap) {
  const sitemapMap = new Map(sitemap.entries.map((entry) => {
    try { return [new URL(entry.loc).href, entry]; } catch { return [entry.loc, entry]; }
  }));
  const html = inventory.filter((file) => file.path.endsWith('.html')).map((file) => {
    const route = htmlRouteFromOutput(file.path);
    return { route, output_file: file.path, scope: classifyRoute(file.path), in_sitemap: sitemapMap.has(new URL(route, `${SITE_ORIGIN}/`).href) };
  }).filter((entry) => !expectedRoutes.has(entry.route));
  const endpoints = inventory.filter((file) => {
    if (file.path.includes('/')) return false;
    return /\.(?:json|xml|txt)$/i.test(file.path);
  }).map((file) => ({ route: `/${file.path}`, output_file: file.path, size: file.size, sha256: file.sha256 }));
  const sitemapOther = sitemap.entries.filter((entry) => {
    try { return !expectedRoutes.has(decodeURIComponent(new URL(entry.loc).pathname)); } catch { return true; }
  });
  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'non-dictionary-routes',
    extraction_rules: {
      html_routes: 'Every built HTML route not belonging to the canonical 5,800-post dictionary set; admin and error routes remain explicitly classified.',
      public_endpoints: 'Top-level built JSON, XML, and TXT endpoints; hashed assets are covered by the full output inventory instead.',
      sitemap_routes: 'Every sitemap entry not belonging to the canonical dictionary route set.',
    },
    counts: {
      html_routes: html.length,
      visitor_html_routes: html.filter((entry) => entry.scope === 'visitor').length,
      admin_html_routes: html.filter((entry) => entry.scope === 'admin').length,
      error_html_routes: html.filter((entry) => entry.scope === 'error').length,
      public_endpoints: endpoints.length,
      sitemap_routes: sitemapOther.length,
    },
    html_routes: html,
    public_endpoints: endpoints,
    sitemap_routes: sitemapOther,
  };
}

function buildSummary(inventory, buildDurationMs) {
  const counts = { html: 0, json: 0, xml: 0, other_assets: 0 };
  const bytes = { html: 0, json: 0, xml: 0, other_assets: 0, total: 0 };
  for (const file of inventory) {
    const kind = file.path.endsWith('.html') ? 'html'
      : file.path.endsWith('.json') ? 'json'
        : file.path.endsWith('.xml') ? 'xml' : 'other_assets';
    counts[kind] += 1;
    bytes[kind] += file.size;
    bytes.total += file.size;
  }
  return {
    schema_version: SCHEMA_VERSION,
    artifact: 'build',
    command: 'npm run build',
    output_dir: 'dist',
    build_duration_ms: buildDurationMs,
    file_count: inventory.length,
    total_bytes: bytes.total,
    html_count: counts.html,
    json_count: counts.json,
    xml_count: counts.xml,
    asset_count: counts.other_assets,
    total_files: inventory.length,
    counts,
    bytes,
    largest_files: [...inventory].sort((a, b) => b.size - a.size || compareText(a.path, b.path)).slice(0, 25),
    output_files: inventory,
  };
}

export function collectArtifacts({ buildDurationMs = null } = {}) {
  const postsBytes = fs.readFileSync(POSTS_FILE);
  const posts = JSON.parse(postsBytes.toString('utf8'));
  const inventory = inventoryDist();
  const dictionary = parseDictionary(posts);
  const search = parseSearch(dictionary.expectedRoutes);
  const dream = parseDreamContent(dictionary.expectedRoutes);
  const sitemap = parseSitemap(dictionary.expectedRoutes);
  const nonDictionary = nonDictionaryRoutes(inventory, dictionary.expectedRoutes, sitemap);
  const build = buildSummary(inventory, buildDurationMs);
  const outputFiles = {
    schema_version: SCHEMA_VERSION,
    artifact: 'output-files',
    output_dir: 'dist',
    file_count: inventory.length,
    total_bytes: inventory.reduce((sum, file) => sum + file.size, 0),
    files: inventory,
  };
  return {
    posts_sha256: sha256(postsBytes),
    post_count: posts.length,
    dictionary: dictionary.artifact,
    search,
    dream,
    sitemap,
    nonDictionary,
    build,
    outputFiles,
  };
}

export function firstDifference(expected, actual, at = '$') {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual) return { path: at, expected, actual };
  if (expected === null || actual === null || typeof expected !== 'object') return { path: at, expected, actual };
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path: at, expected, actual };
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return { path: `${at}.length`, expected: expected.length, actual: actual.length };
    for (let index = 0; index < expected.length; index += 1) {
      const diff = firstDifference(expected[index], actual[index], `${at}[${index}]`);
      if (diff) return diff;
    }
    return null;
  }
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const keyDiff = firstDifference(expectedKeys, actualKeys, `${at} keys`);
  if (keyDiff) return keyDiff;
  for (const key of expectedKeys) {
    const diff = firstDifference(expected[key], actual[key], `${at}.${key}`);
    if (diff) return diff;
  }
  return null;
}
