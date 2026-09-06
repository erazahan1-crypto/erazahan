// Restores WordPress featured-image associations for dream posts under the Armenian letter A.
// Run: node scripts/sync-a-post-covers.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const xml = readFileSync(join(root, 'data', 'erazahan.WordPress.2026-08-18.xml'), 'utf8');
const postsDir = join(root, 'src', 'data', 'posts');
const uploadsDir = join(root, 'public', 'uploads');

const cdata = (block, tag) => {
  const match = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  return match ? match[1] : '';
};

const text = (block, tag) => {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1] : '';
};

const metaValue = (block, key) => {
  const match = block.match(new RegExp(
    `<wp:meta_key><!\\[CDATA\\[${key}\\]\\]></wp:meta_key>\\s*<wp:meta_value><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></wp:meta_value>`
  ));
  return match ? match[1] : '';
};

const categoriesOf = (block) => {
  const categories = [];
  const regex = /<category\b[^>]*>([\s\S]*?)<\/category>/g;
  let match;
  while ((match = regex.exec(block))) {
    const value = match[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    categories.push((value?.[1] ?? match[1]).trim());
  }
  return categories;
};

const items = [];
for (let start = 0; ; ) {
  const itemStart = xml.indexOf('<item>', start);
  if (itemStart === -1) break;
  const itemEnd = xml.indexOf('</item>', itemStart);
  if (itemEnd === -1) break;
  items.push(xml.slice(itemStart + 6, itemEnd));
  start = itemEnd + 7;
}

const attachmentUrlById = new Map();
for (const item of items) {
  if (cdata(item, 'wp:post_type') !== 'attachment') continue;
  const id = text(item, 'wp:post_id');
  const url = cdata(item, 'wp:attachment_url');
  if (id && url) attachmentUrlById.set(id, url);
}

const localPostBySourceUrl = new Map();
for (const file of readdirSync(postsDir).filter((name) => name.endsWith('.json'))) {
  const path = join(postsDir, file);
  const post = JSON.parse(readFileSync(path, 'utf8'));
  if (post.sourceUrl) localPostBySourceUrl.set(post.sourceUrl, { path, post });
}

let matched = 0;
let updated = 0;
let missingFile = 0;
const sourceUrlsInASection = new Set();
for (const item of items) {
  if (cdata(item, 'wp:post_type') !== 'post') continue;
  const categories = categoriesOf(item);
  if (!categories.some((category) => /սկսող\s+Ա\s+տառով/.test(category))) continue;

  const sourceUrl = text(item, 'link');
  sourceUrlsInASection.add(sourceUrl);
  const local = localPostBySourceUrl.get(sourceUrl);
  const thumbnailId = metaValue(item, '_thumbnail_id');
  const imageUrl = attachmentUrlById.get(thumbnailId);
  if (!local || !imageUrl) continue;

  matched++;
  const file = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '');
  if (!file || !existsSync(join(uploadsDir, file))) {
    missingFile++;
    continue;
  }

  const cover = `/uploads/${file}`;
  if (local.post.cover === cover) continue;
  local.post.cover = cover;
  writeFileSync(local.path, `${JSON.stringify(local.post, null, 2)}\n`, 'utf8');
  updated++;
}

const unresolved = [...localPostBySourceUrl.entries()]
  .filter(([sourceUrl, { post }]) => {
    if (!sourceUrlsInASection.has(sourceUrl) || post.cover) return false;
    return !existsSync(join(uploadsDir, `${post.slug}.webp`)) &&
      !existsSync(join(uploadsDir, `${post.slug}-1.webp`));
  })
  .map(([, local]) => local);

const fetchOriginalCover = async (post) => {
  try {
    const response = await fetch(post.sourceUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; ErazahanMigration/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
};

const originalCoverResults = await Promise.all(unresolved.map(async (local) => {
  const imageUrl = await fetchOriginalCover(local.post);
  if (!imageUrl || !/\/wp-content\/uploads\//i.test(imageUrl)) {
    return { slug: local.post.slug, status: 'no WordPress og:image' };
  }
  const file = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '');
  if (!file || !existsSync(join(uploadsDir, file))) {
    return { slug: local.post.slug, status: `missing local file: ${file || imageUrl}` };
  }
  local.post.cover = `/uploads/${file}`;
  writeFileSync(local.path, `${JSON.stringify(local.post, null, 2)}\n`, 'utf8');
  return { slug: local.post.slug, status: `restored: ${file}` };
}));

console.log(`A posts with WordPress featured images: ${matched}`);
console.log(`Cover fields updated from WordPress XML: ${updated}`);
console.log(`Featured image files not available locally: ${missingFile}`);
console.log(`A posts without a local cover candidate: ${unresolved.length}`);
console.log(`Cover fields updated from original pages: ${originalCoverResults.filter((result) => result.status.startsWith('restored:')).length}`);
for (const result of originalCoverResults) console.log(`${result.slug}: ${result.status}`);