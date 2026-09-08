import { json } from '../../../_lib/admin-db';
import type { AdminEnv } from '../../../_lib/admin-db';

interface Context {
  request: Request;
  env: AdminEnv;
  params: { id?: string | string[] };
}

interface CommentRecord {
  id: string;
  dream_id: string;
  name: string | null;
  comment_text: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
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

  let body: { action?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Некорректный запрос.' }, 400);
  }

  const action = typeof body.action === 'string' ? body.action : '';
  if (!['approve', 'reject', 'delete_comment'].includes(action)) {
    return json({ ok: false, error: 'Неизвестное действие.' }, 400);
  }

  try {
    const existing = await findComment(context.env, id);
    if (!existing) return json({ ok: false, error: 'Комментарий не найден.' }, 404);

    if (action === 'delete_comment') {
      await context.env.DREAMS_DB
        .prepare('DELETE FROM dream_comments WHERE id = ?')
        .bind(id)
        .run();
      return json({ ok: true, deleted: true });
    }

    const status = action === 'approve' ? 'approved' : 'rejected';
    await context.env.DREAMS_DB
      .prepare('UPDATE dream_comments SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, new Date().toISOString(), id)
      .run();
    return json({ ok: true, comment: await findComment(context.env, id) });
  } catch {
    console.error('admin comments: mutation failed');
    return json({ ok: false, error: 'Не удалось изменить комментарий.' }, 503);
  }
}

function getId(value?: string | string[]): string | null {
  const id = Array.isArray(value) ? value[0] : value;
  return id && /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
}

function findComment(env: AdminEnv, id: string): Promise<CommentRecord | null> {
  return env.DREAMS_DB
    .prepare('SELECT id, dream_id, name, comment_text, status, created_at, updated_at FROM dream_comments WHERE id = ? LIMIT 1')
    .bind(id)
    .first<CommentRecord>();
}
