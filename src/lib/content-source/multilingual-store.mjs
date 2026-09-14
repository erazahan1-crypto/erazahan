import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  CONTENT_LOCALES,
  isContentId,
  validateContentItem,
} from '../content-schema/schema.mjs';
import {
  assertSupportedLocale,
  assertLocalePublicSlug,
  localeDocumentFilename,
  localeFromDocumentFilename,
  validateLocaleDocumentStorage,
} from '../content-schema/multilingual-contract.mjs';

const SHARD_RE = /^[0-9a-f]{2}$/;
const ALLOWED_FILENAMES = new Set(['item.json', ...CONTENT_LOCALES.map(localeDocumentFilename)]);

function toPosix(value) {
  return value.split(path.sep).join('/');
}

export class MultilingualStoreValidationError extends Error {
  constructor(code, context, message, cause) {
    super(`Multilingual store ${code}: ${message}`, cause ? { cause } : undefined);
    this.name = 'MultilingualStoreValidationError';
    this.code = code;
    this.context = Object.freeze({
      content_id: context.content_id ?? null,
      path: context.path ?? null,
      locale: context.locale ?? null,
    });
  }
}

function fail(code, context, message, cause) {
  throw new MultilingualStoreValidationError(code, context, message, cause);
}

function relative(root, absolute) {
  return toPosix(path.relative(root, absolute));
}

function readJson(root, absolute, context) {
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail('INVALID_JSON', { ...context, path: relative(root, absolute) }, error instanceof Error ? error.message : String(error));
  }
}

function validateRecord(root, shard, idEntry) {
  const directory = path.join(root, shard, idEntry);
  const baseContext = { content_id: idEntry, path: relative(root, directory), locale: null };
  if (!isContentId(idEntry)) fail('INVALID_CONTENT_ID', baseContext, 'directory name is not a schema content_id');
  if (idEntry.slice(0, 2).toLowerCase() !== shard) fail('SHARD_MISMATCH', baseContext, 'directory does not belong to its shard');

  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const names = new Set();
  for (const entry of entries) {
    const entryContext = { ...baseContext, path: `${baseContext.path}/${entry.name}` };
    if (!entry.isFile() || !ALLOWED_FILENAMES.has(entry.name)) {
      fail('UNEXPECTED_CONTENT_ENTRY', entryContext, 'only item.json, hy.json, ru.json, and en.json are allowed');
    }
    names.add(entry.name);
  }
  for (const required of ['item.json', 'hy.json']) {
    if (!names.has(required)) fail('MISSING_REQUIRED_DOCUMENT', baseContext, `${required} is required`);
  }

  const itemPath = path.join(directory, 'item.json');
  const item = readJson(root, itemPath, baseContext);
  try {
    validateContentItem(item);
  } catch (error) {
    fail('INVALID_ITEM_DOCUMENT', { ...baseContext, path: relative(root, itemPath) }, error instanceof Error ? error.message : String(error));
  }
  if (item.content_id !== idEntry) fail('CONTENT_ID_MISMATCH', { ...baseContext, path: relative(root, itemPath) }, 'item.json content_id does not match directory');

  const locales = {};
  for (const filename of [...names].filter((name) => name !== 'item.json').sort((a, b) => a.localeCompare(b, 'en'))) {
    const locale = localeFromDocumentFilename(filename);
    const documentPath = path.join(directory, filename);
    const localeDocument = readJson(root, documentPath, { ...baseContext, locale });
    try {
      validateLocaleDocumentStorage({ item, filename, localeDocument });
    } catch (error) {
      fail('INVALID_LOCALE_DOCUMENT', { ...baseContext, path: relative(root, documentPath), locale }, error instanceof Error ? error.message : String(error));
    }
    if (localeDocument.content_id !== idEntry) {
      fail('CONTENT_ID_MISMATCH', { ...baseContext, path: relative(root, documentPath), locale }, 'locale document content_id does not match directory');
    }
    if (Object.hasOwn(locales, locale)) fail('DUPLICATE_LOCALE_DOCUMENT', { ...baseContext, locale }, 'more than one document was loaded for this locale');
    locales[locale] = localeDocument;
  }
  return Object.freeze({
    content_id: idEntry,
    shard,
    directory: relative(root, directory),
    item,
    locales: Object.freeze(locales),
  });
}

function validateActiveSlugClaims(records) {
  const claims = new Map();
  for (const record of records) {
    for (const locale of CONTENT_LOCALES) {
      const document = record.locales[locale];
      if (!document) continue;
      for (const [state, payload] of [['published', document.published], ['draft', document.draft]]) {
        if (!payload) continue;
        const context = {
          content_id: record.content_id,
          path: `${record.directory}/${localeDocumentFilename(locale)}`,
          locale,
        };
        let slug;
        try {
          slug = assertLocalePublicSlug(locale, payload.slug);
        } catch (error) {
          fail(
            'INVALID_ACTIVE_SLUG',
            context,
            `${state} slug is invalid: ${error instanceof Error ? error.message : String(error)}`,
            error,
          );
        }
        const key = `${locale}\u0000${slug}`;
        const existing = claims.get(key);
        if (existing && existing.content_id !== record.content_id) {
          fail('ACTIVE_SLUG_COLLISION', {
            content_id: record.content_id,
            path: record.directory,
            locale,
          }, `${state} slug ${locale}/${slug} is already claimed by ${existing.content_id}`);
        }
        claims.set(key, { content_id: record.content_id, state });
      }
    }
  }
}

// Returns every schema-valid locale document, including draft-only and outdated
// translations. Public visibility selection intentionally belongs to Stage 12D.
export function scanContentStore(root) {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    fail('STORE_ROOT_MISSING', { path: root }, 'store root must be an existing directory');
  }
  const records = [];
  const shards = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const shardEntry of shards) {
    if (!shardEntry.isDirectory() || !SHARD_RE.test(shardEntry.name)) {
      fail('UNEXPECTED_ROOT_ENTRY', { path: shardEntry.name }, 'root entries must be two-character lower-case hex shard directories');
    }
    const shard = shardEntry.name;
    const shardPath = path.join(root, shard);
    for (const idEntry of readdirSync(shardPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (!idEntry.isDirectory()) fail('UNEXPECTED_SHARD_ENTRY', { path: `${shard}/${idEntry.name}` }, 'shard entries must be content directories');
      records.push(validateRecord(root, shard, idEntry.name));
    }
  }
  records.sort((a, b) => a.content_id.localeCompare(b.content_id, 'en'));
  validateActiveSlugClaims(records);
  const counts = Object.freeze({
    logical_records: records.length,
    item_documents: records.length,
    hy_documents: records.filter((record) => record.locales.hy).length,
    ru_documents: records.filter((record) => record.locales.ru).length,
    en_documents: records.filter((record) => record.locales.en).length,
    total_files: records.reduce((total, record) => total + 1 + Object.keys(record.locales).length, 0),
  });
  return Object.freeze({ root, records: Object.freeze(records), counts });
}

export function listContentRecords(repository) {
  return repository.records;
}

export function getContentRecord(repository, contentId) {
  if (!isContentId(contentId)) return null;
  return repository.records.find((record) => record.content_id === contentId) ?? null;
}

export function getLocaleDocument(repository, contentId, locale) {
  assertSupportedLocale(locale);
  return getContentRecord(repository, contentId)?.locales[locale] ?? null;
}
