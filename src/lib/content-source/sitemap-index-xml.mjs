import { escapeSitemapXmlText } from './published-sitemaps.mjs';

function assertOrigin(origin) {
  if (typeof origin !== 'string' || !/^https:\/\/[^/]+$/u.test(origin)) {
    throw new TypeError('Sitemap origin must be an HTTPS origin without a path');
  }
  return origin;
}

export function serializeSitemapIndexXml(paths, origin) {
  assertOrigin(origin);
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.startsWith('/'))) {
    throw new TypeError('Sitemap index paths must be absolute public paths');
  }
  const body = paths
    .map((path) => `  <sitemap>\n    <loc>${escapeSitemapXmlText(`${origin}${path}`)}</loc>\n  </sitemap>`)
    .join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + body
    + '\n</sitemapindex>';
}
