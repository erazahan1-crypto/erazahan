import { json } from '../../../_lib/admin-db';
import type { AdminEnv } from '../../../_lib/admin-db';

interface DreamRecord {
  id: string;
  name: string | null;
  email: string;
  dream_text: string;
  status: 'pending' | 'answered' | 'rejected';
  answer_text: string | null;
  ai_draft: string | null;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
}

interface Context {
  request: Request;
  env: AdminEnv;
  params: { id?: string | string[] };
}

const MAX_ANSWER_LENGTH = 20_000;
const RAW_HTML = /<\/?[a-z][^>]*>/i;
const MARKDOWN_LINK = /\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

export async function onRequestGet(context: Context): Promise<Response> {
  const id = getId(context.params.id);
  if (!id) return json({ ok: false, error: 'Некорректный ID.' }, 400);

  try {
    const dream = await findDream(context.env, id);
    return dream
      ? json({ ok: true, dream })
      : json({ ok: false, error: 'Запись не найдена.' }, 404);
  } catch {
    console.error('admin dreams: item query failed');
    return json({ ok: false, error: 'Не удалось загрузить запись.' }, 503);
  }
}

export async function onRequestPost(context: Context): Promise<Response> {
  const id = getId(context.params.id);
  if (!id) return json({ ok: false, error: 'Некорректный ID.' }, 400);

  const requestUrl = new URL(context.request.url);
  if (context.request.headers.get('origin') !== requestUrl.origin) {
    return json({ ok: false, error: 'Запрос отклонён.' }, 403);
  }
  if (!context.request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ ok: false, error: 'Ожидается JSON-запрос.' }, 415);
  }

  let body: { action?: unknown; answer_text?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Некорректный запрос.' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const answerText = typeof body.answer_text === 'string' ? body.answer_text.trim() : '';
  if (!['draft', 'publish', 'reject', 'reopen'].includes(action)) {
    return json({ ok: false, error: 'Неизвестное действие.' }, 400);
  }
  if (answerText.length > MAX_ANSWER_LENGTH) {
    return json({ ok: false, error: 'Ответ не должен превышать 20 000 символов.' }, 400);
  }
  if (answerText && RAW_HTML.test(answerText)) {
    return json({ ok: false, error: 'Используйте Markdown вместо HTML.' }, 400);
  }
  if (hasUnsafeMarkdownLink(answerText)) {
    return json({ ok: false, error: 'Разрешены только внутренние ссылки, начинающиеся с /.' }, 400);
  }
  if (action === 'publish' && !answerText) {
    return json({ ok: false, error: 'Нельзя опубликовать пустой ответ.' }, 400);
  }

  try {
    if (!await findDream(context.env, id)) {
      return json({ ok: false, error: 'Запись не найдена.' }, 404);
    }

    const now = new Date().toISOString();
    if (action === 'draft') {
      await context.env.DREAMS_DB
        .prepare('UPDATE dream_submissions SET answer_text = ?, updated_at = ? WHERE id = ?')
        .bind(answerText || null, now, id)
        .run();
    } else if (action === 'publish') {
      await context.env.DREAMS_DB
        .prepare("UPDATE dream_submissions SET answer_text = ?, status = 'answered', answered_at = ?, updated_at = ? WHERE id = ?")
        .bind(answerText, now, now, id)
        .run();
    } else if (action === 'reject') {
      await context.env.DREAMS_DB
        .prepare("UPDATE dream_submissions SET status = 'rejected', answered_at = NULL, updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    } else {
      await context.env.DREAMS_DB
        .prepare("UPDATE dream_submissions SET status = 'pending', answered_at = NULL, updated_at = ? WHERE id = ?")
        .bind(now, id)
        .run();
    }

    return json({ ok: true, dream: await findDream(context.env, id) });
  } catch {
    console.error('admin dreams: update failed');
    return json({ ok: false, error: 'Не удалось сохранить изменения.' }, 503);
  }
}

function getId(value?: string | string[]): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
}

function hasUnsafeMarkdownLink(markdown: string): boolean {
  MARKDOWN_LINK.lastIndex = 0;
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    if (!match[1].startsWith('/') || match[1].startsWith('//')) return true;
  }
  return false;
}

function findDream(env: AdminEnv, id: string): Promise<DreamRecord | null> {
  return env.DREAMS_DB
    .prepare(`
      SELECT id, name, email, dream_text, status, answer_text, ai_draft,
             created_at, updated_at, answered_at
      FROM dream_submissions
      WHERE id = ?
      LIMIT 1
    `)
    .bind(id)
    .first<DreamRecord>();
}
