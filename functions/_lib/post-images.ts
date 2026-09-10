export const POST_IMAGE_ORIGIN = 'https://images.erazahan.info';
export const POST_IMAGE_PREFIX = 'posts/';
export const MAX_PROCESSED_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PENDING_IMAGES = 12;

export interface PostImagesBucket {
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
    size?: number;
  } | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      onlyIf?: { etagDoesNotMatch?: string };
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown | null>;
  delete(key: string): Promise<void>;
}

export interface ValidatedWebp {
  bytes: ArrayBuffer;
  width: number;
  height: number;
  size: number;
}

export class PostImageValidationError extends Error {}

const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const KEY_RE = /^posts\/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*(?:-[2-9]\d*)?\.webp$/u;
const IMAGE_TAG_RE = /<img\b[^>]*>/gi;

export function validateImageToken(token: string): string {
  if (!TOKEN_RE.test(token)) throw new PostImageValidationError('Некорректный идентификатор изображения.');
  return token;
}

export function validatePostImageKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('\\')) {
    throw new PostImageValidationError('Разрешены только WebP-объекты внутри posts/.');
  }
  return key;
}

export function postImageUrl(key: string): string {
  validatePostImageKey(key);
  return `${POST_IMAGE_ORIGIN}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function postImageKeyFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== POST_IMAGE_ORIGIN || url.search || url.hash) return null;
    const key = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
    return validatePostImageKey(key);
  } catch {
    return null;
  }
}

export function imageKeyCandidate(slug: string, number: number): string {
  if (!/^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u.test(slug) || slug.includes('..')) {
    throw new PostImageValidationError('Некорректный slug для имени изображения.');
  }
  if (!Number.isSafeInteger(number) || number < 1 || number > 100_000) {
    throw new PostImageValidationError('Некорректный номер изображения.');
  }
  return `${POST_IMAGE_PREFIX}${slug}${number === 1 ? '' : `-${number}`}.webp`;
}

export async function putWebpWithAvailableKey(
  bucket: PostImagesBucket,
  slug: string,
  image: ValidatedWebp,
): Promise<string> {
  for (let number = 1; number <= 100_000; number += 1) {
    const key = imageKeyCandidate(slug, number);
    if (await bucket.head(key)) continue;
    const result = await bucket.put(key, image.bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { width: String(image.width), height: String(image.height) },
    });
    if (result) return key;
  }
  throw new Error('Не удалось подобрать свободное имя изображения.');
}

export async function cleanupPostImageUploads(bucket: PostImagesBucket, keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await bucket.delete(validatePostImageKey(key));
    } catch (error) {
      console.error('R2 upload rollback failed', key, error);
    }
  }
}

export async function validateProcessedWebp(file: File): Promise<ValidatedWebp> {
  if (file.type.toLowerCase() !== 'image/webp') {
    throw new PostImageValidationError('После оптимизации ожидается файл WebP.');
  }
  if (!file.size || file.size > MAX_PROCESSED_IMAGE_BYTES) {
    throw new PostImageValidationError('Оптимизированное изображение должно быть не больше 2 MB.');
  }
  const bytes = await file.arrayBuffer();
  const dimensions = parseWebpDimensions(new Uint8Array(bytes));
  if (!dimensions) throw new PostImageValidationError('Файл не имеет корректной RIFF/WEBP сигнатуры или размеров.');
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 1600 || dimensions.height > 1600) {
    throw new PostImageValidationError('Размеры WebP некорректны или превышают 1600 px.');
  }
  return { bytes, size: file.size, ...dimensions };
}

export function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 25 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = uint32le(bytes, offset + 4);
    const data = offset + 8;
    if (data + size > bytes.length) return null;
    if (type === 'VP8X' && size >= 10) {
      return { width: 1 + uint24le(bytes, data + 4), height: 1 + uint24le(bytes, data + 7) };
    }
    if (type === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return {
        width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
        height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
      };
    }
    if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
      const bits = uint32le(bytes, data + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = data + size + (size % 2);
  }
  return null;
}

export function pendingTokensInContent(content: string): string[] {
  const tokens = new Set<string>();
  for (const tag of content.match(IMAGE_TAG_RE) || []) {
    const source = htmlAttribute(tag, 'src');
    if (!source?.startsWith('pending-image:')) continue;
    tokens.add(validateImageToken(source.slice('pending-image:'.length)));
  }
  return [...tokens];
}

export function replacePendingImages(
  content: string,
  uploaded: Map<string, { key: string; width: number; height: number }>,
): string {
  const used = new Set<string>();
  const output = content.replace(IMAGE_TAG_RE, (tag) => {
    const source = htmlAttribute(tag, 'src');
    if (!source?.startsWith('pending-image:')) return tag;
    const token = validateImageToken(source.slice('pending-image:'.length));
    const image = uploaded.get(token);
    if (!image) throw new PostImageValidationError('Для pending-изображения не передан WebP-файл.');
    const alt = decodeHtmlAttribute(htmlAttribute(tag, 'alt') || '').trim();
    validateAlt(alt);
    used.add(token);
    return buildPostImageMarkup(image.key, alt, image.width, image.height);
  });
  if ([...uploaded.keys()].some((token) => !used.has(token))) {
    throw new PostImageValidationError('Передан WebP-файл, который не используется в content.');
  }
  return output;
}

export function buildPostImageMarkup(key: string, alt: string, width: number, height: number): string {
  validatePostImageKey(key);
  validateAlt(alt);
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 1600)) {
    throw new PostImageValidationError('Некорректные размеры изображения.');
  }
  return `<img src="${escapeHtml(postImageUrl(key))}" alt="${escapeHtml(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async">`;
}

export function managedImageKeys(content: string): string[] {
  const keys = new Set<string>();
  for (const match of content.matchAll(/https:\/\/images\.erazahan\.info\/posts\/[\p{L}\p{N}%._~-]+\.webp/giu)) {
    const key = postImageKeyFromUrl(match[0]);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function contentReferencesImageKey(content: unknown, key: string): boolean {
  if (typeof content !== 'string') return false;
  return managedImageKeys(content).includes(validatePostImageKey(key));
}

export function validateManagedImageAlts(content: string): void {
  for (const tag of content.match(IMAGE_TAG_RE) || []) {
    const source = htmlAttribute(tag, 'src') || '';
    if (!postImageKeyFromUrl(source)) continue;
    validateAlt(decodeHtmlAttribute(htmlAttribute(tag, 'alt') || '').trim());
  }
}

export function validateDeleteKeys(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24) throw new PostImageValidationError('Некорректный список удаляемых изображений.');
  return [...new Set(value.map((key) => {
    if (typeof key !== 'string') throw new PostImageValidationError('Некорректный ключ изображения.');
    return validatePostImageKey(key);
  }))];
}

export function validateImageDeletionPlan(
  posts: Array<Record<string, unknown>>,
  currentIndex: number,
  currentContent: unknown,
  nextContent: string,
  keys: string[],
): void {
  for (const key of keys) {
    validatePostImageKey(key);
    if (!contentReferencesImageKey(currentContent, key)) {
      throw new PostImageValidationError('Удалять из R2 можно только изображение текущей статьи.');
    }
    if (contentReferencesImageKey(nextContent, key)) {
      throw new PostImageValidationError('Перед удалением из R2 уберите изображение из content.');
    }
    if (posts.some((post, index) => index !== currentIndex && contentReferencesImageKey(post.content, key))) {
      throw new PostImageValidationError('Изображение используется в другой статье и не может быть удалено.');
    }
  }
}

export function replacementKeysSafeToDelete(
  posts: Array<Record<string, unknown>>,
  currentIndex: number,
  keys: string[],
): { safe: string[]; shared: string[] } {
  const safe: string[] = [];
  const shared: string[] = [];
  for (const key of keys) {
    const usedElsewhere = posts.some((post, index) => index !== currentIndex && contentReferencesImageKey(post.content, key));
    (usedElsewhere ? shared : safe).push(key);
  }
  return { safe, shared };
}

function validateAlt(alt: string): void {
  if (!alt || alt.length > 300 || /[\u0000-\u001f\u007f]/.test(alt)) {
    throw new PostImageValidationError('ALT обязателен и должен быть обычным текстом до 300 символов.');
  }
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
