import { json } from '../../../_lib/admin-db';
import type { AdminEnv } from '../../../_lib/admin-db';

interface DreamListItem {
  id: string;
  name: string | null;
  dream_excerpt: string;
  status: 'pending' | 'answered' | 'rejected';
  created_at: string;
  updated_at: string;
}

interface Context {
  request: Request;
  env: AdminEnv;
}

const STATUSES = new Set(['pending', 'answered', 'rejected']);

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const requestedStatus = new URL(request.url).searchParams.get('status') ?? 'all';
  if (requestedStatus !== 'all' && !STATUSES.has(requestedStatus)) {
    return json({ ok: false, error: 'Неизвестный фильтр.' }, 400);
  }

  const filterSql = requestedStatus === 'all' ? '' : 'WHERE status = ?';
  const query = `
    SELECT id, name, SUBSTR(dream_text, 1, 240) AS dream_excerpt,
           status, created_at, updated_at
    FROM dream_submissions
    ${filterSql}
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END,
             created_at DESC
    LIMIT 100
  `;

  try {
    const statement = env.DREAMS_DB.prepare(query);
    const result = requestedStatus === 'all'
      ? await statement.all<DreamListItem>()
      : await statement.bind(requestedStatus).all<DreamListItem>();
    return json({ ok: true, dreams: result.results });
  } catch {
    console.error('admin dreams: list query failed');
    return json({ ok: false, error: 'Не удалось загрузить список.' }, 503);
  }
}
