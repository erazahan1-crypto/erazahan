import { posts, pages, nameLetterPages } from './site';

export type SitemapEntry = { path: string; lastmod?: string };

// This preserves the existing /sitemap.xml insertion order and de-duplication
// policy. HY locale sitemap exposure reuses the non-dream subset below.
export function listCurrentSitemapEntries(): SitemapEntry[] {
  const urls = new Map<string, SitemapEntry>();
  const addUrl = (path: string, lastmod?: string) => {
    if (!urls.has(path)) urls.set(path, { path, lastmod });
  };

  addUrl('/');
  for (const post of posts) addUrl(`/${post.slug}/`, post.date || undefined);
  for (const page of pages) {
    if (page.isFront) continue;
    addUrl(`/${page.path}/`, page.date || undefined);
  }
  for (const page of nameLetterPages) addUrl(`/${page.path}/`);
  return [...urls.values()];
}

export function listHyNonDreamSitemapEntries(): SitemapEntry[] {
  const dreamPaths = new Set(posts.map((post) => `/${post.slug}/`));
  return listCurrentSitemapEntries().filter((entry) => !dreamPaths.has(entry.path));
}

export function hyDreamLastmodByPath(): ReadonlyMap<string, string | undefined> {
  return new Map(posts.map((post) => [`/${post.slug}/`, post.date || undefined]));
}
