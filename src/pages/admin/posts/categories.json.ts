import { posts } from '../../../lib/site';

export function GET() {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const category of normalizeCategories(post.categories)) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }

  const categories = [...counts].map(([name, count]) => ({ name, count }));
  return new Response(JSON.stringify(categories), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

function normalizeCategories(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const category = item.trim().replace(/\s+/g, ' ');
    const key = category.normalize('NFKC').toLocaleLowerCase('hy-AM');
    if (!category || seen.has(key)) continue;
    seen.add(key);
    result.push(category);
  }
  return result;
}
