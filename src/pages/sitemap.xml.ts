// Генерирует /sitemap.xml (статический endpoint)
import { posts, pages, nameLetterPages } from '../lib/site';
import { SITE } from '../lib/config';

export function GET() {
  const urls = new Map<string, { loc: string; lastmod?: string }>();
  const addUrl = (loc: string, lastmod?: string) => {
    if (!urls.has(loc)) urls.set(loc, { loc, lastmod });
  };

  addUrl('/');
  for (const p of posts) addUrl(`/${p.slug}/`, p.date || undefined);
  for (const p of pages) {
    if (p.isFront) continue;
    addUrl(`/${p.path}/`, p.date || undefined);
  }
  for (const p of nameLetterPages) addUrl(`/${p.path}/`);

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    [...urls.values()]
      .map((u) => {
        const lastmod = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
        return `  <url><loc>${SITE}${u.loc}</loc>${lastmod}\n  </url>`;
      })
      .join('\n') +
    '\n</urlset>';

  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
