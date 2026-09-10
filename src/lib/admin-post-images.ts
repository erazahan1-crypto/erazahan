export const POST_IMAGE_ORIGIN = 'https://images.erazahan.info';
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PROCESSED_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 1600;

export interface OptimizedImage {
  blob: Blob;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
  originalSize: number;
  size: number;
}

export interface EditorImage {
  source: string;
  key: string | null;
  token: string | null;
  alt: string;
  width: number;
  height: number;
  tag: string;
}

export interface EditorImageInsertion {
  content: string;
  cursor: number;
}

const INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function optimizePostImage(file: File): Promise<OptimizedImage> {
  if (!INPUT_TYPES.has(file.type.toLowerCase())) throw new Error('Выберите JPEG, PNG или WebP.');
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('Исходный файл должен быть не больше 10 MB.');

  const decoded = await decodeImage(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('Браузер не смог подготовить Canvas.');
    context.drawImage(decoded.source, 0, 0, width, height);

    const candidates: Blob[] = [];
    for (const quality of [0.82, 0.75, 0.68]) {
      const blob = await canvasToWebp(canvas, quality);
      candidates.push(blob);
      if (blob.size <= file.size) break;
    }
    const blob = candidates.reduce((smallest, candidate) => candidate.size < smallest.size ? candidate : smallest);
    if (blob.size > MAX_PROCESSED_IMAGE_BYTES) throw new Error('После оптимизации WebP больше 2 MB. Выберите другое изображение.');
    return {
      blob,
      originalWidth: decoded.width,
      originalHeight: decoded.height,
      width,
      height,
      originalSize: file.size,
      size: blob.size,
    };
  } finally {
    decoded.close();
  }
}

export function createPendingImageToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export function buildPendingImageMarkup(token: string, alt: string, width: number, height: number): string {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) throw new Error('Некорректный image token.');
  const normalizedAlt = validateAlt(alt);
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_IMAGE_SIDE)) {
    throw new Error('Некорректные размеры изображения.');
  }
  return `<img src="pending-image:${token}" alt="${escapeHtml(normalizedAlt)}" width="${width}" height="${height}" loading="lazy" decoding="async">`;
}

export function insertEditorImageBlock(
  content: string,
  markup: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): EditorImageInsertion {
  const start = clampOffset(selectionStart, content.length);
  const end = clampOffset(selectionEnd, content.length);
  const selectionFrom = Math.min(start, end);
  const selectionTo = Math.max(start, end);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const anchor = selectionTo > selectionFrom ? selectionTo : selectionFrom;
  const lineStart = content.lastIndexOf('\n', Math.max(0, anchor - 1)) + 1;
  const lineEnd = nextLineEnd(content, anchor);
  const line = content.slice(lineStart, lineEnd).replace(/\r$/, '');

  let insertionAt: number;
  if (!line.trim()) {
    insertionAt = lineStart;
  } else if (selectionTo === selectionFrom && anchor === lineStart) {
    insertionAt = lineStart;
  } else {
    insertionAt = paragraphEnd(content, lineEnd);
  }

  const before = content.slice(0, insertionAt);
  const after = content.slice(insertionAt);
  const leftSeparator = before ? newline.repeat(Math.max(0, 2 - trailingNewlines(before))) : '';
  const rightSeparator = after ? newline.repeat(Math.max(0, 2 - leadingNewlines(after))) : '';
  const inserted = before + leftSeparator + markup + rightSeparator + after;

  return {
    content: inserted,
    cursor: before.length + leftSeparator.length + markup.length,
  };
}

export function parseEditorImages(content: string): EditorImage[] {
  const images: EditorImage[] = [];
  for (const match of content.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const source = htmlAttribute(tag, 'src') || '';
    const tokenMatch = source.match(/^pending-image:([A-Za-z0-9_-]{8,80})$/);
    const key = postImageKeyFromUrl(source);
    if (!tokenMatch && !key) continue;
    images.push({
      source,
      key,
      token: tokenMatch?.[1] || null,
      alt: decodeHtml(htmlAttribute(tag, 'alt') || ''),
      width: positiveInteger(htmlAttribute(tag, 'width')),
      height: positiveInteger(htmlAttribute(tag, 'height')),
      tag,
    });
  }
  return images;
}

export function replaceEditorImage(content: string, image: EditorImage, replacement: string): string {
  const index = content.indexOf(image.tag);
  if (index < 0) throw new Error('Разметка изображения уже изменилась. Обновите список.');
  return content.slice(0, index) + replacement + content.slice(index + image.tag.length);
}

export function updateEditorImageAlt(content: string, image: EditorImage, alt: string): string {
  const normalizedAlt = validateAlt(alt);
  const replacement = image.tag.match(/\salt\s*=/i)
    ? image.tag.replace(/\salt\s*=\s*(?:"[^"]*"|'[^']*')/i, ` alt="${escapeHtml(normalizedAlt)}"`)
    : image.tag.replace(/\s*\/?\s*>$/, ` alt="${escapeHtml(normalizedAlt)}">`);
  return replaceEditorImage(content, image, replacement);
}

export function postImageKeyFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== POST_IMAGE_ORIGIN || url.search || url.hash) return null;
    const key = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
    return /^posts\/[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*(?:-[2-9]\d*)?\.webp$/u.test(key) ? key : null;
  } catch {
    return null;
  }
}

export function formatImageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateAlt(value: string): string {
  const alt = value.trim();
  if (!alt || alt.length > 300 || /[\u0000-\u001f\u007f]/.test(alt)) {
    throw new Error('ALT обязателен и должен быть обычным текстом до 300 символов.');
  }
  return alt;
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob || blob.type !== 'image/webp') reject(new Error('Браузер не поддерживает WebP encoding.'));
    else resolve(blob);
  }, 'image/webp', quality));
}

function htmlAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : null;
}

function positiveInteger(value: string | null): number {
  return value && /^\d+$/.test(value) ? Number(value) : 0;
}

function clampOffset(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(length, Math.trunc(value)));
}

function nextLineEnd(content: string, offset: number): number {
  const end = content.indexOf('\n', offset);
  return end < 0 ? content.length : end;
}

function paragraphEnd(content: string, firstLineEnd: number): number {
  let end = firstLineEnd;
  while (end < content.length) {
    const nextStart = end + 1;
    const nextEnd = nextLineEnd(content, nextStart);
    if (!content.slice(nextStart, nextEnd).replace(/\r$/, '').trim()) break;
    end = nextEnd;
  }
  return end;
}

function trailingNewlines(value: string): number {
  const match = value.match(/(?:\r?\n)+$/);
  return match ? (match[0].match(/\n/g) || []).length : 0;
}

function leadingNewlines(value: string): number {
  const match = value.match(/^(?:\r?\n)+/);
  return match ? (match[0].match(/\n/g) || []).length : 0;
}

function decodeHtml(value: string): string {
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
