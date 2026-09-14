// Генерирует /sitemap.xml (статический endpoint)
import { SITE } from '../lib/config';
import { listCurrentSitemapEntries } from '../lib/sitemap-entries';
import { serializeSitemapXml } from '../lib/content-source/locale-sitemap-xml.mjs';

export function GET() {
  return new Response(serializeSitemapXml(listCurrentSitemapEntries(), SITE), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
