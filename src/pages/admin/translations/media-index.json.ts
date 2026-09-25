import mediaManifest from '../../../data/content/media-manifest.v1.json' with { type: 'json' };
import { projectTranslationMediaIndex } from '../../../lib/content-source/translation-media-index.mjs';

export const prerender = true;

// Evaluated during the static build only; GET serves the already-built JSON.
const body = JSON.stringify(projectTranslationMediaIndex(mediaManifest));

export function GET() {
  return new Response(body, {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
