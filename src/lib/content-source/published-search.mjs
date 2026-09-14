import { plainTextFromPostContent } from '../render-post-content.ts';
import { assertSupportedLocale, publicPathFor } from '../content-schema/multilingual-contract.mjs';
import { loadLegacyHyPosts } from './hy-content-source.mjs';
import { listPublishedLocaleEntries } from './published-content.mjs';

const LEGACY_HY_ORDER = new Map(loadLegacyHyPosts().map((post, index) => [post.slug, index]));

function freeze(value) {
  return Object.freeze(value);
}

function orderFor(locale, entry) {
  // HY's long-standing index is in legacy posts.json order. Preserve that
  // stable public ordering while all future locale indexes use the Stage 12D
  // repository order (content_id ascending).
  return locale === 'hy' ? LEGACY_HY_ORDER.get(entry.slug) ?? Number.MAX_SAFE_INTEGER : 0;
}

export function projectPublishedSearchEntry(entry) {
  const path = publicPathFor(entry.locale, entry.slug);
  if (entry.path !== path) throw new TypeError(`Published search path mismatch for ${entry.locale}/${entry.slug}`);

  // This is deliberately the current public index schema. Path authority is
  // validated above, but no new public field is introduced in Stage 12H-A.
  return freeze({
    slug: entry.slug,
    title: entry.published.title,
    letter: entry.published.alphabet_key,
    text: plainTextFromPostContent(entry.published.content).slice(0, 220),
  });
}

// Projects only Stage 12D published snapshots. It never reads locale drafts or
// offers a cross-locale fallback.
export function listPublishedSearchEntries(repository, locale) {
  assertSupportedLocale(locale);
  return freeze(listPublishedLocaleEntries(repository, locale)
    .map((entry, repositoryOrder) => ({ entry, repositoryOrder, order: orderFor(locale, entry) }))
    .sort((left, right) => left.order - right.order || left.repositoryOrder - right.repositoryOrder)
    .map(({ entry }) => projectPublishedSearchEntry(entry)));
}
