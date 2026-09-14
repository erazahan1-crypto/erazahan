import { scanContentStore } from '../../lib/content-source/multilingual-store.mjs';
import { listPublishedSearchEntries } from '../../lib/content-source/published-search.mjs';

export const prerender = true;

export function serializeSearchIndex(repository) {
  return JSON.stringify(listPublishedSearchEntries(repository, 'en'));
}

const body = serializeSearchIndex(scanContentStore('src/data/content/dreams'));

export function GET() {
  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  });
}
