// Одноразовый импорт WordPress WXR (erazahan.info) в JSON-данные сайта.
// Запуск: node scripts/import-xml.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const xmlPath = join(root, 'data', 'erazahan.WordPress.2026-08-18.xml');
const outDir = join(root, 'src', 'data');

const xml = readFileSync(xmlPath, 'utf8');

// ---------- вспомогательные ----------
const cdata = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  return m ? m[1] : '';
};
const text = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
};
const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

function categoriesOf(item, domain) {
  const out = [];
  const re = /<category\b[^>]*>([\s\S]*?)<\/category>/g;
  let m;
  while ((m = re.exec(item))) {
    const d = (m[0].match(/domain="([^"]*)"/) || [])[1] || '';
    if (d !== domain) continue;
    const c = m[1].match(/<!\[CDATA\[([\s\S]*?)\]\]>/) || [];
    out.push((c[1] ?? m[1]).trim());
  }
  return out;
}

const letterFromCategories = (names) => {
  for (const n of names) {
    const m = n.match(/սկսող\s+(.+?)\s+տառով/);
    if (m) return m[1].trim();
  }
  return null;
};

function parseComments(item) {
  const out = [];
  let start = 0;
  while (true) {
    const s = item.indexOf('<wp:comment>', start);
    if (s === -1) break;
    const e = item.indexOf('</wp:comment>', s);
    if (e === -1) break;
    const c = item.slice(s + 12, e);
    out.push({
      id: text(c, 'wp:comment_id'),
      author: cdata(c, 'wp:comment_author'),
      date: (cdata(c, 'wp:comment_date') || '').slice(0, 10),
      content: cdata(c, 'wp:comment_content'),
      parent: text(c, 'wp:comment_parent'),
    });
    start = e + 14;
  }
  return out;
}

function parseWordList(html) {
  const cards = [];
  const re = /<a\b[^>]*>[\s\S]*?<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/class="[^"]*word-grid-card"/.test(tag)) continue;
    const href = (tag.match(/href="([^"]*)"/) || [])[1] || '';
    const slug = (href.match(/erazahan\.info\/([^\/\s"]+)/) || [])[1] || '';
    const inner = tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
    const wt = (inner.match(/class="word-text"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
    const wtr = (inner.match(/class="word-translit"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
    cards.push({ slug: safeDecode(slug), wordText: wt.trim(), wordTranslit: wtr.trim() });
  }
  return cards;
}

const metaValue = (item, key) => {
  const m = item.match(new RegExp(
    `<wp:meta_key><!\\[CDATA\\[${key}\\]\\]></wp:meta_key>\\s*<wp:meta_value><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></wp:meta_value>`
  ));
  return m ? m[1] : '';
};

// ---------- очистка контента ----------
const isInternalUrl = (href) => {
  if (!href) return true;
  const h = href.trim().toLowerCase();
  if (h === '' || h === '#') return true;
  if (/^https?:\/\/(www\.)?erazahan\.info/.test(h)) return true;
  if (/^https?:\/\/localhost/.test(h)) return true;
  if (h.startsWith('/')) return true;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(h)) return true;
  return false;
};

const uploadFile = (url) => {
  const idx = url.indexOf('/wp-content/uploads/');
  if (idx === -1) return null;
  let p = url.slice(idx + '/wp-content/uploads/'.length).split(/[?#]/)[0];
  p = safeDecode(p).replace(/\.\./g, '');
  return p;
};

function cleanContent(html, mode = 'strip') {
  let h = html || '';
  h = h.replace(/<!--[\s\S]*?-->/g, '');
  if (mode === 'rewrite') {
    // для страниц: переписываем внутренние ссылки на локальные адреса (ссылки сохраняются)
    h = h.replace(
      /<a\b[^>]*href="(https?:\/\/(?:www\.)?erazahan\.info\/([^"#\s]*))"[^>]*>([\s\S]*?)<\/a>/gi,
      (m, _fullUrl, path, inner) => {
        if (path.startsWith('wp-content/')) return m;
        const slug = safeDecode(path.replace(/\/$/, ''));
        return `<a href="/${slug}/">${inner}</a>`;
      }
    );
  } else {
    // для постов: снимаем только внутренние ссылки (текст ссылки остаётся)
    h = h.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (m) => {
      const href = (m.match(/href=["']([^"']*)["']/i) || [])[1] || '';
      if (isInternalUrl(href)) return m.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
      return m;
    });
  }
  h = h.replace(/\s*style="[^"]*"/gi, '');
  h = h.replace(/<(p|div|span|h[1-6]|li|b|strong|em|i|u|font)\b[^>]*>\s*<\/\1>/gi, '');
  // переписываем картинки на локальные пути
  h = h.replace(/(src=")(https?:\/\/[^"]*\/wp-content\/uploads\/[^"]*)(")/gi, (m, pre, url, post) => {
    const f = uploadFile(url);
    return f ? pre + '/uploads/' + f + post : m;
  });
  return h.trim();
}

// ---------- разбор элементов ----------
const items = [];
{
  let start = 0;
  while (true) {
    const s = xml.indexOf('<item>', start);
    if (s === -1) break;
    const e = xml.indexOf('</item>', s);
    if (e === -1) break;
    items.push(xml.slice(s + 6, e));
    start = e + 7;
  }
}

const posts = [];
const pages = [];
const attachments = [];
const menuRaw = [];
const imageUrls = new Set();
const idToSlug = new Map();
const idToTitle = new Map();

const collectImages = (html) => {
  const re = /(?:src|href)="(https?:\/\/[^"]*\/wp-content\/uploads\/[^"]*)"/g;
  let m;
  while ((m = re.exec(html))) imageUrls.add(m[1]);
};

for (const item of items) {
  const type = cdata(item, 'wp:post_type');
  const status = cdata(item, 'wp:status');

  if (type === 'attachment') {
    const url = cdata(item, 'wp:attachment_url');
    if (/^https?:\/\/(www\.)?erazahan\.info/.test(url)) attachments.push(url);
    continue;
  }
  if (status !== 'publish') continue;

  const postId = text(item, 'wp:post_id');
  const title = cdata(item, 'title');
  const rawSlug = cdata(item, 'wp:post_name');
  const slug = safeDecode(rawSlug) || `id-${postId}`;
  const link = text(item, 'link');
  const date = (cdata(item, 'wp:post_date') || '').slice(0, 10);

  if (type === 'post') {
    const raw = cdata(item, 'content:encoded');
    collectImages(raw);
    const cats = categoriesOf(item, 'category');
    const letter = letterFromCategories(cats);
    const content = cleanContent(raw);
    const comments = parseComments(item).filter((c) => c.content);
    posts.push({ slug, title, date, letter, categories: cats, content, sourceUrl: link, comments });
    idToSlug.set(postId, slug);
    idToTitle.set(postId, title);
  } else if (type === 'page') {
    const raw = cdata(item, 'content:encoded');
    collectImages(raw);
    const content = cleanContent(raw, 'rewrite');
    const bigLetter = (raw.match(/class="big-main-letter"[^>]*>\s*([^<]+)</) || [])[1] || null;
    const wordList = bigLetter ? parseWordList(raw) : [];
    const comments = parseComments(item).filter((c) => c.content);
    pages.push({
      slug,
      id: postId,
      title,
      date,
      parent: text(item, 'wp:post_parent'),
      sourceUrl: link,
      content,
      letter: bigLetter,
      wordList,
      kind: bigLetter ? 'letter' : 'page',
      isFront: link === 'https://erazahan.info/',
      comments,
    });
    idToSlug.set(postId, slug);
    idToTitle.set(postId, title);
  } else if (type === 'nav_menu_item') {
    menuRaw.push(item);
  }
}

// ---------- пути страниц (вложенность) ----------
const idToPageSlug = new Map(pages.map((p) => [p.id, p.slug]));
for (const p of pages) {
  if (p.parent && p.parent !== '0') {
    const ps = idToPageSlug.get(p.parent);
    p.path = ps ? `${ps}/${p.slug}` : p.slug;
  } else {
    p.path = p.slug;
  }
}

// ---------- сопоставление по названию (для custom-пунктов меню) ----------
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function titleMatchScore(label, title) {
  const l = norm(label);
  const t = norm(title);
  if (!l || !t) return 0;
  if (l === t) return 100;
  if (t.includes(l) || l.includes(t)) return 80;
  const lw = l.split(' ');
  const tw = t.split(' ');
  let shared = 0;
  let prefix = 0;
  const l0 = lw[0] || '';
  for (const w of tw) {
    if (lw.includes(w)) shared++;
    if (l0 && w !== l0) {
      let k = 0;
      while (k < l0.length && k < w.length && l0[k] === w[k]) k++;
      if (k >= 2) prefix = Math.max(prefix, k);
    }
  }
  return shared * 20 + prefix;
}

function matchPageByLabel(label) {
  let best = null;
  let bestScore = 0;
  for (const p of pages) {
    const s = titleMatchScore(label, p.title);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return bestScore >= 20 ? best : null;
}

// ---------- меню ----------
const menu = [];
for (const item of menuRaw) {
  const type = metaValue(item, '_menu_item_type');
  const objectId = metaValue(item, '_menu_item_object_id');
  const url = metaValue(item, '_menu_item_url');
  const order = parseInt(text(item, 'wp:menu_order') || '0', 10);
  const parent = metaValue(item, '_menu_item_menu_item_parent') || '0';
  let label = cdata(item, 'title');
  let href = '';
  if (type === 'post_type' && objectId) {
    if (!label) label = idToTitle.get(objectId) || '';
    const slug = idToSlug.get(objectId) || '';
    href = slug ? `/${slug}/` : '';
  } else if (url) {
    const path = (url.match(/erazahan\.info\/([^\s"]*)/) || [])[1] || '';
    const decPath = safeDecode(path.replace(/\/$/, ''));
    // 1) сначала ищем страницу по слагу/пути
    const direct = pages.find((p) => p.slug === decPath || p.path === decPath);
    if (direct) {
      href = `/${direct.path}/`;
    } else if (label) {
      // 2) иначе — по названию страницы
      const byTitle = matchPageByLabel(label);
      href = byTitle ? `/${byTitle.path}/` : decPath ? `/${decPath}/` : '';
    } else {
      href = decPath ? `/${decPath}/` : '';
    }
  }
  if (label) menu.push({ label, href, parent, order });
}
menu.sort((a, b) => a.order - b.order);

// ---------- изображения ----------
const allImageUrls = new Set([...attachments, ...imageUrls]);
const images = [...allImageUrls].map((url) => ({ url, file: uploadFile(url) })).filter((x) => x.file);

// ---------- запись JSON ----------
mkdirSync(outDir, { recursive: true });
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(outDir, 'posts.json'), JSON.stringify(posts));
writeFileSync(join(outDir, 'pages.json'), JSON.stringify(pages));
writeFileSync(join(outDir, 'menu.json'), JSON.stringify(menu));
writeFileSync(join(outDir, 'images.json'), JSON.stringify(images));

const stripHtml = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const searchIndex = posts.map((p) => ({
  slug: p.slug,
  title: p.title,
  letter: p.letter,
  text: stripHtml(p.content).slice(0, 220),
}));
writeFileSync(join(root, 'public', 'search-index.json'), JSON.stringify(searchIndex));

// ---------- сводка ----------
console.log('posts (все публикации):', posts.length);
console.log('  из них с буквенной категорией (сны):', posts.filter((p) => p.letter).length);
console.log('pages:', pages.length);
console.log('  letter pages:', pages.filter((p) => p.kind === 'letter').length);
console.log('attachments:', attachments.length);
console.log('unique images:', images.length);
console.log('menu items:', menu.length);
console.log('comments на постах:', posts.reduce((a, p) => a + p.comments.length, 0));
console.log('comments на страницах:', pages.reduce((a, p) => a + p.comments.length, 0));
console.log('Готово. Файлы записаны в src/data/ и public/search-index.json');
