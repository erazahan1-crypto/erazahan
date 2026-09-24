import { scanContentStore } from '../../../lib/content-source/multilingual-store.mjs';
import { projectTranslationLinkIndex } from '../../../lib/content-source/translation-link-index.mjs';

export const prerender = true;

export function serializeTranslationLinkIndex(repository) {
  return JSON.stringify(projectTranslationLinkIndex(repository));
}

const body = serializeTranslationLinkIndex(scanContentStore('src/data/content/dreams'));

export function GET() {
  return new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
