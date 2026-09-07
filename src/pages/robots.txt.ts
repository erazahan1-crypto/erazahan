// Генерирует /robots.txt (статический endpoint)
import { SITE, ALLOW_INDEXING } from '../lib/config';

export function GET() {
  const body = ALLOW_INDEXING
    ? `User-agent: *\nAllow: /\nDisallow: /keystatic\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`
    : `User-agent: *\nDisallow: /\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
