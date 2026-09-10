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
