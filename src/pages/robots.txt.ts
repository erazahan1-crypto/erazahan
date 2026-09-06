// Генерирует /robots.txt (статический endpoint)
import { SITE } from '../lib/config';

export function GET() {
  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /keystatic\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
