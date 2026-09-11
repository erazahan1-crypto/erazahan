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
  seo_index: number | null;
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
      `SELECT id, name, dream_text, answer_text, created_at, answered_at, updated_at, seo_index
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
  const robots = dream.seo_index === 1 ? 'index,follow' : 'noindex,follow';
  const detailMain = `
    <article class="reveal mx-auto max-w-3xl min-w-0 px-4 py-8 sm:px-6 sm:py-12" style="overflow-wrap:anywhere" data-dream-id="${escapeHtml(dream.id)}">
      <nav class="text-sm text-slate-400"><a href="/chgtnvac-erazner/" class="transition hover:text-white">Չգտնված երազներ</a></nav>
      <h1 class="mt-4 font-display text-[1.625rem] font-bold leading-tight text-white sm:text-4xl">${escapeHtml(title)}</h1>
      <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6 text-slate-400">
        <span class="font-medium text-violet-200">${escapeHtml(author)}</span>${date ? `<span aria-hidden="true">·</span><time datetime="${escapeHtml(dream.answered_at || dream.updated_at || dream.created_at)}">${escapeHtml(date)}</time>` : ''}
      </div>
      <section class="mt-6 min-w-0 rounded-xl border border-violet-300/15 bg-night-950/40 p-4 sm:p-5">
        <h2 class="text-sm font-semibold tracking-wide text-violet-200">Երազը</h2>
        <p class="mt-2 text-base leading-8 text-slate-300">${renderPlainText(dream.dream_text)}</p>
      </section>
      <section class="mt-8 min-w-0 rounded-2xl border border-white/10 border-l-2 bg-violet-400/[0.08] p-4 sm:p-5" style="border-left-color:#C8A96B">
        <h2 class="text-sm font-semibold tracking-wide" style="color:#D2B57A">Մեկնաբանություն</h2>
        <div class="mt-2 space-y-4 text-base leading-7 text-slate-200 [overflow-wrap:anywhere]">${renderMarkdown(dream.answer_text)}</div>
      </section>

      <section class="mt-6 min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5" aria-labelledby="reactions-title">
        <h2 id="reactions-title" class="font-display text-lg font-bold text-white">Արձագանքներ</h2>
        <p class="mt-1 text-sm leading-6 text-slate-400">Գնահատեք պատասխանի օգտակարությունը։</p>
        <div class="mt-4 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3" data-reaction-buttons>
          <button type="button" data-reaction="helpful" aria-pressed="false" class="min-h-11 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:border-violet-300/40 hover:bg-white/10 disabled:opacity-60"><span aria-hidden="true">👍</span> Օգտակար <span data-reaction-count="helpful">0</span></button>
          <button type="button" data-reaction="interesting" aria-pressed="false" class="min-h-11 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:border-violet-300/40 hover:bg-white/10 disabled:opacity-60"><span aria-hidden="true">❤️</span> Հետաքրքիր <span data-reaction-count="interesting">0</span></button>
          <button type="button" data-reaction="not_helpful" aria-pressed="false" class="min-h-11 min-w-0 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:border-violet-300/40 hover:bg-white/10 disabled:opacity-60"><span aria-hidden="true">👎</span> Օգտակար չէր <span data-reaction-count="not_helpful">0</span></button>
        </div>
        <p class="mt-3 min-h-5 text-sm text-slate-400" data-reaction-message role="status" aria-live="polite">Արձագանքները բեռնվում են…</p>
      </section>

      <section class="mt-6 min-w-0" aria-labelledby="comments-title">
        <h2 id="comments-title" class="font-display text-xl font-bold text-white"><span aria-hidden="true">💬</span> Մեկնաբանություններ <span class="text-base font-medium text-slate-400" data-comment-count></span></h2>
        <p class="mt-4 text-sm text-slate-400" data-comments-status role="status">Մեկնաբանությունները բեռնվում են…</p>
        <div class="mt-4 min-w-0 space-y-3" data-comments-list></div>

        <form class="mt-6 min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5" data-comment-form>
          <h3 class="font-display text-lg font-bold text-white">Թողնել մեկնաբանություն</h3>
          <p class="mt-1 text-sm leading-6 text-slate-400">Մեկնաբանությունը կհրապարակվի ստուգումից հետո։</p>
          <label for="comment-name" class="mt-4 block text-sm font-semibold text-slate-200">Անուն կամ կեղծանուն <span class="font-normal text-slate-500">(ոչ պարտադիր)</span></label>
          <input id="comment-name" name="name" type="text" maxlength="80" autocomplete="nickname" class="mt-2 min-h-11 w-full max-w-full rounded-xl border border-white/10 bg-night-950/70 px-4 text-base text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" />
          <div class="absolute h-px w-px overflow-hidden opacity-0" aria-hidden="true">
            <label for="comment-website">Կայք</label>
            <input id="comment-website" name="website" type="text" tabindex="-1" autocomplete="off" />
          </div>
          <label for="comment-text" class="mt-4 block text-sm font-semibold text-slate-200">Մեկնաբանություն</label>
          <textarea id="comment-text" name="comment_text" rows="5" minlength="3" maxlength="2000" required class="mt-2 min-h-32 w-full max-w-full resize-y rounded-xl border border-white/10 bg-night-950/70 p-4 text-base leading-7 text-white outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20"></textarea>
          <button type="submit" class="mt-4 min-h-12 w-full rounded-xl bg-violet-600 px-5 font-semibold text-white transition hover:bg-violet-500 disabled:cursor-wait disabled:opacity-60 sm:w-auto">Ուղարկել մեկնաբանությունը</button>
          <p class="mt-3 hidden rounded-xl border px-4 py-3 text-sm" data-comment-message role="status" aria-live="polite"></p>
        </form>
      </section>
      <a href="/chgtnvac-erazner/" class="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-slate-200 transition hover:bg-white/10 sm:w-auto">Չգտնված երազներ</a>
    </article>
    <script>
      (() => {
        const article = document.querySelector('[data-dream-id]');
        const dreamId = article instanceof HTMLElement ? article.dataset.dreamId || '' : '';
        const reactionMessage = document.querySelector('[data-reaction-message]');
        const reactionButtons = Array.from(document.querySelectorAll('[data-reaction]'));
        const commentsStatus = document.querySelector('[data-comments-status]');
        const commentsList = document.querySelector('[data-comments-list]');
        const commentCount = document.querySelector('[data-comment-count]');
        const commentForm = document.querySelector('[data-comment-form]');
        const commentMessage = document.querySelector('[data-comment-message]');
        let visitorKey = '';

        const createVisitorKey = () => {
          if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          bytes[6] = (bytes[6] & 15) | 64;
          bytes[8] = (bytes[8] & 63) | 128;
          const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
          return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
        };

        try {
          visitorKey = localStorage.getItem('dream-reaction-visitor-key') || '';
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorKey)) {
            visitorKey = createVisitorKey();
            localStorage.setItem('dream-reaction-visitor-key', visitorKey);
          }
        } catch {
          visitorKey = createVisitorKey();
        }

        const setReactionState = (button, active) => {
          button.setAttribute('aria-pressed', String(active));
          button.classList.toggle('border-violet-300/60', active);
          button.classList.toggle('bg-violet-400/15', active);
          button.classList.toggle('text-white', active);
        };

        const loadReactions = async () => {
          try {
            const response = await fetch('/api/dream-reactions?dream_id=' + encodeURIComponent(dreamId) + '&visitor_key=' + encodeURIComponent(visitorKey));
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Չհաջողվեց բեռնել արձագանքները։');
            reactionButtons.forEach((button) => {
              const type = button.getAttribute('data-reaction') || '';
              const count = button.querySelector('[data-reaction-count]');
              if (count) count.textContent = String(result.counts[type] || 0);
              setReactionState(button, result.active.includes(type));
            });
            if (reactionMessage) reactionMessage.textContent = '';
          } catch (error) {
            if (reactionMessage) reactionMessage.textContent = error instanceof Error ? error.message : 'Չհաջողվեց բեռնել արձագանքները։';
          }
        };

        reactionButtons.forEach((button) => button.addEventListener('click', async () => {
          const reactionType = button.getAttribute('data-reaction') || '';
          button.disabled = true;
          if (reactionMessage) reactionMessage.textContent = 'Պահպանվում է…';
          try {
            const response = await fetch('/api/dream-reactions', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dream_id: dreamId, reaction_type: reactionType, visitor_key: visitorKey }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Չհաջողվեց պահպանել արձագանքը։');
            const count = button.querySelector('[data-reaction-count]');
            if (count) count.textContent = String(result.count);
            setReactionState(button, result.active);
            if (reactionMessage) reactionMessage.textContent = 'Արձագանքը պահպանված է։';
          } catch (error) {
            if (reactionMessage) reactionMessage.textContent = error instanceof Error ? error.message : 'Չհաջողվեց պահպանել արձագանքը։';
          } finally {
            button.disabled = false;
          }
        }));

        const loadComments = async () => {
          if (!commentsList || !commentsStatus) return;
          commentsStatus.hidden = false;
          commentsStatus.textContent = 'Մեկնաբանությունները բեռնվում են…';
          commentsList.replaceChildren();
          try {
            const response = await fetch('/api/dream-comments?dream_id=' + encodeURIComponent(dreamId));
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Չհաջողվեց բեռնել մեկնաբանությունները։');
            if (commentCount) commentCount.textContent = '· ' + String(result.count);
            if (!result.comments.length) {
              commentsStatus.textContent = 'Մեկնաբանություններ դեռ չկան։';
              return;
            }
            commentsStatus.hidden = true;
            result.comments.forEach((comment) => {
              const item = document.createElement('article');
              item.className = 'min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4';
              const meta = document.createElement('div');
              meta.className = 'flex flex-wrap items-center gap-2 text-sm text-slate-400';
              const name = document.createElement('strong');
              name.className = 'font-semibold text-violet-200';
              name.textContent = comment.name || 'Անանուն';
              const date = document.createElement('time');
              date.dateTime = comment.created_at;
              const parsedDate = new Date(comment.created_at);
              date.textContent = Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toLocaleDateString('hy-AM', { year: 'numeric', month: 'long', day: 'numeric' });
              const text = document.createElement('p');
              text.className = 'mt-2 whitespace-pre-wrap break-words leading-7 text-slate-300 [overflow-wrap:anywhere]';
              text.textContent = comment.comment_text;
              meta.append(name, date);
              item.append(meta, text);
              commentsList.append(item);
            });
          } catch (error) {
            commentsStatus.textContent = error instanceof Error ? error.message : 'Չհաջողվեց բեռնել մեկնաբանությունները։';
          }
        };

        commentForm?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          if (!(form instanceof HTMLFormElement)) return;
          const submit = form.querySelector('button[type="submit"]');
          const data = new FormData(form);
          if (submit) submit.disabled = true;
          if (commentMessage) {
            commentMessage.textContent = 'Ուղարկվում է…';
            commentMessage.className = 'mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300';
          }
          try {
            const response = await fetch('/api/dream-comments', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dream_id: dreamId, name: data.get('name'), comment_text: data.get('comment_text'), website: data.get('website') }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Չհաջողվեց ուղարկել մեկնաբանությունը։');
            const commentText = form.elements.namedItem('comment_text');
            if (commentText instanceof HTMLTextAreaElement) commentText.value = '';
            if (commentMessage) {
              commentMessage.textContent = 'Ձեր մեկնաբանությունն ուղարկվել է և կհրապարակվի ստուգումից հետո։';
              commentMessage.className = 'mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200';
            }
          } catch (error) {
            if (commentMessage) {
              commentMessage.textContent = error instanceof Error ? error.message : 'Չհաջողվեց ուղարկել մեկնաբանությունը։';
              commentMessage.className = 'mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200';
            }
          } finally {
            if (submit) submit.disabled = false;
          }
        });

        loadReactions();
        loadComments();
      })();
    </script>`;

  const withRobots = /<meta\s+name=["']robots["'][^>]*>/i.test(baseHtml)
    ? baseHtml.replace(/<meta\s+name=["']robots["'][^>]*>/i, `<meta name="robots" content="${robots}" />`)
    : baseHtml.replace(/<\/head>/i, `<meta name="robots" content="${robots}" /></head>`);

  return withRobots
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
