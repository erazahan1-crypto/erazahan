import { canonicalJson, canonicalJsonEqual } from '../../src/lib/content-write/canonical-json.mjs';
import {
  beginLocaleEdit,
  createLocaleDraft,
  publishLocaleDraft,
  updateLocaleDraft,
} from '../../src/lib/content-write/locale-writer-domain.mjs';
import { validateLocaleDraftSlugClaims } from '../../src/lib/content-write/locale-draft-slug-claims.mjs';
import { publicPathFor, validateLocaleDocumentStorage, validateLocaleSlugReservations } from '../../src/lib/content-schema/multilingual-contract.mjs';
import { isContentId, validateContentItem } from '../../src/lib/content-schema/schema.mjs';
import { deriveTranslationState } from '../../src/lib/content-schema/state.mjs';
import { classifyAlphabetKey } from '../../src/lib/content-schema/locale-alphabet.mjs';
import { hyStorePaths } from '../../src/lib/content-write/project-hy-post.mjs';
import { createMediaManifestIndex } from '../../src/lib/content-source/media-manifest-contract.mjs';
import { projectHyImageReferences } from '../../src/lib/content-source/hy-legacy-images.mjs';
import { commitMultiFileTransaction, loadMultiFileSnapshot } from './github-multifile.mjs';
import { localizedAuthoringContext } from './localized-reference-context.mjs';
import { LocalizedContentValidationError, validateLocalizedBody } from '../../src/lib/localized-content-pipeline.mjs';

export const DRAFT_CLAIMS_PATH = 'src/data/content/locale-draft-slug-claims.v1.json';
export const PUBLISHED_RESERVATIONS_PATH = 'src/data/content/locale-slug-reservations.v1.json';
export const MEDIA_MANIFEST_PATH = 'src/data/content/media-manifest.v1.json';
const LOCALES = Object.freeze(['ru', 'en']);

export class AdminLocaleBatchPublishError extends Error {
  constructor(code, message, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AdminLocaleBatchPublishError';
    this.code = code;
  }
}

function fail(code, message, cause = undefined) { throw new AdminLocaleBatchPublishError(code, message, cause); }
function assertLocale(locale) { if (!LOCALES.includes(locale)) fail('LOCALE_UNSUPPORTED', 'Batch writer supports only ru and en'); }
function parseRequired(snapshot, path, label) {
  const file = snapshot.files.get(path);
  if (!file) fail(label === 'item' ? 'CONTENT_NOT_FOUND' : 'SNAPSHOT_FILE_MISSING', `Snapshot is missing ${path}`);
  try { return JSON.parse(file.content); } catch (error) { fail('INVALID_SNAPSHOT_JSON', `${label} is not valid JSON`, error); }
}
function emptyDocument(contentId, locale) { return { schema_version: 1, content_id: contentId, locale, draft: null, published: null }; }
function documentPath(paths, locale) { return `${paths.directory}/${locale}.json`; }
function validateLogicalBody(document, mode, mediaIndex) {
  const snapshot = mode === 'publish' ? document.published : document.draft;
  try {
    validateLocalizedBody({
      content: snapshot.content,
      imageAlts: snapshot.image_alts,
      locale: document.locale,
      currentContentId: document.content_id,
      ...localizedAuthoringContext,
      mediaIndex,
      mode,
    });
  } catch (error) {
    if (error instanceof LocalizedContentValidationError) {
      throw new AdminLocaleBatchPublishError(mode === 'publish' ? 'PUBLISH_INVALID' : 'DRAFT_INVALID', error.message, error);
    }
    fail(mode === 'publish' ? 'PUBLISH_INVALID' : 'DRAFT_INVALID', 'Localized content validation failed', error);
  }
}

function validateLoadedSnapshot({ snapshot, contentId, paths }) {
  const item = parseRequired(snapshot, paths.item, 'item');
  const hy = parseRequired(snapshot, paths.hy, 'HY locale document');
  const claims = parseRequired(snapshot, DRAFT_CLAIMS_PATH, 'draft slug claims registry');
  const reservations = parseRequired(snapshot, PUBLISHED_RESERVATIONS_PATH, 'published slug reservations registry');
  const mediaManifest = parseRequired(snapshot, MEDIA_MANIFEST_PATH, 'managed media manifest');
  let mediaIndex;
  try {
    validateContentItem(item);
    if (item.content_id !== contentId || item.source_locale !== 'hy') fail('CONTENT_NOT_FOUND', 'Requested content identity is unavailable');
    validateLocaleDocumentStorage({ item, filename: 'hy.json', localeDocument: hy });
    if (!hy.published || hy.draft !== null) fail('INVALID_HY_SOURCE', 'HY source must be published without a draft');
    validateLocaleDraftSlugClaims(claims);
    validateLocaleSlugReservations(reservations);
    mediaIndex = createMediaManifestIndex(mediaManifest);
  } catch (error) {
    if (error instanceof AdminLocaleBatchPublishError) throw error;
    fail('INVALID_SNAPSHOT_STATE', error instanceof Error ? error.message : String(error), error);
  }
  const documents = {};
  const blobShas = {};
  for (const locale of LOCALES) {
    const path = documentPath(paths, locale);
    const file = snapshot.files.get(path);
    if (file === null) {
      documents[locale] = null;
      blobShas[locale] = null;
      continue;
    }
    if (!file) fail('SNAPSHOT_FILE_MISSING', `Snapshot does not represent ${path}`);
    try {
      const localeDocument = JSON.parse(file.content);
      validateLocaleDocumentStorage({ item, filename: `${locale}.json`, localeDocument });
      if (localeDocument.content_id !== contentId || localeDocument.locale !== locale) fail('INVALID_SNAPSHOT_STATE', 'Locale document identity does not match requested content');
      documents[locale] = localeDocument;
      blobShas[locale] = file.sha;
    } catch (error) {
      if (error instanceof AdminLocaleBatchPublishError) throw error;
      fail('INVALID_SNAPSHOT_STATE', error instanceof Error ? error.message : String(error), error);
    }
  }
  return { item, hy, claims, reservations, mediaIndex, documents, blobShas };
}

export async function loadLocaleBatchSnapshot(client, { branch, contentId }) {
  if (!isContentId(contentId)) fail('CONTENT_NOT_FOUND', 'content_id is invalid');
  const paths = hyStorePaths(contentId);
  const snapshot = await loadMultiFileSnapshot(client, {
    branch,
    paths: [
      paths.item,
      paths.hy,
      ...LOCALES.map((locale) => documentPath(paths, locale)),
      DRAFT_CLAIMS_PATH,
      PUBLISHED_RESERVATIONS_PATH,
      MEDIA_MANIFEST_PATH,
    ],
  });
  return { snapshot, paths, ...validateLoadedSnapshot({ snapshot, contentId, paths }) };
}

function projectDocumentSummary(item, document, locale, blobSha) {
  const current = document ?? emptyDocument(item.content_id, locale);
  const state = deriveTranslationState(current, item);
  return {
    locale,
    locale_document: document ? structuredClone(document) : null,
    locale_blob_sha: blobSha,
    translation_state: state,
    slug_locked: Boolean(document?.published),
    alphabet_suggestion: classifyAlphabetKey(locale, current.draft?.title ?? current.published?.title ?? ''),
    published_path: current.published ? publicPathFor(locale, current.published.slug) : null,
  };
}

export async function loadLocaleBatchEditorState(client, input) {
  const loaded = await loadLocaleBatchSnapshot(client, input);
  return {
    content_id: loaded.item.content_id,
    source: {
      revision: loaded.item.source_revision,
      fingerprint: loaded.item.source_fingerprint,
      title: loaded.hy.published.title,
      slug: loaded.hy.published.slug,
      published_path: publicPathFor('hy', loaded.hy.published.slug),
      description: loaded.hy.published.description,
      content: loaded.hy.published.content,
      image_alts: structuredClone(loaded.hy.published.image_alts),
      tags: structuredClone(loaded.hy.published.tags),
      alphabet_key: loaded.hy.published.alphabet_key,
    },
    hy_images: projectHyImageReferences(loaded.hy.published.content, loaded.mediaIndex)
      .map(({ source_url, ...image }) => ({ ...image, url: source_url })),
    locales: Object.fromEntries(LOCALES.map((locale) => [locale, projectDocumentSummary(loaded.item, loaded.documents[locale], locale, loaded.blobShas[locale])])),
  };
}

function assertSource(loaded, revision, fingerprint) {
  if (revision !== loaded.item.source_revision || fingerprint !== loaded.item.source_fingerprint) {
    fail('SOURCE_CHANGED', 'HY source changed; reload the editor before writing');
  }
}
function assertSelectedLocale(loaded, selection) {
  const currentDocument = loaded.documents[selection.locale];
  const currentSha = loaded.blobShas[selection.locale];
  if (currentDocument === null) {
    if (selection.expectedLocaleAbsent !== true) fail('STALE_EDITOR', `${selection.locale.toUpperCase()} locale presence changed; reload the editor`);
  } else if (selection.expectedLocaleBlobSha !== currentSha) {
    fail('STALE_EDITOR', `${selection.locale.toUpperCase()} locale changed; reload the editor`);
  }
  if (currentDocument?.published && selection.replacePublished !== true) {
    fail('PUBLISHED_REPLACEMENT_CONFIRMATION_REQUIRED', `${selection.locale.toUpperCase()} already has a published translation`);
  }
}
function assertDraftClaim(document, claims, item) {
  if (document?.draft && !document.published) {
    const owner = claims.claims.find((entry) => entry.locale === document.locale && entry.slug === document.draft.slug)?.content_id;
    if (owner !== item.content_id) fail('DRAFT_INVALID', 'Draft slug claim is missing or owned by another content item');
  }
}
function replacePayloadAsCurrentSource({ item, locale, document, payload, claims, reservations }) {
  if (document === null) {
    const created = createLocaleDraft({ item, locale, localeDocument: null, payload, draftClaims: claims, publishedReservations: reservations });
    return { document: created.localeDocument, claims: created.draftClaims, reservations: created.publishedReservations };
  }
  assertDraftClaim(document, claims, item);
  let result = document.draft
    ? { localeDocument: structuredClone(document), draftClaims: claims, publishedReservations: reservations }
    : beginLocaleEdit({ item, locale, localeDocument: document, draftClaims: claims, publishedReservations: reservations });
  // Importing text never changes the source provenance of an existing draft.
  // An editor must use the explicit Rebase flow before claiming CURRENT.
  const updated = updateLocaleDraft({
    item,
    locale,
    localeDocument: result.localeDocument,
    payload,
    draftClaims: result.draftClaims,
    publishedReservations: result.publishedReservations,
  });
  return { document: updated.localeDocument, claims: updated.draftClaims, reservations: updated.publishedReservations };
}

function applySelection({ item, selection, document, claims, reservations, mediaIndex, publishedAt }) {
  let current = document;
  let nextClaims = claims;
  let nextReservations = reservations;
  if (selection.mode === 'import') {
    const replacement = replacePayloadAsCurrentSource({ item, locale: selection.locale, document: current, payload: structuredClone(selection.payload), claims: nextClaims, reservations: nextReservations });
    current = replacement.document;
    nextClaims = replacement.claims;
    nextReservations = replacement.reservations;
    validateLogicalBody(current, 'draft', mediaIndex);
  }
  if (!current?.draft) fail('NO_DRAFT', `${selection.locale.toUpperCase()} has no draft to publish`);
  if (current.published && selection.replacePublished !== true) fail('PUBLISHED_REPLACEMENT_CONFIRMATION_REQUIRED', `${selection.locale.toUpperCase()} already has a published translation`);
  assertDraftClaim(current, nextClaims, item);
  const published = publishLocaleDraft({
    item,
    locale: selection.locale,
    localeDocument: current,
    draftClaims: nextClaims,
    publishedReservations: nextReservations,
    publishedAt,
    allowOutdatedSource: selection.allowOutdatedSource === true,
  });
  validateLogicalBody(published.localeDocument, 'publish', mediaIndex);
  return { document: published.localeDocument, claims: published.draftClaims, reservations: published.publishedReservations };
}

function forLocale(locale, operation) {
  try { return operation(); }
  catch (error) {
    if (error instanceof AdminLocaleBatchPublishError) {
      if (!error.locale) error.locale = locale;
      throw error;
    }
    if (error && typeof error === 'object' && typeof error.code === 'string') {
      const wrapped = new AdminLocaleBatchPublishError(error.code, error instanceof Error ? error.message : error.code, error);
      wrapped.locale = locale;
      throw wrapped;
    }
    throw error;
  }
}

function documentChange(loaded, locale, document) {
  const path = documentPath(loaded.paths, locale);
  const original = loaded.snapshot.files.get(path);
  const content = canonicalJson(document);
  if (original?.content === content) return null;
  return { operation: original === null ? 'create' : 'update', path, content };
}
function registryChange(loaded, path, value) {
  const content = canonicalJson(value);
  return loaded.snapshot.files.get(path)?.content === content ? null : { operation: 'update', path, content };
}

export async function prepareLocaleBatchPublish(client, { branch, contentId, expectedSourceRevision, expectedSourceFingerprint, selections, publishedAt = new Date().toISOString().slice(0, 10) }) {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > LOCALES.length) fail('INVALID_REQUEST', 'Select one or two translations');
  const locales = new Set();
  for (const selection of selections) {
    assertLocale(selection?.locale);
    if (locales.has(selection.locale)) fail('INVALID_REQUEST', 'A locale may be selected only once');
    locales.add(selection.locale);
  }
  const loaded = await loadLocaleBatchSnapshot(client, { branch, contentId });
  assertSource(loaded, expectedSourceRevision, expectedSourceFingerprint);
  for (const selection of selections) forLocale(selection.locale, () => assertSelectedLocale(loaded, selection));

  let claims = loaded.claims;
  let reservations = loaded.reservations;
  const documents = { ...loaded.documents };
  const summary = [];
  for (const selection of selections) {
    const previous = documents[selection.locale];
    const next = forLocale(selection.locale, () => applySelection({ item: loaded.item, selection, document: previous, claims, reservations, mediaIndex: loaded.mediaIndex, publishedAt }));
    documents[selection.locale] = next.document;
    claims = next.claims;
    reservations = next.reservations;
    summary.push({
      locale: selection.locale,
      replaces_published: Boolean(previous?.published),
      replaces_draft: Boolean(previous?.draft),
      published: structuredClone(next.document.published),
      synchronization: deriveTranslationState(next.document, loaded.item).published_synchronization,
    });
  }
  try {
    validateLocaleDraftSlugClaims(claims);
    validateLocaleSlugReservations(reservations);
    for (const locale of LOCALES) {
      if (documents[locale]) validateLocaleDocumentStorage({ item: loaded.item, filename: `${locale}.json`, localeDocument: documents[locale] });
    }
  } catch (error) {
    if (error instanceof AdminLocaleBatchPublishError) throw error;
    fail('PUBLISH_INVALID', error instanceof Error ? error.message : String(error), error);
  }
  const changes = [
    ...selections.map((selection) => documentChange(loaded, selection.locale, documents[selection.locale])).filter(Boolean),
    registryChange(loaded, DRAFT_CLAIMS_PATH, claims),
    registryChange(loaded, PUBLISHED_RESERVATIONS_PATH, reservations),
  ].filter(Boolean);
  return { loaded, documents, claims, reservations, summary, changes };
}

export async function publishLocaleBatch(client, input) {
  const prepared = await prepareLocaleBatchPublish(client, input);
  const expectedFileShas = Object.fromEntries(input.selections
    .filter((selection) => typeof selection.expectedLocaleBlobSha === 'string')
    .map((selection) => [documentPath(prepared.loaded.paths, selection.locale), selection.expectedLocaleBlobSha]));
  const transaction = await commitMultiFileTransaction(client, {
    snapshot: prepared.loaded.snapshot,
    expectedFileShas,
    changes: prepared.changes,
    message: `Admin: batch publish ${input.selections.map((selection) => selection.locale.toUpperCase()).join(' + ')} translations`,
  });
  return { changed: !transaction.noOp, code: transaction.noOp ? 'NO_CHANGES' : null, transaction, ...prepared };
}
