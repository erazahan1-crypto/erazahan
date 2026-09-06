// Генерирует /sitemap.xml (статический endpoint)
import { posts, pages, nameLetterPages } from '../lib/site';
import { SITE } from '../lib/config';

export function GET() {
  const urls: { loc: string; lastmod?: string }[] = [{ loc: '/' }];
  for (const p of posts) urls.push({ loc: `/${p.slug}/`, lastmod: p.date || undefined });
  for (const p of pages) {
    if (p.isFront) continue;
    urls.push({ loc: `/${p.path}/`, lastmod: p.date || undefined });
  }
  for (const p of nameLetterPages) urls.push({ loc: `/${p.path}/` });

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map((u) => {
        const lastmod = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
        return `  <url><loc>${SITE}${u.loc}</loc>${lastmod}\n  </url>`;
      })
      .join('\n') +
    '\n</urlset>';

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
