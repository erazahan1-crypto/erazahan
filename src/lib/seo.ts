import { SITE, SITE_NAME } from './config';
import type { Post } from './site';

// JSON-LD (Schema.org) для поисковой выдачи и соцсетей.

export const websiteSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE,
  inLanguage: 'hy',
  potentialAction: {
    '@type': 'SearchAction',
    target: `${SITE}/search?q={search_term_string}`,
    'query-input': 'required name=search_term_string',
  },
});

export const breadcrumbSchema = (items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: it.url,
  })),
});

export const articleSchema = (post: Post) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: post.title,
  inLanguage: 'hy',
  mainEntityOfPage: `${SITE}/${post.slug}/`,
  datePublished: post.date || undefined,
  author: { '@type': 'Organization', name: SITE_NAME },
  publisher: { '@type': 'Organization', name: SITE_NAME },
  ...(post.description ? { description: post.description } : {}),
  ...(post.cover ? { image: post.cover.startsWith('http') ? post.cover : `${SITE}${post.cover}` } : {}),
});

export const itemListSchema = (name: string, items: { name: string; url: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name,
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    url: it.url,
  })),
});
