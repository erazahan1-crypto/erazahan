// Pre-production audit scanner for the "allow indexing" dist build.
// Read-only: does not modify dist, src, or any project files.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DIST_ALLOW = path.join(ROOT, '_buildcheck', 'allow');
const DIST_DEFAULT = path.join(ROOT, '_buildcheck', 'default');
const OUT_DIR = path.join(ROOT, 'audit');

const SITE_HOST = 'erazahan.info';
const PAGES_DEV_HOST = 'erazahan.pages.dev';

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, exts, out);
    else if (!exts || exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}

// ---------- Build route set from dist/allow ----------
const htmlFiles = walk(DIST_ALLOW, ['.html']);
const allFiles = walk(DIST_ALLOW, null);

const routeSet = new Set();
for (const f of htmlFiles) {
  const rel = path.relative(DIST_ALLOW, f).split(path.sep).join('/');
  if (rel === 'index.html') {
    routeSet.add('/');
  } else if (rel.endsWith('/index.html')) {
    routeSet.add('/' + rel.slice(0, -'index.html'.length));
  } else {
    // bare .html file (e.g. 404.html) -> also reachable as /404.html
    routeSet.add('/' + rel);
  }
}
// non-html static top-level assets that act as "routes" (endpoints)
for (const special of ['robots.txt', 'sitemap.xml', 'search-index.json']) {
  if (fs.existsSync(path.join(DIST_ALLOW, special))) routeSet.add('/' + special);
}

function routeExists(p) {
  let decoded = p;
  try { decoded = decodeURIComponent(p); } catch { /* leave as-is if malformed */ }
  for (const candidate of [p, decoded]) {
    if (routeSet.has(candidate)) return true;
    if (!candidate.endsWith('/') && routeSet.has(candidate + '/')) return true;
  }
  return false;
}

// Strip <script>...</script> blocks before link scanning so client-side JS
// template literals (e.g. `href="/${item.slug}/"`) aren't mistaken for real links.
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// ---------- Scan all HTML for links & security patterns ----------
const brokenInternalLinks = []; // {file, link}
const wpTechnicalLinks = []; // {file, link, reason}
const suspiciousLinks = []; // {file, link, reason}
const externalDomains = new Map(); // domain -> {count, examples:Set, contexts:Set(script/img/iframe/link/a/font)}
const securityFindings = []; // {file, pattern, snippet}
const wpResiduePatterns = []; // {file, pattern, snippet}
const contentSanityFindings = []; // {file, pattern, snippet}
const pagesDevLinks = []; // {file, link}

const ATTR_RE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const TAG_SCAN_RE = /<(script|iframe)\b[^>]*>/gi;
const ONEVENT_RE = /\bon(?:click|error|load|mouseover|focus)\s*=/gi;
const STYLE_HIDDEN_RE = /style\s*=\s*["'][^"']*(display:\s*none|position:\s*absolute[^"']*(?:-9999|off-?screen)|text-indent:\s*-9999)[^"']*["']/gi;

function classifyExternalHost(host) {
  return host.replace(/^www\./, '');
}

function recordExternalDomain(url, context, file) {
  try {
    const u = new URL(url);
    const host = classifyExternalHost(u.hostname);
    if (!externalDomains.has(host)) externalDomains.set(host, { count: 0, examples: new Set(), contexts: new Set() });
    const rec = externalDomains.get(host);
    rec.count++;
    rec.contexts.add(context);
    if (rec.examples.size < 3) rec.examples.add(path.relative(DIST_ALLOW, file).split(path.sep).join('/'));
  } catch {
    /* ignore invalid URL */
  }
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const linkScanHtml = stripScripts(html);
  const relFile = path.relative(DIST_ALLOW, file).split(path.sep).join('/');

  // --- links ---
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(linkScanHtml))) {
    const raw = m[1];
    const link = raw.trim();
    if (!link || link.startsWith('#') || link.startsWith('mailto:') || link.startsWith('tel:')) continue;
    if (link.startsWith('javascript:')) {
      suspiciousLinks.push({ file: relFile, link, reason: 'javascript: URL' });
      continue;
    }
    if (link.startsWith('data:')) continue; // inline data URIs (favicon etc.) not a link-check concern here

    let isInternal = false;
    let checkPath = null;

    if (link.startsWith('/')) {
      isInternal = true;
      checkPath = link;
    } else if (/^https?:\/\//i.test(link)) {
      try {
        const u = new URL(link);
        const host = classifyExternalHost(u.hostname);
        if (host === SITE_HOST) {
          isInternal = true;
          checkPath = u.pathname + ''; // ignore query for existence check
        } else if (host === PAGES_DEV_HOST) {
          pagesDevLinks.push({ file: relFile, link });
          continue;
        } else {
          recordExternalDomain(link, tagContextGuess(linkScanHtml, m.index), file);
          continue;
        }
      } catch {
        continue;
      }
    } else {
      // relative path without leading slash (rare) - skip, not used by this codebase
      continue;
    }

    if (!isInternal || !checkPath) continue;

    const pathOnly = checkPath.split('?')[0].split('#')[0];

    // WordPress technical / historical junk detection (informational only per task scope)
    if (/\/feed\/?($|\/)/i.test(pathOnly) || /\/tag\//i.test(pathOnly) || /^\/wp-/i.test(pathOnly) ||
        /wp-admin|wp-login|wp-json|xmlrpc\.php|wp-content|wp-includes/i.test(pathOnly) ||
        /\/attachment\//i.test(pathOnly) || /\?attachment_id=/i.test(checkPath)) {
      wpTechnicalLinks.push({ file: relFile, link, reason: 'old WordPress technical URL' });
      continue;
    }

    // asset-ish paths (skip broken-link check scope; handled separately in asset pass)
    if (/\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|json|xml|txt|map)$/i.test(pathOnly)) {
      continue;
    }

    if (!routeExists(pathOnly)) {
      brokenInternalLinks.push({ file: relFile, link, reason: 'no matching route in dist' });
    }
  }

  // --- security scan ---
  TAG_SCAN_RE.lastIndex = 0;
  while ((m = TAG_SCAN_RE.exec(html))) {
    const tag = m[0];
    const srcMatch = /src\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (srcMatch && /^https?:\/\//i.test(srcMatch[1])) {
      recordExternalDomain(srcMatch[1], m[1].toLowerCase(), file);
    }
    if (m[1].toLowerCase() === 'iframe') {
      securityFindings.push({ file: relFile, pattern: 'iframe', snippet: tag.slice(0, 160) });
    }
  }
  for (const pat of [
    { re: /\beval\s*\(/g, name: 'eval(' },
    { re: /\bnew\s+Function\s*\(/g, name: 'new Function(' },
    { re: /document\.write\s*\(/g, name: 'document.write(' },
    { re: /\batob\s*\(/g, name: 'atob(' },
  ]) {
    pat.re.lastIndex = 0;
    if (pat.re.test(html)) {
      const idx = html.search(pat.re instanceof RegExp ? new RegExp(pat.re.source) : pat.re);
      securityFindings.push({ file: relFile, pattern: pat.name, snippet: html.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ') });
    }
  }
  ONEVENT_RE.lastIndex = 0;
  if (ONEVENT_RE.test(html)) {
    const idx = html.search(/\bon(?:click|error|load|mouseover|focus)\s*=/i);
    securityFindings.push({ file: relFile, pattern: 'inline event handler (onclick/onerror/onload/...)', snippet: html.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, ' ') });
  }
  STYLE_HIDDEN_RE.lastIndex = 0;
  if (STYLE_HIDDEN_RE.test(html)) {
    const idx = html.search(/style\s*=\s*["'][^"']*(display:\s*none|position:\s*absolute)/i);
    securityFindings.push({ file: relFile, pattern: 'hidden element (display:none/offscreen) with content', snippet: html.slice(Math.max(0, idx - 40), idx + 140).replace(/\s+/g, ' ') });
  }
  // long base64-like blobs (heuristic: 200+ chars of base64 alphabet)
  const b64 = html.match(/[A-Za-z0-9+/]{200,}={0,2}/g);
  if (b64) {
    for (const blob of b64.slice(0, 3)) {
      securityFindings.push({ file: relFile, pattern: 'long base64-like string', snippet: blob.slice(0, 60) + '...' });
    }
  }

  // --- WordPress residue (informational, not blocking per task) ---
  for (const pat of [
    /wp-content\//i, /wp-includes\//i, /wp-json/i, /xmlrpc\.php/i, /wp-admin/i, /wp-login\.php/i,
    /generator["'][^>]*WordPress/i, /rel=["']https:\/\/api\.w\.org/i, /feed\+xml/i,
  ]) {
    const mm = html.match(pat);
    if (mm) wpResiduePatterns.push({ file: relFile, pattern: pat.source, snippet: mm[0] });
  }

  // --- content sanity: leftover shortcodes / php tags ---
  for (const pat of [/\[caption[^\]]*\]/i, /\[gallery[^\]]*\]/i, /\[vc_[a-z_]+/i, /\[elementor_[a-z_]+/i, /<\?php/i, /&amp;#8217;{2,}/]) {
    const mm = html.match(pat);
    if (mm) contentSanityFindings.push({ file: relFile, pattern: pat.source, snippet: mm[0] });
  }

  // external domains from plain css/font links (link rel=stylesheet/preload href to external)
  const linkTagRe = /<link\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  while ((m = linkTagRe.exec(html))) recordExternalDomain(m[1], 'link', file);
}

function tagContextGuess(html, idx) {
  const before = html.slice(Math.max(0, idx - 20), idx).toLowerCase();
  if (before.includes('<script')) return 'script';
  if (before.includes('<img')) return 'img';
  if (before.includes('<iframe')) return 'iframe';
  if (before.includes('<a ')) return 'a';
  if (before.includes('<link')) return 'link';
  return 'other';
}

// ---------- Sitemap validation ----------
function analyzeSitemap(distDir, label) {
  const p = path.join(distDir, 'sitemap.xml');
  if (!fs.existsSync(p)) return { label, exists: false };
  const xml = fs.readFileSync(p, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const dupes = locs.filter((v, i) => locs.indexOf(v) !== i);
  const nonErazahan = locs.filter((l) => {
    try { return new URL(l).hostname !== SITE_HOST; } catch { return true; }
  });
  const pagesDev = locs.filter((l) => l.includes(PAGES_DEV_HOST));
  const wpJunk = locs.filter((l) => /\/feed\/?|\/tag\/|wp-admin|wp-json|wp-login/i.test(l));
  const missingInDist = locs.filter((l) => {
    try {
      const u = new URL(l);
      const p2 = u.pathname;
      return !routeExists(p2);
    } catch { return true; }
  });
  return {
    label,
    exists: true,
    total: locs.length,
    duplicates: dupes.length,
    nonErazahanHost: nonErazahan.length,
    pagesDevCount: pagesDev.length,
    wpJunkCount: wpJunk.length,
    missingInDistCount: missingInDist.length,
    missingInDistSample: missingInDist.slice(0, 20),
    nonErazahanSample: nonErazahan.slice(0, 10),
  };
}
const sitemapAllow = analyzeSitemap(DIST_ALLOW, 'allow');
const sitemapDefault = analyzeSitemap(DIST_DEFAULT, 'default');

// ---------- Asset existence check ----------
const assetRefs = new Set();
const ASSET_ATTR_RE = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  let m;
  ASSET_ATTR_RE.lastIndex = 0;
  while ((m = ASSET_ATTR_RE.exec(html))) {
    const link = m[1].trim();
    if (link.startsWith('/') && /\.(css|js|mjs|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)(\?.*)?$/i.test(link)) {
      assetRefs.add(link.split('?')[0]);
    }
  }
}
const brokenAssets = [];
for (const a of assetRefs) {
  const fp = path.join(DIST_ALLOW, a.replace(/^\//, ''));
  if (!fs.existsSync(fp)) brokenAssets.push(a);
}

// ---------- Dev-only / localhost / source map / file:// checks ----------
const devLeaks = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const relFile = path.relative(DIST_ALLOW, file).split(path.sep).join('/');
  for (const pat of [/localhost/i, /127\.0\.0\.1/, /file:\/\//i, /[A-Za-z]:\\\\/, /@vite\/client/i, /\/\/# sourceMappingURL=/]) {
    const mm = html.match(pat);
    if (mm) devLeaks.push({ file: relFile, pattern: pat.source, snippet: mm[0] });
  }
}
const jsSourceMaps = allFiles.filter((f) => f.endsWith('.js.map') || f.endsWith('.css.map'));
const googleFontsRefs = [];
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html)) {
    googleFontsRefs.push(path.relative(DIST_ALLOW, file).split(path.sep).join('/'));
  }
}

// ---------- SEO sample checks ----------
function pickSample() {
  const rels = htmlFiles.map((f) => path.relative(DIST_ALLOW, f).split(path.sep).join('/'));
  const pick = [];
  const want = [
    'index.html',
    '404.html',
    'search/index.html',
    'about/index.html',
    'erazahan-online/index.html',
  ];
  for (const w of want) if (rels.includes(w)) pick.push(w);
  // add some dream posts
  pick.push(...rels.filter((r) => r.startsWith('erazahan-') && r.endsWith('/index.html')).slice(0, 15));
  // add some letter pages (single-armenian-char dirs)
  pick.push(...rels.filter((r) => /^[\u0531-\u0556\u0561-\u0587]\/index\.html$/.test(r)).slice(0, 10));
  // add name-meaning pages
  pick.push(...rels.filter((r) => r.includes('anvan-nshanakutyuny') && r.endsWith('/index.html')).slice(0, 15));
  // dedupe, cap at 60
  return [...new Set(pick)].slice(0, 60);
}
const sample = pickSample();
const seoResults = [];
for (const rel of sample) {
  const html = fs.readFileSync(path.join(DIST_ALLOW, rel), 'utf8');
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? null;
  const desc = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const canonical = /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const ogUrl = /<meta\s+property=["']og:url["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const lang = /<html[^>]*\slang=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const robotsMeta = /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  seoResults.push({ file: rel, h1Count, title, desc, canonical, ogUrl, lang, robotsMeta });
}

// same checks on default (noindex) build for a couple of pages to confirm robots meta present
const noindexCheck = [];
for (const rel of ['index.html', 'erazahan-ez/index.html'].filter((r) => fs.existsSync(path.join(DIST_DEFAULT, r)))) {
  const html = fs.readFileSync(path.join(DIST_DEFAULT, rel), 'utf8');
  const robotsMeta = /<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  const canonical = /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
  noindexCheck.push({ file: rel, robotsMeta, canonical });
}

// ---------- Write CSVs ----------
fs.mkdirSync(OUT_DIR, { recursive: true });

function toCsv(rows, headers) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

fs.writeFileSync(
  path.join(OUT_DIR, 'broken-links.csv'),
  toCsv(
    [
      ...brokenInternalLinks.map((r) => ({ ...r, category: 'broken-internal' })),
      ...wpTechnicalLinks.map((r) => ({ ...r, category: 'wp-technical' })),
      ...pagesDevLinks.map((r) => ({ ...r, category: 'pages-dev-link', reason: 'links to pages.dev' })),
      ...suspiciousLinks.map((r) => ({ ...r, category: 'suspicious' })),
    ],
    ['category', 'file', 'link', 'reason']
  ),
  'utf8'
);

const extRows = [...externalDomains.entries()].map(([host, rec]) => ({
  host,
  count: rec.count,
  contexts: [...rec.contexts].join('|'),
  examples: [...rec.examples].join('|'),
}));
fs.writeFileSync(path.join(OUT_DIR, 'external-domains.csv'), toCsv(extRows, ['host', 'count', 'contexts', 'examples']), 'utf8');

fs.writeFileSync(
  path.join(OUT_DIR, 'suspicious-content.csv'),
  toCsv(
    [
      ...securityFindings.map((r) => ({ ...r, category: 'security' })),
      ...wpResiduePatterns.map((r) => ({ ...r, category: 'wp-residue' })),
      ...contentSanityFindings.map((r) => ({ ...r, category: 'content-sanity' })),
      ...devLeaks.map((r) => ({ ...r, category: 'dev-leak' })),
    ],
    ['category', 'file', 'pattern', 'snippet']
  ),
  'utf8'
);

// ---------- Summary JSON for report generation ----------
const summary = {
  totals: {
    htmlFiles: htmlFiles.length,
    routeSetSize: routeSet.size,
  },
  brokenInternalLinks: brokenInternalLinks.length,
  wpTechnicalLinks: wpTechnicalLinks.length,
  pagesDevLinks: pagesDevLinks.length,
  suspiciousLinks: suspiciousLinks.length,
  externalDomainsCount: externalDomains.size,
  externalDomains: extRows.sort((a, b) => b.count - a.count),
  securityFindingsCount: securityFindings.length,
  securityFindingsSample: securityFindings.slice(0, 30),
  wpResidueCount: wpResiduePatterns.length,
  wpResidueSample: wpResiduePatterns.slice(0, 30),
  contentSanityCount: contentSanityFindings.length,
  contentSanitySample: contentSanityFindings.slice(0, 30),
  devLeaksCount: devLeaks.length,
  devLeaksSample: devLeaks.slice(0, 30),
  jsSourceMapsCount: jsSourceMaps.length,
  jsSourceMaps: jsSourceMaps.map((f) => path.relative(DIST_ALLOW, f)),
  googleFontsRefsCount: googleFontsRefs.length,
  brokenAssetsCount: brokenAssets.length,
  brokenAssets: brokenAssets.slice(0, 50),
  assetRefsScanned: assetRefs.size,
  sitemapAllow,
  sitemapDefault,
  seoSampleCount: seoResults.length,
  seoResults,
  noindexCheck,
  brokenInternalLinksSample: brokenInternalLinks.slice(0, 50),
  wpTechnicalLinksSample: wpTechnicalLinks.slice(0, 50),
  pagesDevLinksSample: pagesDevLinks.slice(0, 50),
};

fs.writeFileSync(path.join(OUT_DIR, 'audit-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

console.log('AUDIT_DONE');
console.log(JSON.stringify({
  htmlFiles: summary.totals.htmlFiles,
  brokenInternalLinks: summary.brokenInternalLinks,
  wpTechnicalLinks: summary.wpTechnicalLinks,
  pagesDevLinks: summary.pagesDevLinks,
  externalDomainsCount: summary.externalDomainsCount,
  securityFindingsCount: summary.securityFindingsCount,
  wpResidueCount: summary.wpResidueCount,
  contentSanityCount: summary.contentSanityCount,
  devLeaksCount: summary.devLeaksCount,
  brokenAssetsCount: summary.brokenAssetsCount,
  sitemapAllowTotal: sitemapAllow.total,
  sitemapAllowMissing: sitemapAllow.missingInDistCount,
}, null, 2));
