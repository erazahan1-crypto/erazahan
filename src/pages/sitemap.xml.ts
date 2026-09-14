// Генерирует /sitemap.xml (статический endpoint)
import { SITE } from '../lib/config';
import { serializeSitemapIndexXml } from '../lib/content-source/sitemap-index-xml.mjs';

export function GET() {
  return new Response(serializeSitemapIndexXml([
    '/sitemap-hy.xml',
    '/sitemap-ru.xml',
    '/sitemap-en.xml',
  ], SITE), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
