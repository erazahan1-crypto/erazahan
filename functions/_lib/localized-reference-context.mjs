import contentRegistry from '../../src/data/migrations/content-id-registry.v1.json' with { type: 'json' };
import mediaManifest from '../../src/data/content/media-manifest.v1.json' with { type: 'json' };
import { createMediaManifestIndex } from '../../src/lib/content-source/media-manifest.mjs';

// Both inputs are immutable repository data bundled with this writer build.
// Publication paths are deliberately not needed for authoring validation.
const knownContentIds = new Set(contentRegistry.entries.map((entry) => entry.content_id));
export const localizedAuthoringContext = Object.freeze({
  contentLinkIndex: Object.freeze({ knownContentIds, pathsByContentId: new Map() }),
  mediaIndex: createMediaManifestIndex(mediaManifest),
});
