import { canonicalJson } from '../../src/lib/content-write/canonical-json.mjs';
import {
  beginLocaleEdit,
  createLocaleDraft,
  discardLocaleDraft,
  publishLocaleDraft,
  rebaseLocaleDraftToCurrentSource,
  updateLocaleDraft,
} from '../../src/lib/content-write/locale-writer-domain.mjs';
import { validateLocaleDraftSlugClaims } from '../../src/lib/content-write/locale-draft-slug-claims.mjs';
import { validateLocaleDocumentStorage, validateLocaleSlugReservations } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { isContentId, validateContentItem } from '../../src/lib/content-schema/schema.mjs';
import { deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import { classifyAlphabetKey } from '../../src/lib/content-schema/locale-alphabet.mjs';
import { hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import { commitMultiFileTransaction, loadMultiFileSnapshot } from './github-multifile.mjs';

export const DRAFT_CLAIMS_PATH = 'src/data/content/locale-draft-slug-claims.v1.json';
export const PUBLISHED_RESERVATIONS_PATH = 'src/data/content/locale-slug-reservations.v1.json';

export class AdminLocaleDraftWriteError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AdminLocaleDraftWriteError';
    this.code = code;
  }
}

function fail(code, message, cause = undefined) { throw new AdminLocaleDraftWriteError(code, message, cause); }
function assertLocale(locale) { if (locale !== 'ru' && locale !== 'en') fail('LOCALE_UNSUPPORTED', 'Locale writer supports only ru and en'); }
function parseRequired(snapshot, filePath, label) {
  const file = snapshot.files.get(filePath);
  if (!file) fail(label === 'item' ? 'CONTENT_NOT_FOUND' : 'SNAPSHOT_FILE_MISSING', `Snapshot is missing ${filePath}`);
  try { return JSON.parse(file.content); } catch (error) { fail('INVALID_SNAPSHOT_JSON', `${label} is not valid JSON`, error); }
}
function validateSnapshot({ snapshot, contentId, locale, paths }) {
  const item = parseRequired(snapshot, paths.item, 'item');
  const hy = parseRequired(snapshot, paths.hy, 'HY locale document');
  const claims = parseRequired(snapshot, DRAFT_CLAIMS_PATH, 'draft slug claims registry');
  const reservations = parseRequired(snapshot, PUBLISHED_RESERVATIONS_PATH, 'published slug reservations registry');
  try {
    validateContentItem(item);
    if (item.content_id !== contentId || item.source_locale !== 'hy') fail('CONTENT_NOT_FOUND', 'Requested content identity is unavailable');
    validateLocaleDocumentStorage({ item, filename: 'hy.json', localeDocument: hy });
    if (!hy.published || hy.draft !== null) fail('INVALID_HY_SOURCE', 'HY source must be published without a draft');
    validateLocaleDraftSlugClaims(claims);
    validateLocaleSlugReservations(reservations);
  } catch (error) {
    if (error instanceof AdminLocaleDraftWriteError) throw error;
    fail('INVALID_SNAPSHOT_STATE', error instanceof Error ? error.message : String(error), error);
  }
  const localeFile = snapshot.files.get(paths.locale);
  let localeDocument = null;
  if (localeFile !== null) {
    if (!localeFile) fail('SNAPSHOT_FILE_MISSING', `Snapshot does not represent ${paths.locale}`);
    try {
      localeDocument = JSON.parse(localeFile.content);
      validateLocaleDocumentStorage({ item, filename: `${locale}.json`, localeDocument });
      if (localeDocument.content_id !== contentId || localeDocument.locale !== locale) fail('INVALID_SNAPSHOT_STATE', 'Locale document identity does not match requested content');
    } catch (error) {
      if (error instanceof AdminLocaleDraftWriteError) throw error;
      fail('INVALID_SNAPSHOT_STATE', error instanceof Error ? error.message : String(error), error);
    }
  }
  return { item, hy, localeDocument, draftClaims: claims, publishedReservations: reservations, localeBlobSha: localeFile?.sha ?? null };
}

export async function loadLocaleDraftSnapshot(client, { branch, contentId, locale }) {
  assertLocale(locale);
  if (!isContentId(contentId)) fail('CONTENT_NOT_FOUND', 'content_id is invalid');
  const base = hyStorePaths(contentId);
  const paths = { ...base, locale: `${base.directory}/${locale}.json` };
  const snapshot = await loadMultiFileSnapshot(client, {
    branch,
    paths: [paths.item, paths.hy, paths.locale, DRAFT_CLAIMS_PATH, PUBLISHED_RESERVATIONS_PATH],
  });
  return { snapshot, paths, ...validateSnapshot({ snapshot, contentId, locale, paths }) };
}

export async function loadLocaleTranslationEditorState(client, input) {
  const loaded = await loadLocaleDraftSnapshot(client, input);
  const { item, hy, localeDocument, localeBlobSha } = loaded;
  const current = localeDocument ?? { schema_version: 1, content_id: item.content_id, locale: input.locale, draft: null, published: null };
  const title = current.draft?.title ?? current.published?.title ?? null;
  return {
    content_id: item.content_id,
    locale: input.locale,
    source: {
      revision: item.source_revision,
      fingerprint: item.source_fingerprint,
      title: hy.published.title,
      description: hy.published.description,
      content: hy.published.content,
      image_alts: structuredClone(hy.published.image_alts),
      tags: structuredClone(hy.published.tags),
      alphabet_key: hy.published.alphabet_key,
    },
    locale_document: localeDocument ? structuredClone(localeDocument) : null,
    locale_blob_sha: localeBlobSha,
    translation_state: deriveTranslationState(current, item),
    slug_locked: (localeDocument?.published ?? null) !== null,
    alphabet_suggestion: title === null ? null : classifyAlphabetKey(input.locale, title),
  };
}

function assertAbsent(loaded, expectedLocaleAbsent) {
  if (expectedLocaleAbsent !== true || loaded.localeDocument !== null || loaded.localeBlobSha !== null) fail('STALE_EDITOR', 'Locale file presence changed; reload the editor');
}
function assertExisting(loaded, expectedLocaleBlobSha) {
  if (typeof expectedLocaleBlobSha !== 'string' || !expectedLocaleBlobSha || loaded.localeBlobSha !== expectedLocaleBlobSha) {
    fail('STALE_EDITOR', 'Locale file changed; reload the editor');
  }
}
function assertSource(loaded, expectedSourceRevision, expectedSourceFingerprint) {
  if (expectedSourceRevision !== loaded.item.source_revision || expectedSourceFingerprint !== loaded.item.source_fingerprint) {
    fail('SOURCE_CHANGED', 'HY source changed; reload before creating a draft');
  }
}
async function transact(client, loaded, changes, message, localeDocument, expectedLocaleBlobSha = undefined) {
  const transaction = await commitMultiFileTransaction(client, {
    snapshot: loaded.snapshot,
    expectedFileShas: expectedLocaleBlobSha ? { [loaded.paths.locale]: expectedLocaleBlobSha } : undefined,
    changes,
    message,
  });
  const localeBlobSha = localeDocument === null
    ? null
    : transaction.noOp
      ? loaded.localeBlobSha
      : transaction.blobShas.get(loaded.paths.locale);
  if (localeDocument !== null && (typeof localeBlobSha !== 'string' || !localeBlobSha)) {
    fail('LOCALE_BLOB_SHA_MISSING', 'Transaction did not return the locale file blob SHA');
  }
  return { changed: !transaction.noOp, code: transaction.noOp ? 'NO_CHANGES' : null, transaction, localeBlobSha };
}
function localeChange(loaded, document, operation = 'update') { return { operation, path: loaded.paths.locale, content: canonicalJson(document) }; }
function claimsChange(loaded, claims) {
  const content = canonicalJson(claims);
  return loaded.snapshot.files.get(DRAFT_CLAIMS_PATH)?.content === content ? null : { operation: 'update', path: DRAFT_CLAIMS_PATH, content };
}
function reservationsChange(loaded, reservations) {
  const content = canonicalJson(reservations);
  return loaded.snapshot.files.get(PUBLISHED_RESERVATIONS_PATH)?.content === content ? null : { operation: 'update', path: PUBLISHED_RESERVATIONS_PATH, content };
}
function assertFirstPublishReservationConsistency(loaded) {
  if (!loaded.localeDocument?.published && loaded.publishedReservations.reservations.some((entry) => (
    entry.kind === 'active' && entry.locale === loaded.localeDocument?.locale
      && entry.content_id === loaded.item.content_id && entry.slug !== loaded.localeDocument?.draft?.slug
 ))) fail('PUBLISH_INVALID', 'First publication cannot replace an active permanent slug reservation');
}

export async function createLocaleDraftWrite(client, { branch, contentId, locale, payload, expectedLocaleAbsent, expectedSourceRevision, expectedSourceFingerprint }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertAbsent(loaded, expectedLocaleAbsent);
  assertSource(loaded, expectedSourceRevision, expectedSourceFingerprint);
  const result = createLocaleDraft({ item: loaded.item, locale, payload: structuredClone(payload), draftClaims: loaded.draftClaims, publishedReservations: loaded.publishedReservations });
  const claims = claimsChange(loaded, result.draftClaims);
  if (!claims) fail('INVALID_DRAFT_CLAIM_TRANSITION', 'First draft must create a draft claim');
  return { ...await transact(client, loaded, [localeChange(loaded, result.localeDocument, 'create'), claims], 'Admin: create locale draft', result.localeDocument), localeDocument: result.localeDocument };
}

export async function updateLocaleDraftWrite(client, { branch, contentId, locale, payload, expectedLocaleBlobSha }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertExisting(loaded, expectedLocaleBlobSha);
  const result = updateLocaleDraft({ item: loaded.item, locale, localeDocument: loaded.localeDocument, payload: structuredClone(payload), draftClaims: loaded.draftClaims, publishedReservations: loaded.publishedReservations });
  const claims = claimsChange(loaded, result.draftClaims);
  return { ...await transact(client, loaded, [localeChange(loaded, result.localeDocument), ...claims ? [claims] : []], 'Admin: update locale draft', result.localeDocument, expectedLocaleBlobSha), localeDocument: result.localeDocument };
}

export async function beginLocaleEditWrite(client, { branch, contentId, locale, expectedLocaleBlobSha }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertExisting(loaded, expectedLocaleBlobSha);
  const result = beginLocaleEdit({ item: loaded.item, locale, localeDocument: loaded.localeDocument, draftClaims: loaded.draftClaims, publishedReservations: loaded.publishedReservations });
  return { ...await transact(client, loaded, [localeChange(loaded, result.localeDocument)], 'Admin: begin locale edit', result.localeDocument, expectedLocaleBlobSha), localeDocument: result.localeDocument };
}

export async function rebaseLocaleDraftWrite(client, { branch, contentId, locale, expectedLocaleBlobSha }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertExisting(loaded, expectedLocaleBlobSha);
  try {
    const result = rebaseLocaleDraftToCurrentSource({ item: loaded.item, locale, localeDocument: loaded.localeDocument, draftClaims: loaded.draftClaims, publishedReservations: loaded.publishedReservations });
    return { ...await transact(client, loaded, [localeChange(loaded, result.localeDocument)], 'Admin: rebase locale draft', result.localeDocument, expectedLocaleBlobSha), localeDocument: result.localeDocument };
  } catch (error) {
    if (error?.code === 'NO_CHANGES') return { changed: false, code: 'NO_CHANGES', transaction: null, localeDocument: loaded.localeDocument, localeBlobSha: loaded.localeBlobSha };
    throw error;
  }
}

export async function discardLocaleDraftWrite(client, { branch, contentId, locale, expectedLocaleBlobSha }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertExisting(loaded, expectedLocaleBlobSha);
  const result = discardLocaleDraft({ item: loaded.item, locale, localeDocument: loaded.localeDocument, draftClaims: loaded.draftClaims, publishedReservations: loaded.publishedReservations });
  const changes = result.localeDocument === null
    ? [{ operation: 'delete', path: loaded.paths.locale }, claimsChange(loaded, result.draftClaims)]
    : [localeChange(loaded, result.localeDocument)];
  return { ...await transact(client, loaded, changes.filter(Boolean), 'Admin: discard locale draft', result.localeDocument, expectedLocaleBlobSha), localeDocument: result.localeDocument };
}

export async function publishLocaleDraftWrite(client, { branch, contentId, locale, expectedLocaleBlobSha }) {
  const loaded = await loadLocaleDraftSnapshot(client, { branch, contentId, locale });
  assertExisting(loaded, expectedLocaleBlobSha);
  assertFirstPublishReservationConsistency(loaded);
  try {
    const result = publishLocaleDraft({
      item: loaded.item,
      locale,
      localeDocument: loaded.localeDocument,
      draftClaims: loaded.draftClaims,
      publishedReservations: loaded.publishedReservations,
      publishedAt: new Date().toISOString().slice(0, 10),
    });
    const claims = claimsChange(loaded, result.draftClaims);
    const reservations = reservationsChange(loaded, result.publishedReservations);
    return {
      ...await transact(client, loaded, [localeChange(loaded, result.localeDocument), claims, reservations].filter(Boolean), 'Admin: publish locale draft', result.localeDocument, expectedLocaleBlobSha),
      localeDocument: result.localeDocument,
    };
  } catch (error) {
    if (error?.code === 'NO_CHANGES') return { changed: false, code: 'NO_CHANGES', transaction: null, localeDocument: loaded.localeDocument, localeBlobSha: loaded.localeBlobSha };
    throw error;
  }
}
