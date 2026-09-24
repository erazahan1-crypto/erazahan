import { listPublishedDreamSitemapEntries, escapeSitemapXmlText } from './published-sitemaps.mjs';
import { isLocaleIndexingAllowed, runtimeIndexingConfig } from '../indexing-policy.mjs';

function assertOrigin(origin) {
  if (typeof origin !== 'string' || !/^https:\/\/[^/]+$/u.test(origin)) {
    throw new TypeError('Sitemap origin must be an HTTPS origin without a path');
  }
  return origin;
}

function assertSitemapEntry(entry) {
  if (!entry || typeof entry.path !== 'string' || !entry.path.startsWith('/')) {
    throw new TypeError('Sitemap entry must have an absolute public path');
  }
  if (entry.lastmod !== undefined && typeof entry.lastmod !== 'string') {
    throw new TypeError('Sitemap lastmod must be a string when present');
  }
  return entry;
}

export function serializeSitemapXml(entries, origin) {
  assertOrigin(origin);
  if (!Array.isArray(entries)) throw new TypeError('Sitemap entries must be an array');
  const body = entries
    .map((entry) => {
      assertSitemapEntry(entry);
      const lastmod = entry.lastmod ? `\n    <lastmod>${escapeSitemapXmlText(entry.lastmod)}</lastmod>` : '';
      return `  <url><loc>${escapeSitemapXmlText(`${origin}${entry.path}`)}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + body
    + '\n</urlset>';
}

// Publication and public-path ownership remain in Stage 12G-A/12D. The HY
// extras are legacy non-dream URLs and their existing authoritative lastmods.
export function listLocaleSitemapEntries(repository, locale, {
  hyNonDreamEntries = [],
  hyDreamLastmodByPath = new Map(),
  indexingConfig = runtimeIndexingConfig,
} = {}) {
  // The shared policy gates index eligibility only. Publication and public-path
  // ownership remain in the published-content projection below.
  const includeDreams = isLocaleIndexingAllowed(locale, indexingConfig);
  const dreams = (includeDreams ? listPublishedDreamSitemapEntries(repository, locale) : []).map((entry) => ({
    path: entry.path,
    lastmod: locale === 'hy' ? hyDreamLastmodByPath.get(entry.path) : undefined,
  }));
  return Object.freeze(locale === 'hy' && includeDreams ? [...hyNonDreamEntries, ...dreams] : dreams);
}
