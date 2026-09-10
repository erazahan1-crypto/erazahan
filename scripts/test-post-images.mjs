import assert from 'node:assert/strict';
import {
  buildPostImageMarkup,
  cleanupPostImageUploads,
  contentReferencesImageKey,
  imageKeyCandidate,
  managedImageKeys,
  parseWebpDimensions,
  pendingTokensInContent,
  postImageKeyFromUrl,
  putWebpWithAvailableKey,
  replacePendingImages,
  replacementKeysSafeToDelete,
  validatePostImageKey,
  validateManagedImageAlts,
  validateImageDeletionPlan,
  validateProcessedWebp,
} from '../functions/_lib/post-images.ts';
import {
  buildPendingImageMarkup,
  optimizePostImage,
  parseEditorImages,
  replaceEditorImage,
  updateEditorImageAlt,
} from '../src/lib/admin-post-images.ts';

const vp8x = webpFixture(1200, 800);
assert.deepEqual(parseWebpDimensions(vp8x), { width: 1200, height: 800 });
assert.equal(parseWebpDimensions(new Uint8Array([1, 2, 3])), null);
const validated = await validateProcessedWebp(new File([vp8x], 'image.webp', { type: 'image/webp' }));
assert.deepEqual({ width: validated.width, height: validated.height }, { width: 1200, height: 800 });
await assert.rejects(
  validateProcessedWebp(new File([vp8x], 'fake.png', { type: 'image/png' })),
  /WebP/,
);

assert.equal(imageKeyCandidate('erazahan-bad', 1), 'posts/erazahan-bad.webp');
assert.equal(imageKeyCandidate('erazahan-bad', 2), 'posts/erazahan-bad-2.webp');
for (const unsafe of ['../bad.webp', 'other/bad.webp', 'posts/../bad.webp', 'posts\\bad.webp']) {
  assert.throws(() => validatePostImageKey(unsafe));
}

const bucket = new MemoryBucket(['posts/erazahan-bad.webp']);
const collisionKey = await putWebpWithAvailableKey(bucket, 'erazahan-bad', validated);
assert.equal(collisionKey, 'posts/erazahan-bad-2.webp');
assert.ok(bucket.objects.has(collisionKey));

const token = 'abcDEF123456';
const pendingMarkup = buildPendingImageMarkup(token, 'Երազում "բադ" տեսնել', 1200, 800);
assert.match(pendingMarkup, /src="pending-image:abcDEF123456"/);
assert.match(pendingMarkup, /alt="Երազում &quot;բադ&quot; տեսնել"/);
assert.deepEqual(pendingTokensInContent(pendingMarkup), [token]);
assert.throws(() => buildPendingImageMarkup(token, ' ', 1200, 800), /ALT/);

const finalContent = replacePendingImages(pendingMarkup, new Map([
  [token, { key: collisionKey, width: 1200, height: 800 }],
]));
assert.equal(pendingTokensInContent(finalContent).length, 0);
assert.match(finalContent, /https:\/\/images\.erazahan\.info\/posts\/erazahan-bad-2\.webp/);
assert.match(finalContent, /width="1200" height="800" loading="lazy" decoding="async"/);
assert.deepEqual(managedImageKeys(finalContent), [collisionKey]);
assert.ok(contentReferencesImageKey(finalContent, collisionKey));
assert.doesNotThrow(() => validateManagedImageAlts(finalContent));
assert.throws(() => validateManagedImageAlts(finalContent.replace(/alt="[^"]*"/, 'alt=""')), /ALT/);
assert.equal(postImageKeyFromUrl('https://evil.example/posts/erazahan-bad.webp'), null);
assert.doesNotThrow(() => validateImageDeletionPlan([{ content: finalContent }], 0, finalContent, '', [collisionKey]));
assert.throws(
  () => validateImageDeletionPlan([{ content: finalContent }, { content: finalContent }], 0, finalContent, '', [collisionKey]),
  /другой статье/,
);
assert.throws(() => validateImageDeletionPlan([{ content: finalContent }], 0, finalContent, finalContent, [collisionKey]), /уберите/);
assert.deepEqual(
  replacementKeysSafeToDelete([{ content: finalContent }, { content: finalContent }], 0, [collisionKey]),
  { safe: [], shared: [collisionKey] },
);

const parsed = parseEditorImages(finalContent);
assert.equal(parsed.length, 1);
const altEdited = updateEditorImageAlt(finalContent, parsed[0], 'Նոր ALT');
assert.match(altEdited, /alt="Նոր ALT"/);
assert.match(altEdited, /erazahan-bad-2\.webp/);
assert.equal(replaceEditorImage(altEdited, parseEditorImages(altEdited)[0], ''), '');
const replacementPending = buildPendingImageMarkup('replacementToken123', 'Նոր ALT', 600, 400);
const replacementContent = replaceEditorImage(altEdited, parseEditorImages(altEdited)[0], replacementPending);
const replacementFinal = replacePendingImages(replacementContent, new Map([
  ['replacementToken123', { key: 'posts/erazahan-bad-3.webp', width: 600, height: 400 }],
]));
assert.doesNotMatch(replacementFinal, /erazahan-bad-2\.webp/);
assert.match(replacementFinal, /erazahan-bad-3\.webp/);

const safeMarkup = buildPostImageMarkup('posts/erazahan-bad.webp', 'Բադ', 1600, 1067);
assert.match(safeMarkup, /^<img src="https:\/\/images\.erazahan\.info\/posts\/erazahan-bad\.webp"/);

await assert.rejects(
  optimizePostImage(new File([new Uint8Array(10)], 'bad.svg', { type: 'image/svg+xml' })),
  /JPEG, PNG или WebP/,
);
await assert.rejects(
  optimizePostImage(new File([new Uint8Array(10)], 'bad.gif', { type: 'image/gif' })),
  /JPEG, PNG или WebP/,
);
await assert.rejects(
  optimizePostImage(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })),
  /10 MB/,
);

const rollbackBucket = new MemoryBucket(['posts/existing.webp', 'posts/rollback-test.webp']);
await cleanupPostImageUploads(rollbackBucket, ['posts/rollback-test.webp']);
assert.deepEqual(rollbackBucket.deleted, ['posts/rollback-test.webp']);
assert.deepEqual([...rollbackBucket.objects], ['posts/existing.webp']);

console.log('Post images: WebP validation, ALT, filenames, collision handling, replace/remove, rollback, references, and traversal protection OK');

function webpFixture(width, height) {
  const bytes = new Uint8Array(30);
  writeAscii(bytes, 0, 'RIFF');
  bytes[4] = 22;
  writeAscii(bytes, 8, 'WEBP');
  writeAscii(bytes, 12, 'VP8X');
  bytes[16] = 10;
  write24(bytes, 24, width - 1);
  write24(bytes, 27, height - 1);
  return bytes;
}

function writeAscii(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}

function write24(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
}

function MemoryBucket(existing = []) {
  this.objects = new Set(existing);
  this.deleted = [];
  this.head = async (key) => this.objects.has(key) ? {} : null;
  this.put = async (key) => {
    if (this.objects.has(key)) return null;
    this.objects.add(key);
    return {};
  };
  this.delete = async (key) => { this.deleted.push(key); this.objects.delete(key); };
}
