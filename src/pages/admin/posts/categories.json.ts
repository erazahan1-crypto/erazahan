import { selectedHyPosts } from '../../../lib/content-source/hy-content-source.mjs';

export function GET() {
  const counts = new Map<string, number>();
  for (const post of selectedHyPosts) {
    for (const category of normalizeCategories(post.categories)) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }

  const categories = [...counts].map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name, 'hy-AM', { sensitivity: 'base' })
      || left.name.localeCompare(right.name, 'en'));
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
    if (typeof item !== 'string' || !item.trim() || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}
