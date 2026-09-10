import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export type PostContentFormat = 'html' | 'markdown' | 'mixed' | 'plain';

const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;
const MARKDOWN_RE = /(?:^|\n)\s{0,3}(?:#{2,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+|```)|!?(?:\[[^\]\n]+\])\([^\s)]+(?:\s+["'][^"']*["'])?\)|(?:\*\*|__|(?<!\*)\*(?!\*))\S|`[^`\n]+`/m;

export function detectPostContentFormat(rawContent: string): PostContentFormat {
  const hasHtml = HTML_TAG_RE.test(rawContent);
  const hasMarkdown = MARKDOWN_RE.test(rawContent);
  if (hasHtml && hasMarkdown) return 'mixed';
  if (hasHtml) return 'html';
  if (hasMarkdown) return 'markdown';
  return 'plain';
}

const allowedTags = [
  // Tags found in the imported post dataset.
  'p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5',
  'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span', 'article', 'header', 'aside', 'nav', 'cite', 'hr', 'pre', 'mark',
  // Markdown output: images and inline code are explicitly supported.
  'img', 'code',
];

const externalLinkTransform: sanitizeHtml.Transformer = (tagName, attribs) => {
  const href = attribs.href || '';
  if (attribs.target === '_blank' && /^(?:https?:)?\/\//i.test(href)) {
    const rel = new Set((attribs.rel || '').split(/\s+/).filter(Boolean));
    rel.add('noopener');
    rel.add('noreferrer');
    return { tagName, attribs: { ...attribs, rel: [...rel].join(' ') } };
  }
  return { tagName, attribs };
};

/**
 * Renders legacy HTML, Markdown, or mixed HTML/Markdown into safe article HTML.
 * Raw HTML is parsed by marked and the complete result is then sanitized, so
 * embedded HTML cannot bypass the allowlist. The source string is not mutated.
 */
export function renderPostContent(rawContent: string): string {
  if (!rawContent.trim()) return '';

  const rendered = marked.parse(rawContent, {
    async: false,
    breaks: false,
    gfm: true,
  });

  return sanitizeHtml(rendered, {
    allowedTags,
    allowedAttributes: {
      '*': ['class', 'id', 'role', 'aria-*'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
      blockquote: ['cite'],
      th: ['colspan', 'rowspan', 'scope', 'align'],
      td: ['colspan', 'rowspan', 'align'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed'],
    transformTags: { a: externalLinkTransform },
  });
}

const TEXT_ONLY_BLOCK_RE = /<(blockquote|p|li|h[1-6]|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
const NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed'];

/**
 * Converts the same mixed Markdown/HTML accepted by the article renderer into
 * plain text for excerpts and search data. Images contribute no URL, markup,
 * or alt text. A punctuation-only block left behind by an image is discarded.
 */
export function plainTextFromPostContent(rawContent: string): string {
  if (!rawContent.trim()) return '';

  const rendered = renderPostContent(rawContent).replace(/<img\b[^>]*\/?\s*>/gi, ' ');
  const withoutImageOnlyBlocks = rendered.replace(
    TEXT_ONLY_BLOCK_RE,
    (block, _tag, inner) => /[\p{L}\p{N}]/u.test(htmlFragmentToPlainText(inner)) ? block : ' ',
  );

  return htmlFragmentToPlainText(withoutImageOnlyBlocks);
}

function htmlFragmentToPlainText(html: string): string {
  const encodedText = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: NON_TEXT_TAGS,
  });
  return decodeHtmlEntities(encodedText).replace(/\s+/gu, ' ').trim();
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '«',
  lt: '<',
  mdash: '—',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '»',
  shy: '',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z][\da-z]+));/gi, (entity, decimal, hex, named) => {
    if (decimal || hex) {
      const codePoint = Number.parseInt(decimal || hex, decimal ? 10 : 16);
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return entity;
    }
    return NAMED_HTML_ENTITIES[String(named).toLowerCase()] ?? entity;
  });
}
