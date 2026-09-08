import { json } from '../../../_lib/admin-db';
import type { AdminEnv } from '../../../_lib/admin-db';

interface Context {
  request: Request;
  env: AdminEnv;
}

type CommentStatus = 'pending' | 'approved' | 'rejected';

interface AdminComment {
  id: string;
  dream_id: string;
  name: string | null;
  comment_text: string;
  status: CommentStatus;
  created_at: string;
  updated_at: string;
  dream_status: string | null;
  is_dream_published: number;
}

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  if (!['all', 'pending', 'approved', 'rejected'].includes(status)) {
    return json({ ok: false, error: 'Неизвестный фильтр.' }, 400);
  }

  const where = status === 'all' ? '' : 'WHERE c.status = ?';
  const query = `
    SELECT c.id, c.dream_id, c.name, c.comment_text, c.status, c.created_at, c.updated_at,
           d.status AS dream_status,
           CASE WHEN d.status = 'answered' AND d.answer_text IS NOT NULL AND TRIM(d.answer_text) <> '' THEN 1 ELSE 0 END AS is_dream_published
    FROM dream_comments c
    LEFT JOIN dream_submissions d ON d.id = c.dream_id
    ${where}
    ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
             c.created_at DESC
    LIMIT 200
  `;

  try {
    const statement = env.DREAMS_DB.prepare(query);
    const { results } = status === 'all'
      ? await statement.all<AdminComment>()
      : await statement.bind(status).all<AdminComment>();
    return json({ ok: true, comments: results });
  } catch {
    console.error('admin comments: list query failed');
    return json({ ok: false, error: 'Не удалось загрузить комментарии.' }, 503);
  }
}
