import { buildPublishedContentLinkIndex } from '../../../lib/content-source/published-content.mjs';
import { scanContentStore } from '../../../lib/content-source/multilingual-store.mjs';

export const prerender = true;

const index = buildPublishedContentLinkIndex(scanContentStore('src/data/content/dreams'));
const body = JSON.stringify({
  known_content_ids: [...index.knownContentIds].sort((left, right) => left.localeCompare(right, 'en')),
  paths: [...index.pathsByContentId].map(([contentId, localized]) => [contentId, Object.fromEntries(localized)]),
});

export function GET() {
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
