import { publicPathFor } from '../content-schema/multilingual-contract.mjs';
import { deriveTranslationState } from '../content-schema/state.mjs';

const LOCALES = ['ru', 'en'];

function emptyLocaleDocument(contentId, locale) {
  return { schema_version: 1, content_id: contentId, locale, draft: null, published: null };
}

function projectLocale(record, locale) {
  const document = record.locales[locale] ?? emptyLocaleDocument(record.content_id, locale);
  const translationState = deriveTranslationState(document, record.item);
  const published = document.published;
  const draft = document.draft;
  return Object.freeze({
    publication_state: translationState.publication_state,
    outdated: translationState.draft_synchronization === 'OUTDATED' || translationState.published_synchronization === 'OUTDATED',
    draft: draft ? Object.freeze({ title: draft.title, slug: draft.slug }) : null,
    published: published ? Object.freeze({ title: published.title, slug: published.slug, path: publicPathFor(locale, published.slug) }) : null,
  });
}

// Admin-only projection. It intentionally includes draft labels for translation work
// and must not be reused by public rendering, search, sitemap, or hreflang code.
export function projectTranslationDashboard(repository) {
  return Object.freeze(repository.records.map((record) => Object.freeze({
    content_id: record.content_id,
    hy: Object.freeze({ title: record.locales.hy.published.title, slug: record.locales.hy.published.slug }),
    ru: projectLocale(record, 'ru'),
    en: projectLocale(record, 'en'),
  })));
}

// Compact companion to the existing HY admin index: IDs follow its unchanged
// numeric edit identity, and only created translations carry locale metadata.
// Reuse exactly the dashboard's canonical lifecycle/freshness/URL projection.
export function projectPostTranslations(repository, posts) {
  const idsBySlug = new Map(repository.records.map((record) => [record.locales.hy.published.slug, record.content_id]));
  const content_ids = posts.map((post) => idsBySlug.get(post.slug));
  if (content_ids.some((id) => !id) || new Set(content_ids).size !== repository.records.length || content_ids.length !== repository.records.length) {
    throw new Error('Admin posts must match every canonical HY item exactly once');
  }
  const locales = Object.fromEntries(LOCALES.map((locale) => [locale, repository.records
    .filter((record) => record.locales[locale]?.draft || record.locales[locale]?.published)
    .map((record) => ({ content_id: record.content_id, ...projectLocale(record, locale) }))]));
  return { content_ids, ...locales };
}

export function translationDashboardSearchText(row) {
  return [
    row.content_id,
    row.hy.title,
    row.hy.slug,
    ...LOCALES.flatMap((locale) => [row[locale].draft?.title, row[locale].draft?.slug, row[locale].published?.title, row[locale].published?.slug]),
  ].filter(Boolean).join('\n').toLocaleLowerCase();
}

export const TRANSLATION_DASHBOARD_LOCALES = Object.freeze([...LOCALES]);
