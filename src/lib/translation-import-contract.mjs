export const TRANSLATION_IMPORT_FIELDS = Object.freeze(['slug', 'title', 'description', 'content', 'image_alts', 'tags', 'alphabet_key']);

function failure(message) { return Object.freeze({ ok: false, message }); }
function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

export function parseTranslationImport(raw) {
  if (typeof raw !== 'string') return failure('Import must be text.');
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  let value;
  try { value = JSON.parse(fenced ? fenced[1] : trimmed); } catch { return failure('Import must be one valid JSON object, optionally inside a JSON code fence.'); }
  if (!plainObject(value)) return failure('Import must be a JSON object.');
  if (Object.keys(value).length !== TRANSLATION_IMPORT_FIELDS.length || !TRANSLATION_IMPORT_FIELDS.every((key) => Object.hasOwn(value, key))) return failure('Import must contain exactly: slug, title, description, content, image_alts, tags, alphabet_key.');
  if (typeof value.slug !== 'string' || typeof value.title !== 'string' || (typeof value.description !== 'string' && value.description !== null) || typeof value.content !== 'string'
    || !plainObject(value.image_alts) || !Object.values(value.image_alts).every((entry) => typeof entry === 'string')
    || !Array.isArray(value.tags) || !value.tags.every((entry) => typeof entry === 'string') || (typeof value.alphabet_key !== 'string' && value.alphabet_key !== null)) return failure('Import fields have invalid types.');
  return Object.freeze({ ok: true, value: Object.freeze({ slug: value.slug, title: value.title, description: value.description, content: value.content, image_alts: Object.freeze({ ...value.image_alts }), tags: Object.freeze([...value.tags]), alphabet_key: value.alphabet_key }) });
}
