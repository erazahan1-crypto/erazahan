// Одноразовая синхронизация Keystatic-папки src/data/posts/ с posts.json.
// - добавляет поле slug в существующие файлы;
// - создаёт файлы для постов, которых нет в папке.
// Запуск: node scripts/sync-keystatic.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dir = join(root, 'src', 'data', 'posts');
const posts = JSON.parse(readFileSync(join(root, 'src', 'data', 'posts.json'), 'utf8'));

const slugFromSourceUrl = (url) => {
  if (!url) return '';
  try {
    const clean = url.trim().replace(/\/+$/, '');
    return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1));
  } catch {
    return '';
  }
};

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const bySourceUrl = new Map();
const byTitle = new Map();
for (const f of files) {
  const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  bySourceUrl.set(data.sourceUrl, f);
  byTitle.set(data.title, f);
}

let created = 0;
let updated = 0;

for (const post of posts) {
  const slug = post.slug || slugFromSourceUrl(post.sourceUrl);
  const file = bySourceUrl.get(post.sourceUrl) || byTitle.get(post.title);

  if (file) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!data.slug) {
      data.slug = slug;
      writeFileSync(join(dir, file), JSON.stringify(data, null, 2) + '\n', 'utf8');
      updated++;
    }
  } else {
    const target = `${slug}.json`;
    writeFileSync(join(dir, target), JSON.stringify({ ...post, slug }, null, 2) + '\n', 'utf8');
    created++;
  }
}

console.log(`Готово. created=${created}, updatedSlug=${updated}`);
