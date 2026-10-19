import { postImageKeyFromUrl } from '../../../functions/_lib/post-images.ts';

const HTML_IMAGE_RE = /<img\b[^>]*>/giu;
const SRC_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/iu;
const MARKDOWN_IMAGE_RE = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+)(?:\s+["'][^"']*["'])?)\s*\)/gu;

function imageSourceFromHtml(tag) {
  const match = tag.match(SRC_RE);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function appendReference(references, seen, sourceUrl, syntax) {
  if (typeof sourceUrl !== 'string' || !sourceUrl || seen.has(sourceUrl)) return;
  seen.add(sourceUrl);
  references.push(Object.freeze({ source_url: sourceUrl, syntax, r2_key: postImageKeyFromUrl(sourceUrl) }));
}

// HY content is immutable source material. This extractor only observes its
// image destinations; it never attempts to normalize or rewrite the content.
export function extractHyImageReferences(content) {
  if (typeof content !== 'string') throw new TypeError('HY image discovery requires a string');
  const references = [];
  const seen = new Set();
  for (const tag of content.match(HTML_IMAGE_RE) ?? []) appendReference(references, seen, imageSourceFromHtml(tag), 'html');
  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) appendReference(references, seen, match[1] ?? match[2] ?? '', 'markdown');
  return Object.freeze(references);
}

export function projectHyImageReferences(content, mediaIndex) {
  if (!mediaIndex?.assetsById || !(mediaIndex.assetsById instanceof Map)) {
    throw new TypeError('HY image projection requires a validated media index');
  }
  const assetsByUrl = new Map();
  for (const asset of mediaIndex.assetsById.values()) assetsByUrl.set(asset.public_url, asset);
  return Object.freeze(extractHyImageReferences(content).map((reference) => {
    const asset = assetsByUrl.get(reference.source_url) ?? null;
    return Object.freeze({
      source_url: reference.source_url,
      syntax: reference.syntax,
      ownership: reference.r2_key ? 'owned_r2' : 'manual_review',
      asset_id: asset?.asset_id ?? null,
      public_url: asset?.public_url ?? null,
    });
  }));
}
