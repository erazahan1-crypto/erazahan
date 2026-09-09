import { json } from '../../../_lib/admin-db';
import type { AdminEnv } from '../../../_lib/admin-db';
import {
  buildDreamInterpretationContext,
  loadContentIndex,
  rankPosts,
  suggestDreamSymbols,
} from '../../../_lib/dream-symbols';
import type { AssetsBinding, DreamSymbolLink } from '../../../_lib/dream-symbols';

interface Context {
  request: Request;
  env: AdminEnv & { ASSETS: AssetsBinding };
  params: { id?: string | string[] };
}

const MAX_SYMBOL_LENGTH = 120;

export async function onRequestGet(context: Context): Promise<Response> {
  const id = getId(context.params.id);
  if (!id) return json({ ok: false, error: 'Некорректный ID.' }, 400);
  const url = new URL(context.request.url);
  const action = url.searchParams.get('action') || 'list';

  try {
    const dream = await findDream(context.env, id);
    if (!dream) return json({ ok: false, error: 'Запись не найдена.' }, 404);

    if (action === 'list') return json({ ok: true, links: await listLinks(context.env, id) });
    if (action === 'search') {
      const query = (url.searchParams.get('q') || '').trim();
      if (query.length < 2) return json({ ok: true, results: [] });
      const index = await loadContentIndex(context.env.ASSETS, context.request.url);
      return json({ ok: true, results: rankPosts(query, index, 20) });
    }
    if (action === 'suggest') {
      const index = await loadContentIndex(context.env.ASSETS, context.request.url);
      return json({ ok: true, suggestions: suggestDreamSymbols(dream.dream_text, index, 12) });
    }
    if (action === 'preview') {
      const slug = normalizeSlug(url.searchParams.get('slug'));
      if (!slug) return json({ ok: false, error: 'Некорректный slug.' }, 400);
      const content = await loadContentIndex(context.env.ASSETS, context.request.url);
      const article = content.find((item) => item.slug === slug);
      if (!article) return json({ ok: false, error: 'Статья не найдена.' }, 404);
      return json({ ok: true, article: { slug, title: article.title, interpretation: article.interpretation } });
    }
    if (action === 'context') {
      const [links, content] = await Promise.all([listLinks(context.env, id), loadContentIndex(context.env.ASSETS, context.request.url)]);
      return json({ ok: true, context: buildDreamInterpretationContext(dream.dream_text, links, content) });
    }
    return json({ ok: false, error: 'Неизвестное действие.' }, 400);
  } catch {
    console.error('admin dream symbols: query failed');
    return json({ ok: false, error: 'Не удалось загрузить символы сна.' }, 503);
  }
}

export async function onRequestPost(context: Context): Promise<Response> {
  const id = getId(context.params.id);
  if (!id) return json({ ok: false, error: 'Некорректный ID.' }, 400);
  const requestUrl = new URL(context.request.url);
  if (context.request.headers.get('origin') !== requestUrl.origin) return json({ ok: false, error: 'Запрос отклонён.' }, 403);
  if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false, error: 'Ожидается JSON-запрос.' }, 415);

  let body: { action?: unknown; symbol_text?: unknown; post_slug?: unknown; link_id?: unknown };
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'Некорректный запрос.' }, 400); }
  const action = typeof body.action === 'string' ? body.action : '';
  if (!['add', 'delete'].includes(action)) return json({ ok: false, error: 'Неизвестное действие.' }, 400);

  try {
    if (!await findDream(context.env, id)) return json({ ok: false, error: 'Запись не найдена.' }, 404);
    if (action === 'delete') {
      const linkId = typeof body.link_id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(body.link_id) ? body.link_id : null;
      if (!linkId) return json({ ok: false, error: 'Некорректный ID связи.' }, 400);
      const result = await context.env.DREAMS_DB.prepare('DELETE FROM dream_symbol_links WHERE id = ? AND dream_id = ?').bind(linkId, id).run();
      if (!result.meta?.changes) return json({ ok: false, error: 'Связь не найдена.' }, 404);
      return json({ ok: true, links: await listLinks(context.env, id) });
    }

    const symbolText = typeof body.symbol_text === 'string' ? body.symbol_text.trim() : '';
    const slug = normalizeSlug(body.post_slug);
    if (!symbolText || symbolText.length > MAX_SYMBOL_LENGTH) return json({ ok: false, error: 'Символ должен содержать от 1 до 120 символов.' }, 400);
    if (!slug) return json({ ok: false, error: 'Некорректный slug.' }, 400);
    const index = await loadContentIndex(context.env.ASSETS, context.request.url);
    const canonical = index.find((item) => item.slug === slug);
    if (!canonical) return json({ ok: false, error: 'Статья с таким slug не найдена.' }, 400);
    await context.env.DREAMS_DB.prepare(`
      INSERT INTO dream_symbol_links (id, dream_id, symbol_text, post_slug, post_title, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (dream_id, post_slug) DO UPDATE SET
        symbol_text = excluded.symbol_text,
        post_title = excluded.post_title
    `).bind(crypto.randomUUID(), id, symbolText, canonical.slug, canonical.title, new Date().toISOString()).run();
    return json({ ok: true, links: await listLinks(context.env, id) });
  } catch {
    console.error('admin dream symbols: update failed');
    return json({ ok: false, error: 'Не удалось сохранить символ сна.' }, 503);
  }
}

function getId(value?: string | string[]): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
}

function normalizeSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const slug = value.trim().replace(/^\/+|\/+$/g, '');
  return slug && slug.length <= 300 && !slug.includes('/') && !/^(?:https?:|javascript:)/i.test(slug) ? slug : null;
}

function findDream(env: AdminEnv, id: string): Promise<{ dream_text: string } | null> {
  return env.DREAMS_DB.prepare('SELECT dream_text FROM dream_submissions WHERE id = ? LIMIT 1').bind(id).first<{ dream_text: string }>();
}

function listLinks(env: AdminEnv, id: string): Promise<DreamSymbolLink[]> {
  return env.DREAMS_DB.prepare(`
    SELECT id, dream_id, symbol_text, post_slug, post_title, created_at
    FROM dream_symbol_links WHERE dream_id = ? ORDER BY created_at ASC
  `).bind(id).all<DreamSymbolLink>().then(({ results }) => results);
}
