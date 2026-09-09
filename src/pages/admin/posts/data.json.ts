import postsJson from '../../../data/posts.json';
import type { Post } from '../../../lib/site';

const posts = postsJson as Post[];

export function GET() {
  const index = posts.map((post, id) => ({
    id: String(id),
    title: post.title,
    slug: post.slug,
    categories: normalizeCategories(post.categories),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

function normalizeCategories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(values
    .filter((category): category is string => typeof category === 'string')
    .map((category) => category.trim())
    .filter(Boolean))];
}
