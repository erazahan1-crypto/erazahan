// Аудит URL: старый erazahan.info (WordPress export) vs новый Astro-сайт (dist/).
// Ничего не редиректит и не меняет — только читает XML и dist, пишет audit/url-audit.csv и audit/url-audit-summary.md.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const xmlPath = join(root, 'data', 'erazahan.WordPress.2026-08-18.xml');
const distPath = join(root, 'dist');

// ---------- утилиты нормализации путей ----------
const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

// Приводим произвольный URL/путь к каноническому виду: /segment/segment/ (с завершающим слэшем), без query/hash, decoded.
function normalizePath(rawUrlOrPath) {
  let s = rawUrlOrPath.trim();
  // убрать протокол+хост
  s = s.replace(/^https?:\/\/(www\.)?erazahan\.info/i, '');
  s = s.replace(/^https?:\/\/(www\.)?erazahan\.pages\.dev/i, '');
  // убрать hash и query
  s = s.split('#')[0].split('?')[0];
  if (!s.startsWith('/')) s = '/' + s;
  s = safeDecode(s);
  if (s === '') s = '/';
  if (s !== '/' && !s.endsWith('/')) s += '/';
  // схлопнуть двойные слэши
  s = s.replace(/\/{2,}/g, '/');
  return s;
}

// ---------- 1) читаем старый сайт из WXR ----------
const xml = readFileSync(xmlPath, 'utf8');

const text = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
};
const cdata = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  return m ? m[1] : '';
};

const oldItems = []; // { link, path, postType, status, postName }
const itemBlocks = xml.split('<item>').slice(1);
for (const raw of itemBlocks) {
  const block = raw.split('</item>')[0];
  const link = text(block, 'link').trim();
  const postType = cdata(block, 'wp:post_type').trim();
  const status = cdata(block, 'wp:status').trim();
  const postName = cdata(block, 'wp:post_name').trim();
  if (!link) continue;
  if (!['post', 'page', 'attachment'].includes(postType)) continue; // nav_menu_item/wp_block/etc — не реальные URL
  oldItems.push({ link, path: normalizePath(link), postType, status, postName });
}

// Категории/теги (только для информации о наличии таксономических архивов на старом сайте)
const categoryNicenames = new Set();
const tagNicenames = new Set();
for (const m of xml.matchAll(/<category domain="([^"]+)"[^>]*nicename="([^"]+)"[^>]*>/g)) {
  const domain = m[1];
  const nice = safeDecode(m[2]);
  if (domain === 'category') categoryNicenames.add(nice);
  if (domain === 'post_tag') tagNicenames.add(nice);
}

// ---------- 2) читаем новый сайт из dist/ ----------
const newPaths = new Set();
const skipTop = new Set(['_astro', 'uploads', 'fonts', 'keystatic', 'api']);
const skipFiles = new Set(['404.html', 'index.html', 'robots.txt', 'sitemap.xml', 'search-index.json']);

function walk(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (base === '' && skipTop.has(e.name)) continue;
      const sub = join(dir, e.name);
      const rel = base + '/' + e.name;
      const indexHtml = join(sub, 'index.html');
      if (existsSync(indexHtml)) {
        newPaths.add(normalizePath(rel));
      }
      walk(sub, rel);
    } else if (base === '' && e.isFile()) {
      if (skipFiles.has(e.name)) continue; // технические файлы, не HTML-страницы
    }
  }
}
walk(distPath, '');
newPaths.add('/'); // главная (dist/index.html)
newPaths.add('/search/'); // search.astro, статическая страница (без getStaticPaths вложенности)

// ---------- 3) сопоставление old vs new ----------
const rows = [];
const missingByGroup = {};
const missingGroupCounts = {};
const addMissingExample = (group, row) => {
  missingGroupCounts[group] = (missingGroupCounts[group] || 0) + 1;
  missingByGroup[group] = missingByGroup[group] || [];
  if (missingByGroup[group].length < 30) missingByGroup[group].push(row);
};

const seenOldPaths = new Set();
for (const item of oldItems) {
  if (seenOldPaths.has(item.path)) continue; // дедуп (attachment lightbox anchors и т.п. после нормализации могут совпасть)
  seenOldPaths.add(item.path);

  const oldUrl = `https://erazahan.info${item.path}`;
  let matchType;
  let notes = '';
  let newPath = '';
  let newUrl = '';
  let newStatus = '';

  if (item.postType === 'attachment') {
    matchType = 'SPECIAL';
    notes = 'attachment (медиа-файл WordPress, отдельная страница-вложение)';
    newStatus = 'N/A';
  } else if (item.status !== 'publish') {
    matchType = 'SPECIAL';
    notes = `status=${item.status} (не публиковался публично)`;
    newStatus = 'N/A';
  } else if (newPaths.has(item.path)) {
    matchType = 'EXACT_MATCH';
    newPath = item.path;
    newUrl = `https://erazahan.info${newPath}`;
    newStatus = 'exists_in_dist';
  } else {
    matchType = 'MISSING';
    newStatus = 'not_found_in_dist';
    // группировка
    let group = 'other';
    if (item.postType === 'page') group = 'old_wordpress_pages';
    else group = 'changed_or_removed_post_slug';
    addMissingExample(group, { old_url: oldUrl, old_path: item.path, post_type: item.postType });
  }

  rows.push({
    old_url: oldUrl,
    old_path: item.path,
    old_status: item.status,
    new_url: newUrl,
    new_path: newPath,
    new_status: newStatus,
    match_type: matchType,
    notes,
  });
}

// Синтетические группы URL-типов, которых нет в XML как отдельных <item>, но которые реально существовали/могли существовать на старом сайте.
// Не гадаем про полное перечисление (бесконечная пагинация и т.п.) — фиксируем факт и по 1-2 представителя для CSV.
const syntheticGroups = [
  { path: '/page/2/', reason: 'pagination (архив/лента, WordPress генерирует автоматически)', group: 'pagination' },
  { path: '/feed/', reason: 'RSS feed', group: 'technical' },
  { path: '/wp-json/', reason: 'REST API', group: 'technical' },
  { path: '/wp-admin/', reason: 'админка WordPress', group: 'technical' },
  { path: '/wp-login.php', reason: 'вход в админку', group: 'technical' },
  { path: '/?s=test', reason: 'встроенный поиск WordPress (?s=)', group: 'technical' },
  { path: '/author/admin/', reason: 'архив автора', group: 'technical' },
];
for (const nice of categoryNicenames) {
  syntheticGroups.push({ path: `/cat/erazahan/${nice}/`, reason: 'архив категории (taxonomy, встречалось в меню сайта)', group: 'category_archive' });
}
for (const nice of tagNicenames) {
  syntheticGroups.push({ path: `/tag/${nice}/`, reason: 'архив тега (taxonomy)', group: 'tag_archive' });
}

for (const s of syntheticGroups) {
  const oldUrl = `https://erazahan.info${s.path}`;
  const isSpecialType = s.group === 'technical' || s.group === 'tag_archive';
  const matchType = isSpecialType ? 'SPECIAL' : 'MISSING';
  rows.push({
    old_url: oldUrl,
    old_path: s.path,
    old_status: 'inferred_not_in_xml',
    new_url: '',
    new_path: '',
    new_status: 'not_found_in_dist',
    match_type: matchType,
    notes: s.reason,
  });
  if (matchType === 'MISSING') addMissingExample(s.group, { old_url: oldUrl, old_path: s.path, post_type: s.group });
}

// ---------- 4) запись CSV ----------
const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csvHeader = ['old_url', 'old_path', 'old_status', 'new_url', 'new_path', 'new_status', 'match_type', 'notes'];
const csvLines = [csvHeader.join(',')];
for (const r of rows) {
  csvLines.push(csvHeader.map((h) => csvEscape(r[h])).join(','));
}
writeFileSync(join(__dirname, 'url-audit.csv'), csvLines.join('\n') + '\n', 'utf8');

// ---------- 5) сводка ----------
const counts = { EXACT_MATCH: 0, MISSING: 0, SPECIAL: 0 };
for (const r of rows) counts[r.match_type]++;

const newOnly = [...newPaths].filter((p) => !oldItems.some((i) => i.path === p));

let summary = `# URL Audit — erazahan.info (WordPress) vs новый Astro-сайт\n\n`;
summary += `Total old URLs (posts+pages+attachments, из WXR): ${oldItems.length}\n`;
summary += `Total old URLs (уникальные пути, после нормализации + синтетические тех. группы): ${rows.length}\n`;
summary += `Total new URLs (из dist/): ${newPaths.size}\n\n`;
summary += `Exact matches: ${counts.EXACT_MATCH}\n`;
summary += `Missing: ${counts.MISSING}\n`;
summary += `Special: ${counts.SPECIAL}\n`;
summary += `New-only URLs (есть в dist, отсутствуют в старом WXR как post/page): ${newOnly.length}\n\n`;

summary += `## Missing по группам\n\n`;
for (const [group, examples] of Object.entries(missingByGroup)) {
  summary += `### ${group} (показано до 30 примеров)\n\n`;
  for (const ex of examples) summary += `- ${ex.old_path}\n`;
  summary += `\n`;
}

summary += `## New-only (примеры, до 30)\n\n`;
for (const p of newOnly.slice(0, 30)) summary += `- ${p}\n`;

writeFileSync(join(__dirname, 'url-audit-summary.md'), summary, 'utf8');

console.log('OLD_ITEMS_TOTAL', oldItems.length);
console.log('ROWS_TOTAL', rows.length);
console.log('NEW_PATHS_TOTAL', newPaths.size);
console.log('COUNTS', JSON.stringify(counts));
console.log('NEW_ONLY_TOTAL', newOnly.length);
console.log('MISSING_GROUPS', missingGroupCounts);
