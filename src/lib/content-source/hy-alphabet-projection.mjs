import {
  isSupportedHyDreamAlphabetKey,
  normalizeHyDreamAlphabetKey,
} from '../content-schema/hy-alphabet.mjs';

// Imported wordList order remains the authority for historical cards. Native
// records are appended in their canonical post order so creation does not need
// to synchronize the imported pages.json projection.
export function projectHyAlphabetWordList({ letter, legacyWordList, posts, nativeSlugs, resolveLegacySlug }) {
  const targetKey = normalizeHyDreamAlphabetKey(letter);
  if (!isSupportedHyDreamAlphabetKey(targetKey)) return legacyWordList;

  const projected = [...legacyWordList];
  const occupiedSlugs = new Set();
  for (const card of legacyWordList) {
    const resolved = resolveLegacySlug(card.slug);
    if (resolved) occupiedSlugs.add(resolved);
  }

  for (const post of posts) {
    if (!nativeSlugs.has(post.slug)) continue;
    if (normalizeHyDreamAlphabetKey(post.letter) !== targetKey || occupiedSlugs.has(post.slug)) continue;
    occupiedSlugs.add(post.slug);
    projected.push({ slug: post.slug, wordText: post.title, wordTranslit: '' });
  }
  return projected;
}
