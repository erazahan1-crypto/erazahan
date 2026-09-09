const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const ARMENIAN_INFLECTION_SUFFIXES = new Set([
  'ը', 'ն', 'ի', 'ից', 'ին', 'ով', 'ում', 'ներ', 'երը', 'երին', 'երից', 'երով', 'ներում',
  // Common irregular plural used by մարդ -> մարդիկ.
  'իկ',
]);

/** @param {unknown} value */
export function tokenizeSearchText(value) {
  if (typeof value !== 'string') return [];
  return value.normalize('NFKC').toLocaleLowerCase('hy-AM').match(WORD_PATTERN) || [];
}

/** @param {unknown} value */
export function normalizeSearchText(value) {
  return tokenizeSearchText(value).join(' ');
}

/** @param {string[]} tokens @param {string[]} queryTokens */
function phraseIndex(tokens, queryTokens) {
  if (!queryTokens.length || queryTokens.length > tokens.length) return -1;
  for (let start = 0; start <= tokens.length - queryTokens.length; start += 1) {
    if (queryTokens.every((token, offset) => tokens[start + offset] === token)) return start;
  }
  return -1;
}

/** @param {unknown} value */
function listValues(value) {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  return typeof value === 'string' ? [value] : [];
}

/** @param {unknown} value */
function titleTokens(value) {
  if (typeof value !== 'string') return [];
  const tokens = tokenizeSearchText(value.split(':', 1)[0]);
  return tokens[0] === 'երազահան' ? tokens.slice(1) : tokens;
}

/** @param {string} queryToken @param {string} candidate */
function isCloseWordForm(queryToken, candidate) {
  if (queryToken.length < 3 || candidate === queryToken || !candidate.startsWith(queryToken)) return false;
  return ARMENIAN_INFLECTION_SUFFIXES.has(candidate.slice(queryToken.length));
}

/**
 * Normalize and tokenize an index once, immediately after it is loaded.
 * The original item is retained so the public search-index schema stays unchanged.
 * @param {Array<Record<string, any>>} index
 */
export function prepareSearchIndex(index) {
  if (!Array.isArray(index)) return [];
  return index.map((item, order) => {
    const preparedTitleTokens = titleTokens(item.title);
    return {
      item,
      order,
      titleTokens: preparedTitleTokens,
      titlePhrase: preparedTitleTokens.join(' '),
      basePhrases: [item.baseWord, item.symbol].map(normalizeSearchText).filter(Boolean),
      metadataPhrases: [...listValues(item.keywords), ...listValues(item.tags)]
        .map(normalizeSearchText)
        .filter(Boolean),
      textPhrase: normalizeSearchText(item.text),
      slugPhrase: normalizeSearchText(typeof item.slug === 'string' ? item.slug.replace(/[-_]/g, ' ') : ''),
    };
  });
}

/** @param {string} queryPhrase @param {string[]} queryTokens @param {ReturnType<typeof prepareSearchIndex>[number]} entry */
function scoreEntry(queryPhrase, queryTokens, entry) {
  const titleMatchAt = phraseIndex(entry.titleTokens, queryTokens);

  if (entry.titlePhrase === queryPhrase) return { score: 1000, match: 'exact-title' };
  if (titleMatchAt >= 0) {
    return { score: titleMatchAt === 0 ? 920 : 900, match: 'whole-word-title' };
  }
  if (entry.basePhrases.includes(queryPhrase)) return { score: 800, match: 'exact-base' };
  if (entry.metadataPhrases.includes(queryPhrase)) return { score: 600, match: 'exact-metadata' };

  if (
    queryTokens.length === 1 &&
    entry.titleTokens.some((candidate) => isCloseWordForm(queryTokens[0], candidate))
  ) {
    return { score: 500, match: 'close-word-form' };
  }

  if (entry.titleTokens.some((token) => token.includes(queryPhrase))) {
    return { score: 400, match: 'title-substring' };
  }
  if (entry.textPhrase.includes(queryPhrase)) return { score: 200, match: 'text' };
  if (entry.slugPhrase.includes(queryPhrase)) return { score: 100, match: 'slug' };
  return null;
}

/**
 * Rank a prepared index. Original index order is the deterministic tie-breaker.
 * @param {string} query
 * @param {ReturnType<typeof prepareSearchIndex>} preparedIndex
 * @param {number} limit
 */
export function rankPreparedSearch(query, preparedIndex, limit) {
  const queryTokens = tokenizeSearchText(query);
  if (!queryTokens.length) return [];
  const queryPhrase = queryTokens.join(' ');

  return preparedIndex
    .flatMap((entry) => {
      const ranking = scoreEntry(queryPhrase, queryTokens, entry);
      return ranking ? [{ ...entry.item, ...ranking, _order: entry.order }] : [];
    })
    .sort((a, b) => b.score - a.score || a._order - b._order)
    .slice(0, limit)
    .map(({ _order, ...item }) => item);
}

/** @param {string} query @param {Array<Record<string, any>>} index @param {number} limit */
export function rankSearch(query, index, limit = 20) {
  return rankPreparedSearch(query, prepareSearchIndex(index), limit);
}
