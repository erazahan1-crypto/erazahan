import { selectedHyPosts } from '../../../lib/content-source/hy-content-source.mjs';

export function GET() {
  const counts = new Map<string, number>();
  const alphabetKeys = new Map<string, Set<string>>();
  for (const post of selectedHyPosts) {
    for (const category of normalizeCategories(post.categories)) {
      counts.set(category, (counts.get(category) || 0) + 1);
      if (typeof post.letter === 'string' && post.letter.trim()) {
        const keys = alphabetKeys.get(category) || new Set<string>();
        keys.add(post.letter);
        alphabetKeys.set(category, keys);
      }
    }
  }

  const categories = [...counts].map(([name, count]) => ({
    name,
    count,
    alphabet_key: standardAlphabetCategory(name) && alphabetKeys.get(name)?.size === 1
      ? [...alphabetKeys.get(name)!][0]
      : null,
  }))
    .sort((left, right) => left.name.localeCompare(right.name, 'hy-AM', { sensitivity: 'base' })
      || left.name.localeCompare(right.name, 'en'));
  return new Response(JSON.stringify(categories), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

function standardAlphabetCategory(value: string) {
  return /^Երազներ սկսող\s+.+?\s+տառով$/u.test(value);
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
