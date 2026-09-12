import { createHash } from 'node:crypto';

export const FINGERPRINT_SPEC_VERSION = 1;
export const FINGERPRINT_ALGORITHM = 'sha256';

function requireFingerprintField(condition, message) {
  if (!condition) throw new TypeError(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function fingerprintMaterialV1(payload) {
  requireFingerprintField(payload && typeof payload === 'object' && !Array.isArray(payload), 'Fingerprint payload must be an object');
  requireFingerprintField(typeof payload.title === 'string', 'Fingerprint title must be a string');
  requireFingerprintField(payload.description === null || typeof payload.description === 'string', 'Fingerprint description must be a string or null');
  requireFingerprintField(typeof payload.content === 'string', 'Fingerprint content must be a string');
  requireFingerprintField(Array.isArray(payload.tags) && payload.tags.every((tag) => typeof tag === 'string'), 'Fingerprint tags must be strings');
  requireFingerprintField(payload.image_alts && typeof payload.image_alts === 'object' && !Array.isArray(payload.image_alts), 'Fingerprint image_alts must be an object');
  requireFingerprintField(Object.values(payload.image_alts).every((alt) => typeof alt === 'string'), 'Fingerprint image alt values must be strings');

  return {
    title: payload.title,
    description: payload.description,
    content: payload.content,
    image_alts: payload.image_alts,
    tags: [...payload.tags].sort(),
  };
}

export function canonicalFingerprintSerializationV1(payload) {
  return JSON.stringify(canonicalize(fingerprintMaterialV1(payload)));
}

export function sourceFingerprintV1(payload) {
  return createHash('sha256')
    .update(Buffer.from(canonicalFingerprintSerializationV1(payload), 'utf8'))
    .digest('hex');
}
