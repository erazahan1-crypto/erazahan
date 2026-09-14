import { SITE } from '../lib/config';
import { scanContentStore } from '../lib/content-source/multilingual-store.mjs';
import { listLocaleSitemapEntries, serializeSitemapXml } from '../lib/content-source/locale-sitemap-xml.mjs';
import { hyDreamLastmodByPath, listHyNonDreamSitemapEntries } from '../lib/sitemap-entries';

export function GET() {
  const repository = scanContentStore('src/data/content/dreams');
  const entries = listLocaleSitemapEntries(repository, 'hy', {
    hyNonDreamEntries: listHyNonDreamSitemapEntries(),
    hyDreamLastmodByPath: hyDreamLastmodByPath(),
  });
  return new Response(serializeSitemapXml(entries, SITE), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
