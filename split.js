#!/usr/bin/env node
// split.js — разбивает монолитный src/data/posts.json на отдельные файлы в src/data/posts/
// Запуск: node split.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname; // split.js лежит в корне проекта
const SRC_FILE = path.join(ROOT, 'src', 'data', 'posts.json');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'posts');

// --- читаем исходный файл ---
let raw;
try {
  raw = fs.readFileSync(SRC_FILE, 'utf8');
} catch (err) {
  console.error(`Не удалось прочитать ${SRC_FILE}: ${err.message}`);
  process.exit(1);
}

let data = JSON.parse(raw);

// Если это объект (объект объектов или { posts: [...] }) — приводим к массиву
if (!Array.isArray(data)) {
  const values = Object.values(data);
  data = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
}

if (!Array.isArray(data) || data.length === 0) {
  console.error('В posts.json не найден массив постов.');
  process.exit(1);
}

// --- транслитерация армянского (для безопасных имён файлов) ---
const TRANSLIT = {
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't',
  ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh', ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz',
  ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch',
  պ: 'p', ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts',
  ւ: 'u', փ: 'p', ք: 'k', օ: 'o', ֆ: 'f', և: 'yev',
};

function transliterate(input) {
  // диграф «ու» → 'u' (после приведения к нижнему регистру)
  const s = String(input).toLowerCase().replace(/\u0578\u0582/g, 'u');
  return (
    s
      .split('')
      .map((ch) => TRANSLIT[ch] ?? ch)
      .join('')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
  );
}

function fileNameFor(post, index) {
  const slug = post && typeof post.slug === 'string' ? post.slug.trim() : '';
  if (slug) {
    // если slug уже безопасный — используем как есть
    const clean = slug.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
    if (clean) return clean;
    // slug содержит не-ascii символы — транслитерируем
    const translit = transliterate(slug);
    if (translit) return translit;
  }
  // нет slug — пробуем транслитерировать title, иначе порядковый индекс
  const title = post && typeof post.title === 'string' ? post.title.trim() : '';
  const translit = title ? transliterate(title) : '';
  return translit || `post-${index}`;
}

// --- создаём папку ---
fs.mkdirSync(OUT_DIR, { recursive: true });

const seen = new Set();
let created = 0;

for (let i = 0; i < data.length; i++) {
  const post = data[i];
  if (!post || typeof post !== 'object') continue;

  let base = fileNameFor(post, i + 1);
  if (!/\.json$/i.test(base)) base += '.json';

  // не перезаписываем файлы при дубликатах имён
  let name = base;
  let n = 2;
  while (seen.has(name)) {
    const stem = base.replace(/\.json$/i, '');
    name = `${stem}-${n}.json`;
    n++;
  }
  seen.add(name);

  try {
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(post, null, 2), 'utf8');
    created++;
  } catch (err) {
    console.warn(`Не удалось записать ${name}: ${err.message}`);
  }

  if ((i + 1) % 500 === 0 || i + 1 === data.length) {
    console.log(`Обработано ${i + 1}/${data.length}...`);
  }
}

console.log(`Готово: успешно создано ${created} JSON-файлов в ${OUT_DIR}`);