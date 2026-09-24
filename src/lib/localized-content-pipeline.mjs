import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import {
  parseLogicalAssetReference,
  parseLogicalContentReference,
  resolveLogicalContentReference,
  imageAltState,
} from './content-schema/logical-references.mjs';
import { resolveLogicalAssetReference } from './content-source/media-manifest.mjs';

export class LocalizedContentValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'LocalizedContentValidationError'; this.code = code; }
}
const fail = (code, message) => { throw new LocalizedContentValidationError(code, message); };
const reservedInHtml = /\b(?:href|src)\s*=\s*(['"]?)\s*(?:content|asset):/i;

function visit(tokens, visitor) {
  for (const token of tokens ?? []) {
    visitor(token);
    for (const value of Object.values(token)) if (Array.isArray(value)) visit(value, visitor);
  }
}

function logicalTokens(content) {
  if (typeof content !== 'string') fail('BODY_INVALID', 'Localized content must be a string');
  const tokens = marked.lexer(content, { gfm: true, breaks: false });
  visit(tokens, (token) => {
    if (token.type === 'html' && reservedInHtml.test(token.raw)) {
      fail('LOGICAL_REFERENCE_NONCANONICAL', 'Reserved content:// and asset:// schemes must use Markdown links or images');
    }
  });
  return tokens;
}

// Pure validation shared by draft/publish callers. Context indexes are passed
// explicitly, avoiding hidden global caches and repeated store scans.
export function validateLocalizedBody({ content, imageAlts, locale, currentContentId = null, contentLinkIndex, mediaIndex, mode = 'draft' }) {
  if (!['ru', 'en'].includes(locale)) fail('LOCALE_UNSUPPORTED', 'Localized body validation supports ru and en');
  if (!contentLinkIndex?.knownContentIds || !mediaIndex?.assetsById) fail('VALIDATION_CONTEXT_INVALID', 'Logical reference indexes are required');
  const references = [];
  const tokens = logicalTokens(content);
  visit(tokens, (token) => {
    try {
      if (token.type === 'link') {
        const logical = parseLogicalContentReference(token.href);
        if (!logical) return;
        if (!contentLinkIndex.knownContentIds.has(logical.content_id)) fail('CONTENT_REFERENCE_MISSING', `Referenced content_id does not exist: ${logical.content_id}`);
        if (mode === 'publish' && logical.content_id === currentContentId) fail('CONTENT_REFERENCE_SELF', 'Published localized content cannot link to itself');
        references.push({ kind: 'content', content_id: logical.content_id });
      }
      if (token.type === 'image') {
        const logical = parseLogicalAssetReference(token.href, token.text);
        if (!logical) return;
        if (!resolveLogicalAssetReference(mediaIndex, logical.asset_id)) fail('ASSET_REFERENCE_MISSING', `Referenced asset_id does not exist: ${logical.asset_id}`);
        const alt = imageAltState(imageAlts, logical.asset_id);
        if (mode === 'publish' && !alt.supplied) fail('ASSET_ALT_MISSING', `Published asset requires image_alts[${logical.asset_id}]`);
        references.push({ kind: 'asset', asset_id: logical.asset_id });
      }
    } catch (error) {
      if (error instanceof LocalizedContentValidationError) throw error;
      fail('LOGICAL_REFERENCE_INVALID', error instanceof Error ? error.message : String(error));
    }
  });
  return Object.freeze({ tokens, references: Object.freeze(references) });
}

const allowedTags = ['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'article', 'header', 'aside', 'nav', 'cite', 'hr', 'pre', 'mark', 'img', 'code'];
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function sanitizeLocalizedHtml(html) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: { '*': ['class', 'id', 'role', 'aria-*'], a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'], blockquote: ['cite'], th: ['colspan', 'rowspan', 'scope', 'align'], td: ['colspan', 'rowspan', 'align'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'], allowedSchemesByTag: { img: ['http', 'https'] }, allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed'],
  });
}

export function renderLocalizedContent({ content, imageAlts, locale, currentContentId, contentLinkIndex, mediaIndex }) {
  const { tokens } = validateLocalizedBody({ content, imageAlts, locale, currentContentId, contentLinkIndex, mediaIndex, mode: 'publish' });
  const renderer = new marked.Renderer();
  const defaultLink = renderer.link;
  const defaultImage = renderer.image;
  renderer.link = function link(token) {
    const logical = parseLogicalContentReference(token.href);
    if (!logical) return defaultLink.call(this, token);
    const result = resolveLogicalContentReference(contentLinkIndex, logical.content_id, locale);
    const label = this.parser.parseInline(token.tokens);
    if (result.status === 'missing_content') fail('CONTENT_REFERENCE_MISSING', `Referenced content_id does not exist: ${logical.content_id}`);
    return result.path ? `<a href="${escape(result.path)}">${label}</a>` : label;
  };
  renderer.image = function image(token) {
    const logical = parseLogicalAssetReference(token.href, token.text);
    if (!logical) return defaultImage.call(this, token);
    const asset = resolveLogicalAssetReference(mediaIndex, logical.asset_id);
    if (!asset) fail('ASSET_REFERENCE_MISSING', `Referenced asset_id does not exist: ${logical.asset_id}`);
    const alt = imageAltState(imageAlts, logical.asset_id);
    if (!alt.supplied) fail('ASSET_ALT_MISSING', `Published asset requires image_alts[${logical.asset_id}]`);
    const dimensions = asset.width && asset.height ? ` width="${asset.width}" height="${asset.height}"` : '';
    return `<img src="${escape(asset.public_url)}" alt="${escape(alt.alt)}"${dimensions}>`;
  };
  const html = marked.parser(tokens, { renderer });
  const safe = sanitizeLocalizedHtml(html);
  if (/\b(?:content|asset):\/\//i.test(safe)) fail('LOGICAL_REFERENCE_LEAK', 'Custom logical schemes escaped rendering');
  return safe;
}
