import contentRegistry from '../../data/migrations/content-id-registry.v1.json' with { type: 'json' };

// This projection intentionally exposes only canonical HY identity and display
// metadata. Localized documents (including drafts) never participate in it.
export function projectTranslationLinkIndex(repository, registry = contentRegistry) {
  if (!repository?.records || !Array.isArray(registry?.entries)) {
    throw new TypeError('Translation link index requires a validated store and content-id registry');
  }

  const registryIds = new Set(registry.entries.map((entry) => entry?.content_id));
  if (registryIds.size !== registry.entries.length) throw new TypeError('Translation link index registry content_id values must be unique');

  const records = repository.records.map((record) => {
    const published = record.locales?.hy?.published;
    if (!registryIds.has(record.content_id)) throw new TypeError(`Translation link index content_id is absent from registry: ${record.content_id}`);
    if (!published || typeof published.title !== 'string' || typeof published.slug !== 'string') {
      throw new TypeError(`Translation link index HY publication is invalid: ${record.content_id}`);
    }
    return Object.freeze({ content_id: record.content_id, title: published.title, slug: published.slug });
  }).sort((left, right) => left.content_id.localeCompare(right.content_id, 'en'));

  if (records.length !== registryIds.size) throw new TypeError('Translation link index store and registry counts differ');
  if (new Set(records.map((record) => record.content_id)).size !== records.length) throw new TypeError('Translation link index content_id values must be unique');
  return Object.freeze(records);
}
