import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';

export const UUID_NAMESPACE_DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export const PROJECT_CONTENT_ID_NAMESPACE = 'ebb2a826-eae8-511a-af05-0acf27425d75';
export const LEGACY_SEED_PREFIX = 'legacy:v1:';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;

function uuidToBytes(uuid) {
  if (!UUID_RE.test(uuid)) throw new TypeError(`Invalid UUID namespace: ${uuid}`);
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function bytesToUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV5(name, namespace = PROJECT_CONTENT_ID_NAMESPACE) {
  if (typeof name !== 'string') throw new TypeError('UUIDv5 name must be a string');
  const digest = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  return bytesToUuid(digest);
}

export function validateLegacySourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Legacy sourceUrl must be a non-empty string');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Legacy sourceUrl must be an absolute URL');
  }

  if (url.protocol !== 'https:' || url.origin !== 'https://erazahan.info') {
    throw new TypeError('Legacy sourceUrl must use the https://erazahan.info origin');
  }
  if (url.username || url.password) throw new TypeError('Legacy sourceUrl must not contain credentials');
  if (url.search) throw new TypeError('Legacy sourceUrl must not contain a query');
  if (url.hash) throw new TypeError('Legacy sourceUrl must not contain a fragment');

  return value;
}

export function legacyIdentitySeed(sourceUrl) {
  validateLegacySourceUrl(sourceUrl);
  return `${LEGACY_SEED_PREFIX}${sourceUrl}`;
}

export function legacyContentId(sourceUrl) {
  return uuidV5(legacyIdentitySeed(sourceUrl));
}

export function uuidV7({ unixMs = Date.now(), random = cryptoRandomBytes(10) } = {}) {
  if (!Number.isSafeInteger(unixMs) || unixMs < 0 || unixMs > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError('UUIDv7 unixMs must be an integer in the unsigned 48-bit range');
  }
  const randomBuffer = Buffer.from(random);
  if (randomBuffer.length !== 10) throw new RangeError('UUIDv7 requires exactly 10 random bytes');

  const bytes = Buffer.alloc(16);
  let timestamp = BigInt(unixMs);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (randomBuffer[0] & 0x0f);
  bytes[7] = randomBuffer[1];
  bytes[8] = 0x80 | (randomBuffer[2] & 0x3f);
  randomBuffer.copy(bytes, 9, 3);
  return bytesToUuid(bytes);
}

export function isUuidVersion(value, version) {
  return UUID_RE.test(value) && Number.parseInt(value[14], 16) === version;
}
