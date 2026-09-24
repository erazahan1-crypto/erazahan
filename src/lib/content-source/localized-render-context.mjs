import { buildPublishedContentLinkIndex } from './published-content.mjs';
import { createMediaManifestIndex } from './media-manifest.mjs';
import { CONTENT_STORE_ROOT } from './localized-dream-routes.mjs';
import { scanContentStore } from './multilingual-store.mjs';
import mediaManifest from '../../data/content/media-manifest.v1.json' with { type: 'json' };

let context = null;

// Static-route build context only. Astro starts a new module graph for each
// build, so this cannot survive a content deployment or serve a stale request.
export function loadLocalizedRenderContext() {
  if (context) return context;
  const repository = scanContentStore(CONTENT_STORE_ROOT);
  context = Object.freeze({
    repository,
    contentLinkIndex: buildPublishedContentLinkIndex(repository),
    mediaIndex: createMediaManifestIndex(mediaManifest),
  });
  return context;
}
