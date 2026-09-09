export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface SearchIndexItem {
  slug: string;
  title: string;
  text: string;
  baseWord?: string;
  symbol?: string;
  keywords?: string[] | string;
  tags?: string[] | string;
}

export interface RankedPost extends SearchIndexItem {
  match: 'exact' | 'close' | 'partial';
  score: number;
}

export interface DreamSymbolLink {
  id: string;
  dream_id: string;
  symbol_text: string;
  post_slug: string;
  post_title: string;
  created_at: string;
}

export interface FullContentItem extends SearchIndexItem {
  interpretation: string;
}

export interface DreamInterpretationContext {
  dream_text: string;
  symbols: Array<{ symbol: string; slug: string; title: string; interpretation: string }>;
}

export const tokenize = (value: string): string[] =>
  value.normalize('NFKC').toLocaleLowerCase('hy-AM').match(/[\p{L}\p{N}]+/gu) || [];

const STOP_WORDS = new Set([
  'երազ', 'երազի', 'երազում', 'երազներ', 'երազահան', 'տեսնել', 'տեսա', 'տեսնում',
  'նշանակում', 'նշանակությունը', 'ինչ', 'ինչպես', 'այս', 'դա', 'ես', 'իմ', 'մի',
  'որ', 'և', 'ու', 'է', 'եմ', 'են',
].flatMap(tokenize));

const normalizedPhrase = (value: string): string => tokenize(value).join(' ');
const significantTitleTokens = (title: string): string[] => tokenize(title.split(':', 1)[0]).filter((token) => token !== 'երազահան');
const containsPhrase = (tokens: string[], query: string[]): boolean => {
  if (!query.length || query.length > tokens.length) return false;
  return tokens.some((_, start) => query.every((token, offset) => tokens[start + offset] === token));
};
const listTokens = (value?: string[] | string): string[] => Array.isArray(value) ? value.flatMap(tokenize) : tokenize(value || '');

const rankItem = (query: string, item: SearchIndexItem): RankedPost | null => {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return null;
  const queryPhrase = queryTokens.join(' ');
  const titleTokens = significantTitleTokens(item.title);
  const titlePhrase = titleTokens.join(' ');
  const baseTokens = [...tokenize(item.baseWord || ''), ...tokenize(item.symbol || '')];
  const metadataTokens = [...listTokens(item.keywords), ...listTokens(item.tags)];
  const exactTitle = titlePhrase === queryPhrase;
  const wholeTitle = containsPhrase(titleTokens, queryTokens);
  const exactBase = containsPhrase(baseTokens, queryTokens);
  const startsTitle = titlePhrase.startsWith(`${queryPhrase} `);
  const exactMetadata = containsPhrase(metadataTokens, queryTokens);
  const morphologicalTitle = queryTokens.length === 1 && titleTokens.some((token) => token.startsWith(queryPhrase));
  const partialTitle = titleTokens.some((token) => token.includes(queryPhrase));
  const textMatch = normalizedPhrase(item.text || '').includes(queryPhrase);
  const slugMatch = normalizedPhrase(item.slug.replace(/[-_]/g, ' ')).includes(queryPhrase);

  if (exactTitle) return { ...item, match: 'exact', score: 1000 };
  if (wholeTitle) return { ...item, match: 'exact', score: 900 + (startsTitle ? 20 : 0) };
  if (exactBase) return { ...item, match: 'exact', score: 800 };
  if (startsTitle) return { ...item, match: 'close', score: 700 };
  if (exactMetadata) return { ...item, match: 'close', score: 600 };
  if (morphologicalTitle) return { ...item, match: 'close', score: 500 };
  if (partialTitle) return { ...item, match: 'partial', score: 400 };
  if (textMatch) return { ...item, match: 'partial', score: 200 };
  if (slugMatch) return { ...item, match: 'partial', score: 100 };
  return null;
};

export const rankPosts = (query: string, index: SearchIndexItem[], limit = 20): RankedPost[] =>
  index
    .map((item, order) => ({ ranked: rankItem(query, item), order }))
    .filter((entry): entry is { ranked: RankedPost; order: number } => Boolean(entry.ranked))
    .sort((a, b) => b.ranked.score - a.ranked.score || a.order - b.order)
    .slice(0, limit)
    .map(({ ranked }) => ranked);

export const suggestDreamSymbols = (dreamText: string, index: SearchIndexItem[], limit = 12) => {
  const dreamTokens = Array.from(new Set(tokenize(dreamText).filter((token) => token.length >= 2 && !STOP_WORDS.has(token))));
  const dreamSet = new Set(dreamTokens);
  const candidates = index.flatMap((item, order) => {
    const titleTokens = significantTitleTokens(item.title);
    const exact = titleTokens.filter((token) => dreamSet.has(token)).sort((a, b) => b.length - a.length)[0];
    if (exact) return [{ symbol: exact, post: { ...item, match: 'exact' as const, score: 900 }, order }];
    const partial = dreamTokens.filter((token) => titleTokens.some((titleToken) => titleToken.includes(token))).sort((a, b) => b.length - a.length)[0];
    return partial ? [{ symbol: partial, post: { ...item, match: 'partial' as const, score: 400 }, order }] : [];
  }).sort((a, b) => b.post.score - a.post.score || a.order - b.order);
  const usedSymbols = new Set<string>();
  const usedPosts = new Set<string>();
  return candidates
    .filter(({ symbol, post }) => !usedSymbols.has(symbol) && !usedPosts.has(post.slug) && usedSymbols.add(symbol) && usedPosts.add(post.slug))
    .slice(0, limit)
    .map(({ symbol, post }) => ({ symbol, post }));
};

let contentIndexPromise: Promise<FullContentItem[]> | null = null;

export function loadContentIndex(assets: AssetsBinding, requestUrl: string): Promise<FullContentItem[]> {
  if (!contentIndexPromise) {
    contentIndexPromise = assets.fetch(new Request(new URL('/dream-content-index.json', requestUrl)))
      .then(async (response) => {
        if (!response.ok) throw new Error('content index unavailable');
        const value: unknown = await response.json();
        if (!Array.isArray(value)) return [];
        return value.flatMap((item): FullContentItem[] => {
          if (!item || typeof item !== 'object') return [];
          const raw = item as Record<string, unknown>;
          if (typeof raw.slug !== 'string' || typeof raw.title !== 'string' || typeof raw.interpretation !== 'string') return [];
          return [{
            slug: raw.slug,
            title: raw.title,
            text: raw.interpretation.slice(0, 220),
            interpretation: raw.interpretation,
          }];
        });
      })
      .catch((error) => {
        contentIndexPromise = null;
        throw error;
      });
  }
  return contentIndexPromise;
}

export function buildDreamInterpretationContext(dreamText: string, links: DreamSymbolLink[], content: FullContentItem[]): DreamInterpretationContext {
  const bySlug = new Map(content.map((item) => [item.slug, item]));
  return {
    dream_text: dreamText,
    symbols: links.flatMap((link) => {
      const article = bySlug.get(link.post_slug);
      return article ? [{ symbol: link.symbol_text, slug: `/${link.post_slug}/`, title: article.title, interpretation: article.interpretation }] : [];
    }),
  };
}
