import postsJson from '../data/posts.json';
import pagesJson from '../data/pages.json';
import menuJson from '../data/menu.json';
import imagesJson from '../data/images.json';
import fs from 'node:fs';
import path from 'node:path';

export interface Comment {
  id: string;
  author: string;
  date: string;
  content: string;
  parent: string;
}

export interface Post {
  slug: string;
  title: string;
  description?: string | null;
  date: string;
  letter: string | null;
  categories: string[];
  content: string;
  sourceUrl: string;
  comments: Comment[];
  cover?: string | null;
}

export interface WordCard {
  slug: string;
  wordText: string;
  wordTranslit: string;
}

export interface Page {
  slug: string;
  id: string;
  title: string;
  date: string;
  parent: string;
  path: string;
  sourceUrl: string;
  content: string;
  letter: string | null;
  wordList: WordCard[];
  kind: 'letter' | 'page';
  isFront: boolean;
  comments: Comment[];
}

// Посты загружаем из папки, которой управляет Keystatic (src/data/posts/*.json).
// import.meta.glob заставляет Vite следить за файлами — правки видны без перезапуска dev-сервера.
const postModules = import.meta.glob('../data/posts/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;

const slugFromSourceUrl = (url?: string): string => {
  if (!url) return '';
  try {
    const clean = url.trim().replace(/\/+$/, '');
    return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1));
  } catch {
    return '';
  }
};

const slugFromFile = (file: string): string =>
  (file.split('/').pop() || '').replace(/\.json$/, '');

const loadPostsFromFolder = (): Post[] =>
  Object.entries(postModules).map(([file, mod]) => {
    const d = mod.default as Partial<Post>;
    return {
      slug: String(d.slug || slugFromSourceUrl(d.sourceUrl) || slugFromFile(file)),
      title: String(d.title ?? ''),
      description: typeof d.description === 'string' ? d.description : null,
      date: String(d.date ?? ''),
      letter: d.letter ?? null,
      categories: Array.isArray(d.categories) ? d.categories : [],
      content: String(d.content ?? ''),
      sourceUrl: String(d.sourceUrl ?? ''),
      comments: Array.isArray(d.comments) ? d.comments : [],
      cover: typeof d.cover === 'string' ? d.cover : null,
    } as Post;
  });

const folderPosts = loadPostsFromFolder();
export const posts: Post[] = folderPosts.length > 0 ? folderPosts : (postsJson as Post[]);
export const pages = pagesJson as Page[];
export const menu = menuJson as { label: string; href: string; parent: string; order: number }[];

// Армянский алфавит в порядке, как на erazahan.info (38 знаков, включая Ու)
export const ALPHABET = [
  'Ա', 'Բ', 'Գ', 'Դ', 'Ե', 'Զ', 'Է', 'Ը', 'Թ', 'Ժ', 'Ի', 'Լ', 'Խ', 'Ծ', 'Կ',
  'Հ', 'Ձ', 'Ղ', 'Ճ', 'Մ', 'Յ', 'Ն', 'Շ', 'Ո', 'Չ', 'Պ', 'Ջ', 'Ռ', 'Ս', 'Վ',
  'Տ', 'Ր', 'Ց', 'Ու', 'Փ', 'Ք', 'Օ', 'Ֆ',
];

// нормализуем «ՈՒ» (U+0552) → «Ու» (U+0582)
export const normLetter = (l: string) => l.replace(/\u0552/g, '\u0582').trim();

export const postBySlug = new Map(posts.map((p) => [p.slug, p]));
export const pageByPath = new Map(pages.map((p) => [p.path, p]));

export const letterPages = pages.filter((p) => p.kind === 'letter');

// путь буквенной страницы по букве
export const letterPathByLetter = new Map(
  letterPages.map((p) => [normLetter(p.letter || ''), p.path])
);

export const stripHtml = (h: string) =>
  h
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ===== Внутренние ссылки =====

// Армянские буквы (для границ слов): Ա-Ֆ, ա-ֆ, և
const AM_LETTERS = 'Ա-Ֆա-ֆև';

// Нормализация слова: нижний регистр, «Ւ»(U+0552) → «ւ»(U+0582)
const normWord = (s: string) =>
  s.trim().toLowerCase().replace(/\u0552/g, '\u0582');

// Ищет реальный пост по сегменту пути (точный slug → заголовок → вхождение в slug).
// Возвращает канонический slug поста или null.
const resolvePostSlug = (segment: string): string | null => {
  let raw = decodeURIComponent(segment).trim();
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  if (!raw) return null;
  const seg = normWord(raw).replace(/-/g, ' ');
  if (seg.length < 3) return null;
  if (postBySlug.has(raw)) return raw;
  const normTitle = (t: string) => {
    let s = normWord(t);
    s = s.replace(/^երազահան /i, '');
    s = s.replace(/:.*$/, '');
    s = s.replace(/-/g, ' ');
    return s.trim();
  };
  const exact = posts.find((p) => normTitle(p.title ?? '') === seg);
  if (exact) return exact.slug;
  const starts = posts.find((p) => normTitle(p.title ?? '').startsWith(seg + ' '));
  if (starts) return starts.slug;
  const contains = posts.find((p) => normTitle(p.title ?? '').includes(seg));
  if (contains) return contains.slug;
  const low = raw.toLowerCase();
  const bySlug = posts.find((p) => (p.slug ?? '').toLowerCase().includes(low) && low.length >= 3);
  if (bySlug) return bySlug.slug;
  return null;
};

export const resolveWordSlug = (slug: string): string | null => resolvePostSlug(slug);

// Словарь «слово → пост» из списков слов буквенных страниц (wordList).
// Битые слаги (постов не существует) пропускаем, чтобы не создавать ссылки на 404.
export const dreamWordLink: Map<string, { slug: string; word: string }> = (() => {
  const m = new Map<string, { slug: string; word: string }>();
  for (const p of pages) {
    if (p.kind !== 'letter') continue;
    for (const w of p.wordList ?? []) {
      const key = normWord(w.wordText);
      if (key.length < 3) continue;
      const slug = resolvePostSlug(w.slug);
      if (slug) m.set(key, { slug, word: w.wordText });
    }
  }
  return m;
})();

// Длинные ключи первыми, чтобы многословные варианты имели приоритет.
const WORD_KEYS = [...dreamWordLink.keys()].sort((a, b) => b.length - a.length);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WORD_RE = new RegExp(
  `(^|[^${AM_LETTERS}])(${WORD_KEYS.map(escapeRe).join('|')})(?=[^${AM_LETTERS}]|$)`,
  'gi'
);

const TAG_RE = /<[^>]+>/g;

const linkText = (
  text: string,
  used: Set<string>,
  currentSlug: string,
  canLink: () => boolean,
  inc: (n: number) => void
): string => {
  if (!canLink()) return text;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while (canLink() && (m = WORD_RE.exec(text))) {
    const key = normWord(m[2]);
    const info = dreamWordLink.get(key);
    out += text.slice(last, m.index) + m[1];
    if (info && info.slug !== currentSlug && !used.has(key)) {
      used.add(key);
      out += `<a href="/${info.slug}/">${m[2]}</a>`;
      inc(1);
    } else {
      out += m[2];
    }
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return out;
};

// Проставляет внутренние ссылки на посты-сонники по словам из текста.
// Текст внутри существующих <a> не трогаем (вложенные ссылки запрещены в HTML).
export const addInternalLinks = (html: string, currentSlug: string, max = 6): string => {
  if (!html) return html;
  let out = '';
  let last = 0;
  let linked = 0;
  let skip = 0;
  const used = new Set<string>();

  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    const tag = m[0].toLowerCase();
    if (/^<a\b/i.test(tag)) skip++;
    else if (/^<\/a>/i.test(tag)) skip = Math.max(0, skip - 1);

    const text = html.slice(last, m.index);
    out += skip ? text : linkText(text, used, currentSlug, () => linked < max, (n) => { linked += n; });
    out += m[0];
    last = m.index + m[0].length;
  }
  out += linkText(html.slice(last), used, currentSlug, () => linked < max, (n) => { linked += n; });

  // Битые ссылки на старый домен превращаем во внутренние.
  return out.replace(/href="https?:\/\/erazahan\.info\/([^"/]+)\/"/gi, (_all, slug: string) => `href="/${slug}/"`);
};

// ===== «Похожие сны» по теме из заголовка =====

// Служебные слова, которые не описывают тему поста.
const TITLE_STOPWORDS = new Set([
  'երազահան', 'երազ', 'երազում', 'երազի', 'երազներ', 'և', 'եւ', 'ու',
  'հետ', 'մեջ', 'մասին', 'որ', 'որն', 'որի', 'ամեն', 'անվան',
  'նշանակությունը', 'նշանակություն', 'բացատրությունը', 'բացատրություն',
  'տեսնել', 'տեսնելը', 'տեսնում', 'նշանակում', 'գրել',
]);

// Лёгкий стемминг армянских окончаний («ագռավի» → «ագռավ»).
const STEM_SUFFIXES = ['եր', 'ներ', 'ից', 'ում', 'ին', 'երդ', 'րդ', 'րեն', 'ոց', 'անց', 'աց', 'ու', 'ի'];
const stemWord = (w: string): string => {
  for (const suf of STEM_SUFFIXES) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
};

// Тематические слова из заголовка поста (без служебных слов и транслитерации).
const titleTopicTokens = (title: string): string[] => {
  const words = title.toLowerCase().match(/[ա-ֆև]+/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || TITLE_STOPWORDS.has(w)) continue;
    const s = stemWord(w);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
};

// Инвертированный индекс: тематический токен → посты с этим словом в заголовке.
const tokenToSlugs = new Map<string, string[]>();
for (const p of posts) {
  for (const t of titleTopicTokens(p.title)) {
    const list = tokenToSlugs.get(t);
    if (list) list.push(p.slug);
    else tokenToSlugs.set(t, [p.slug]);
  }
}

// «Похожие сны»: посты с общей темой в заголовке (ранжирование по числу общих слов).
export const relatedForPost = (post: Post, limit = 6): Post[] => {
  const scores = new Map<string, number>();
  for (const t of titleTopicTokens(post.title)) {
    for (const slug of tokenToSlugs.get(t) || []) {
      if (slug === post.slug) continue;
      scores.set(slug, (scores.get(slug) || 0) + 1);
    }
  }

  const ranked = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
  );
  const found: Post[] = [];
  for (const [slug] of ranked) {
    const p = postBySlug.get(slug);
    if (p) found.push(p);
    if (found.length >= limit) break;
  }

  // Мало совпадений по теме — добираем соседями по той же букве.
  if (found.length < 2) {
    const seen = new Set(found.map((x) => x.slug).concat(post.slug));
    const lp = letterPages.find((x) => normLetter(x.letter || '') === normLetter(post.letter || ''));
    if (lp) {
      const list = lp.wordList ?? [];
      let start = list.findIndex((w) => w.slug === post.slug);
      if (start < 0) start = 0;
      for (let i = 1; i < list.length && found.length < limit; i++) {
        const cand = list[(start + i) % list.length];
        if (seen.has(cand.slug)) continue;
        seen.add(cand.slug);
        const p = postBySlug.get(cand.slug);
        if (p) found.push(p);
      }
    }
  }

  return found;
};

// ===== Картинки =====

const uploadedFiles = new Set((imagesJson as { file: string }[]).map((image) => image.file));

// Удаляет <img src="/uploads/...">, файл которых не был скачан (битые картинки)
export const stripBrokenImages = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/src="([^"]+)"/i) || tag.match(/src='([^']+)'/i);
    if (!m) return tag;
    const file = m[1].match(/^\/uploads\/(.+)$/)?.[1];
    return file && !uploadedFiles.has(file) ? '' : tag;
  });

// Обложка поста: сначала поле cover, затем совпадающий slug. WordPress добавлял -1 при коллизиях имён.
export const postCover = (post: { slug: string; cover?: string | null }): string | null => {
  if (post.cover) {
    const c = post.cover.trim();
    if (/^https?:\/\//i.test(c)) return c;
    if (c.startsWith('/')) return c;
    if (c.startsWith('public/uploads/')) return '/' + c.slice('public/uploads/'.length);
    return '/uploads/' + c;
  }
  const files = [`${post.slug}.webp`, `${post.slug}-1.webp`];
  const file = files.find((candidate) => uploadedFiles.has(candidate));
  return file ? `/uploads/${file}` : null;
};

// Читает intrinsic width/height из заголовка локального .webp-файла (нужно для width/height LCP-картинки без CLS).
const coverDimensionsCache = new Map<string, { width: number; height: number } | null>();

const readWebpDimensions = (buf: Uint8Array): { width: number; height: number } | null => {
  if (buf.length < 30) return null;
  const isRiff = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46;
  const isWebp = buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  if (!isRiff || !isWebp) return null;
  const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  if (chunk === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ' && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    const width = (buf[26] | (buf[27] << 8)) & 0x3fff;
    const height = (buf[28] | (buf[29] << 8)) & 0x3fff;
    return { width, height };
  }
  if (chunk === 'VP8L' && buf[20] === 0x2f) {
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  return null;
};

export const coverDimensions = (coverUrl: string): { width: number; height: number } | null => {
  if (!coverUrl.startsWith('/uploads/') || !coverUrl.toLowerCase().endsWith('.webp')) return null;
  if (coverDimensionsCache.has(coverUrl)) return coverDimensionsCache.get(coverUrl)!;
  let result: { width: number; height: number } | null = null;
  try {
    const filePath = path.join(process.cwd(), 'public', coverUrl);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(30);
    fs.readSync(fd, buf, 0, 30, 0);
    fs.closeSync(fd);
    result = readWebpDimensions(buf);
  } catch {
    result = null;
  }
  coverDimensionsCache.set(coverUrl, result);
  return result;
};

export const excerptOf = (p: Post, len = 180) => {
  const t = stripHtml(p.content);
  return t.length > len ? t.slice(0, len) + '…' : t;
};

// Импортированный из WordPress контент использует произвольные уровни заголовков (h1/h3/h4 подряд),
// из-за чего на странице получаются "прыжки" уровней (h1 -> h3, h1 -> h4 и т.п.). Приводим их к
// последовательной иерархии, не меняя визуальный размер: исходный уровень сохраняется в классе
// dream-hN, а CSS в global.css рисует по классу, а не по тегу.
// startLevel — уровень заголовка, уже присутствующего на странице до этого блока контента
// (1, если перед блоком уже есть настоящий <h1>; 0, если первый заголовок в контенте сам играет роль <h1>).
export const normalizeHeadings = (html: string, startLevel = 1): string => {
  let prevLevel = startLevel;
  return html.replace(/<h([1-6])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi, (_match, levelStr, attrs, inner) => {
    const originalLevel = Number(levelStr);
    const targetLevel = Math.min(Math.max(originalLevel, startLevel + 1), prevLevel + 1);
    prevLevel = targetLevel;
    const classMatch = attrs.match(/\sclass="([^"]*)"/i);
    const mergedClass = classMatch ? `${classMatch[1]} dream-h${originalLevel}` : `dream-h${originalLevel}`;
    const restAttrs = classMatch ? attrs.replace(classMatch[0], '') : attrs;
    return `<h${targetLevel}${restAttrs} class="${mergedClass}">${inner}</h${targetLevel}>`;
  });
};

// ===== Имена: страницы букв, генерируемые из постов =====

const BOYS_NAME_CAT = 'Արական Անունների Նշանակությունը';
const GIRLS_NAME_CAT = 'Իգական Անուների Նշանակությունը';

export interface NameCard {
  slug: string;
  wordText: string;
}

export interface NameLetterPage {
  path: string;
  title: string;
  gender: 'boys' | 'girls';
  letter: string;
  names: NameCard[];
}

// Множество букв армянского алфавита, как в ALPHABET (уже нормализованное)
const ARMENIAN_LETTERS = new Set(ALPHABET.map((l) => normLetter(l)));

// «Մադաթ անվան նշանակությունը» / «Մեսրոպ անվան բացատրությունը» / «Անունների Նշանակությունը Անի» → имя
const extractName = (title: string): string => {
  let t = title.trim();

  // Префикс-форма: «Անունների Նշանակությունը Անի» → «Անի»
  const prefix = t.match(/^Անունների\s+(?:Նշանակություն(?:ը)?|Բացատրություն(?:ը)?)\s*(.+)$/i);
  if (prefix) return prefix[1].trim();

  // Суффикс-форма: «Աբգար Անվան Նշանակությունը» → «Աբգար»
  const anvanIdx = t.search(/անվան/i);
  if (anvanIdx > 0) return t.slice(0, anvanIdx).trim();

  // Опечатка «անան նշանակությունը» → «անան» — только если следом идёт «նշանակ»/«բացատր»
  const anan = t.match(/^(.*?)\s*անան\s*(?=նշանակ|բացատր)/i);
  if (anan) return anan[1].trim();

  // Служебный текст без имени пропускаем
  if (/նշանակ|բացատր|Անուններ/i.test(t)) return '';
  return t;
};

// Первая буква имени с учётом диграфа «Ու»
const firstLetterOfName = (name: string): string => {
  const n = name.trim();
  if (!n) return '';
  if (normLetter(n.slice(0, 2)) === 'Ու') return 'Ու';
  const first = n.charAt(0).toUpperCase();
  return ARMENIAN_LETTERS.has(first) ? first : '';
};

const namePagePath = (gender: 'boys' | 'girls', letter: string): string =>
  `${gender === 'boys' ? 'արական' : 'իգական'}-անուններ-սկսվող-${normLetter(letter).toLowerCase()}-տառով`;

export const nameLetterPages: NameLetterPage[] = (() => {
  const byKey = new Map<string, NameLetterPage>();

  for (const [gender, category] of [
    ['boys', BOYS_NAME_CAT],
    ['girls', GIRLS_NAME_CAT],
  ] as const) {
    const byLetter = new Map<string, NameCard[]>();

    for (const p of posts) {
      if (!(p.categories ?? []).includes(category)) continue;
      const name = extractName(p.title);
      const letter = firstLetterOfName(name);
      if (!letter) continue;
      const list = byLetter.get(letter) ?? [];
      list.push({ slug: p.slug, wordText: name });
      byLetter.set(letter, list);
    }

    for (const [letter, list] of byLetter) {
      const seen = new Set<string>();
      const names = list
        .filter((n) => (seen.has(n.wordText) ? false : (seen.add(n.wordText), true)))
        .sort((a, b) => (a.wordText < b.wordText ? -1 : a.wordText > b.wordText ? 1 : 0));

      const norm = normLetter(letter);
      const path = namePagePath(gender, norm);
      byKey.set(path, {
        path,
        title: `${gender === 'boys' ? 'Արական' : 'Իգական'} Անուններ Սկսվող ${norm} Տառով`,
        gender,
        letter: norm,
        names,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
})();

export const nameLetterPageByPath = new Map(nameLetterPages.map((p) => [p.path, p]));

// Устаревшие alias-пути имён → канонические пути буквенных страниц
export const LEGACY_PATH_ALIASES: Record<string, string> = {
  'arakan-anunner-a': 'արական-անուններ-սկսվող-ա-տառով',
};

// ===== Чистка битых внутренних ссылок =====

const STATIC_INTERNAL_PATHS = new Set(['search', 'search-index.json', 'keystatic', 'sitemap.xml', 'robots.txt', '404']);

// Возвращает канонический href для внутренней ссылки:
//  - сам href, если путь валиден (ничего не меняем);
//  - канонический путь поста, если удалось восстановить;
//  - null, если ссылка мёртвая (её нужно убрать).
export const canonicalInternalPath = (href: string): string | null => {
  let clean = href.split('#')[0].split('?')[0] || '/';
  while (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
  if (!clean || clean === '/') return '/';
  const rel = clean.slice(1);
  if (LEGACY_PATH_ALIASES[rel]) return '/' + LEGACY_PATH_ALIASES[rel] + '/';
  if (postBySlug.has(rel) || pageByPath.has(rel) || nameLetterPageByPath.has(rel) || STATIC_INTERNAL_PATHS.has(rel)) {
    return href;
  }
  const seg = rel.split('/').pop() || rel;
  const slug = resolvePostSlug(seg);
  return slug ? '/' + slug + '/' : null;
};

// Убирает мёртвые внутренние ссылки (оставляя текст) и чинит восстановимые.
export const fixBrokenInternalLinks = (html: string): string => {
  if (!html) return html;
  return html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (whole) => {
    const hrefM = whole.match(/\bhref\s*=\s*"([^"]+)"/i);
    if (!hrefM) return whole;
    const href = hrefM[1];
    if (
      !href.startsWith('/') ||
      href.startsWith('/uploads/') ||
      href.startsWith('/_astro/') ||
      href.startsWith('/keystatic')
    ) {
      return whole;
    }
    const canon = canonicalInternalPath(href);
    if (canon === null) {
      return whole.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '');
    }
    if (canon !== href) {
      return whole.replace(hrefM[0], 'href="' + canon + '"');
    }
    return whole;
  });
};

// Сетка букв (boys/girls) для главной страницы имён — тот же HTML, что стилизован в global.css
const nameGridHtml = (gender: 'boys' | 'girls'): string => {
  const cells = ALPHABET.map((letter) => {
    const norm = normLetter(letter);
    const path = namePagePath(gender, norm);
    return nameLetterPageByPath.has(path)
      ? `<div class="name-letter-cell"><a href="/${path}/">${norm}</a></div>`
      : `<div class="name-letter-cell"><strong>${norm}</strong></div>`;
  });
  return `<div class="names-alphabet-grid ${gender === 'boys' ? 'boys' : 'girls'}-grid">${cells.join('')}</div>`;
};

// Замена скрапленных сеток букв на сгенерированные (исправляет битые/пустые ссылки)
export const fixNameGrids = (html: string): string => {
  let out = html;
  for (const gender of ['boys', 'girls'] as const) {
    const cls = `${gender}-grid`;
    const re = new RegExp(
      `<div\\s+class="names-alphabet-grid\\s+${cls}"\\s*>(?:\\s*<div class="name-letter-cell">[\\s\\S]*?</div>)+\\s*</div>`
    );
    out = out.replace(re, nameGridHtml(gender));
  }
  return out;
};


// ===== «Գանգաբանություն»: карточки частей тела =====

const ANATOMY_ICONS: Record<string, string> = {
  '/nkaragrutyun-yst-achqeri/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>',
  '/nkaragrutyun-yst-honqeri-dzevi/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9c3-4.5 13-4.5 16 0"/></svg>',
  '/mardu-nkaragrutyun-yst-mazeri-gujni/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21c-.2-5 1-8.8 3.4-11.4"/><path d="M12 21c0-6 1.4-10 4.4-12.2"/><path d="M16 21c.2-4.4 1-7.6 3-9.6"/></svg>',
  '/mardu-nkaragrutyun-yst-akanji-karucvacqi/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0"/><path d="M14.5 6.5a2 2 0 0 1 1.5 2"/></svg>',
  '/mardu-nkaragrutyun-yst-atamneri/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5c1.6-1 3.2-.8 4.2.4.9-1.2 2.5-1.4 4.2-.4 2 1.1 2.8 3.7 2.8 6.3 0 3.2-1.4 8.2-2.9 8.2-1 0-1.2-2-2.4-2-1.2 0-1.4 2-2.4 2-1.5 0-2.9-5-2.9-8.2 0-2.6.8-5.2 2.4-6.3Z"/></svg>',
  '/mardu-nkaragrum-yst-berani-dzevi/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11c2.2-2.5 5.6-3.3 9-3.3s6.8.8 9 3.3c-2.2 4.2-5.6 6-9 6s-6.8-1.8-9-6Z"/><path d="M3 11c3.2 1.3 6.2 1.5 9 1.5s5.8-.2 9-1.5"/></svg>',
  '/mardu-nkaragrutyun-yst-qti/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.5c-2.4 2.7-3.5 5.2-3.1 7.6.4 2.4 1.9 3.8 4 4.4"/><path d="M12 4.5c2.4 2.7 3.5 5.2 3.1 7.6-.4 2.4-1.9 3.8-4 4.4"/><path d="M8.5 18.5c.9.8 2.1 1.2 3.5 1.2s2.6-.4 3.5-1.2"/></svg>',
  '/mardu-nkaragrutyun-yst-jakati/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 9.5c.6-2.9 3.1-5 6-5s5.4 2.1 6 5"/><path d="M6 9.5c1.6-1.4 3.5-2.3 5.6-2.5"/></svg>',
  '/nkaragrutyun-glxi-karucvacqi/':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4.5"/><path d="M4.5 21c.6-4.5 3.8-7.5 7.5-7.5s6.9 3 7.5 7.5"/></svg>',
};

// Добавляет карточкам класс `.anatomy-card` и заменяет эмодзи на SVG-иконки
export const fixAnatomyPage = (html: string): string =>
  html.replace(
    /<a href="(\/[^"]+)"[^>]*>\s*<div class="anatomy-icon-box">[\s\S]*?<\/div>\s*<span class="anatomy-name">([\s\S]*?)<\/span>\s*<\/a>/g,
    (_match: string, href: string, name: string) => {
      const icon = ANATOMY_ICONS[href] ?? '🌙';
      return `<a href="${href}" class="anatomy-card"><div class="anatomy-icon-box">${icon}</div><span class="anatomy-name">${name}</span></a>`;
    }
  );
