interface D1Statement {
  bind(...values: string[]): D1Statement;
  first<T>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  DREAMS_DB: D1Database;
  ASSETS: AssetsBinding;
}

interface Context {
  request: Request;
  env: Env;
  params: { id?: string | string[] };
}

interface PublishedDream {
  id: string;
  name: string | null;
  dream_text: string;
  answer_text: string;
  created_at: string;
  answered_at: string | null;
  updated_at: string;
}

const getId = (value?: string | string[]): string | null => {
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const excerpt = (value: string, maximumLength: number): string => {
  const text = normalizeText(value);
  if (Array.from(text).length <= maximumLength) return text;

  const characters = Array.from(text);
  const cut = characters.slice(0, maximumLength + 1).join('');
  const boundary = cut.lastIndexOf(' ');
  if (boundary > 0) return `${cut.slice(0, boundary).trimEnd()}…`;
  const nextBoundary = text.indexOf(' ', maximumLength);
  return nextBoundary > 0 ? `${text.slice(0, nextBoundary).trimEnd()}…` : text;
};

const dreamTitle = (value: string): string => excerpt(value, 70);

const formatDate = (dream: PublishedDream): string => {
  const value = dream.answered_at || dream.updated_at || dream.created_at;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('hy-AM', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
};

const renderPlainText = (value: string): string => escapeHtml(value).replace(/\r?\n/g, '<br />');

const renderInlineMarkdown = (value: string): string => {
  const tokenPattern = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((\/(?!\/)[^)\s\\]+)\)/g;
  let output = '';
  let cursor = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    output += escapeHtml(value.slice(cursor, index));
    if (match[1]) {
      output += `<strong>${escapeHtml(match[1])}</strong>`;
    } else if (match[2] && match[3]) {
      output += `<a href="${escapeHtml(match[3])}" class="font-semibold text-violet-200 underline decoration-violet-400 underline-offset-2">${escapeHtml(match[2])}</a>`;
    }
    cursor = index + match[0].length;
  }

  return output + escapeHtml(value.slice(cursor));
};

const renderMarkdown = (markdown: string): string => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length && listType) {
      blocks.push(`<${listType} class="list-${listType === 'ul' ? 'disc' : 'decimal'} space-y-1 pl-5">${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${listType}>`);
      list = [];
      listType = null;
    }
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const item = unordered?.[1] ?? ordered?.[1];
    const nextType = unordered ? 'ul' : ordered ? 'ol' : null;
    if (item && nextType) {
      flushParagraph();
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      list.push(item);
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }

  flushParagraph();
  flushList();
  return blocks.join('');
};

const pageNotFound = (): Response =>
  new Response(
    '<!doctype html><html lang="hy"><head><meta charset="utf-8"><title>Էջը չի գտնվել</title></head><body><main><h1>Էջը չի գտնվել</h1><p>Այս երազը հասանելի չէ։</p><a href="/chgtnvac-erazner/">Չգտնված երազներ</a></main></body></html>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

const findDream = (env: Env, id: string): Promise<PublishedDream | null> =>
  env.DREAMS_DB
    .prepare(
      `SELECT id, name, dream_text, answer_text, created_at, answered_at, updated_at
       FROM dream_submissions
       WHERE id = ?
         AND status = 'answered'
         AND answer_text IS NOT NULL
         AND TRIM(answer_text) <> ''
       LIMIT 1`,
    )
    .bind(id)
    .first<PublishedDream>();

const buildPage = (baseHtml: string, dream: PublishedDream, requestUrl: URL): string => {
  const title = dreamTitle(dream.dream_text);
  const description = excerpt(`${dream.dream_text} ${dream.answer_text.replace(/[*\[\]()]/g, '')}`, 160);
  const date = formatDate(dream);
  const canonical = new URL(`/chgtnvac-erazner/${encodeURIComponent(dream.id)}/`, requestUrl).toString();
  const author = dream.name?.trim() || 'Անանուն';
  const detailMain = `
    <article class="reveal mx-auto max-w-3xl min-w-0 px-4 py-8 sm:px-6 sm:py-12" style="overflow-wrap:anywhere">
      <nav class="text-sm text-slate-400"><a href="/chgtnvac-erazner/" class="transition hover:text-white">Չգտնված երազներ</a></nav>
      <h1 class="mt-4 font-display text-3xl font-bold leading-tight text-white sm:text-4xl">${escapeHtml(title)}</h1>
      <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-slate-400">
        <span class="font-medium text-violet-200">${escapeHtml(author)}</span>${date ? `<span aria-hidden="true">·</span><time datetime="${escapeHtml(dream.answered_at || dream.updated_at || dream.created_at)}">${escapeHtml(date)}</time>` : ''}
      </div>
      <section class="mt-6 min-w-0 border-l-2 border-violet-300/25 pl-4 sm:pl-5">
        <h2 class="text-sm font-semibold tracking-wide text-violet-200">Երազը</h2>
        <p class="mt-2 text-base leading-8 text-slate-100">${renderPlainText(dream.dream_text)}</p>
      </section>
      <section class="mt-6 min-w-0 rounded-2xl bg-violet-400/[0.08] p-4 sm:p-5">
        <h2 class="text-sm font-semibold tracking-wide text-violet-200">Պատասխան</h2>
        <div class="mt-2 space-y-3 text-base leading-7 text-slate-300 [overflow-wrap:anywhere]">${renderMarkdown(dream.answer_text)}</div>
      </section>
      <a href="/chgtnvac-erazner/" class="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-slate-200 transition hover:bg-white/10 sm:w-auto">Չգտնված երազներ</a>
    </article>`;

  return baseHtml
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)} — Երազահան</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/i, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/i, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/i, `<meta property="og:title" content="${escapeHtml(title)} — Երազահան" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/i, `<meta property="og:url" content="${escapeHtml(canonical)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/i, `<meta name="twitter:title" content="${escapeHtml(title)} — Երազահան" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/i, `<meta name="twitter:description" content="${escapeHtml(description)}" />`)
    .replace(/<main class="flex-1">[\s\S]*?<\/main>/i, `<main class="flex-1">${detailMain}</main>`);
};

export async function onRequestGet({ request, env, params }: Context): Promise<Response> {
  const id = getId(params.id);
  if (!id) return pageNotFound();

  let dream: PublishedDream | null;
  try {
    dream = await findDream(env, id);
  } catch {
    return new Response('Չհաջողվեց բեռնել երազը։', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (!dream) return pageNotFound();

  const baseUrl = new URL('/chgtnvac-erazner/', request.url);
  const baseResponse = await env.ASSETS.fetch(new Request(baseUrl, request));
  if (!baseResponse.ok) return new Response('Չհաջողվեց բեռնել երազը։', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

  const html = buildPage(await baseResponse.text(), dream, new URL(request.url));
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
