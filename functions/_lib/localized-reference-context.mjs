import { createMediaManifestIndex } from '../../src/lib/content-source/media-manifest.mjs';
import referenceData from './localized-reference-data.cjs';

const { contentRegistry, mediaManifest } = referenceData;

// Both inputs are immutable repository data bundled with this writer build.
// Publication paths are deliberately not needed for authoring validation.
const knownContentIds = new Set(contentRegistry.entries.map((entry) => entry.content_id));
export const localizedAuthoringContext = Object.freeze({
  contentLinkIndex: Object.freeze({ knownContentIds, pathsByContentId: new Map() }),
  mediaIndex: createMediaManifestIndex(mediaManifest),
});
