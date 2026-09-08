interface D1Result {
  meta?: { changes?: number };
}

interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface Env {
  DREAMS_DB: { prepare(query: string): D1Statement };
}

interface Context {
  request: Request;
  env: Env;
}

type ReactionType = 'helpful' | 'interesting' | 'not_helpful';

const REACTION_TYPES: ReactionType[] = ['helpful', 'interesting', 'not_helpful'];
const ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;
const VISITOR_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 600;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url);
  const dreamId = url.searchParams.get('dream_id')?.trim() || '';
  const visitorKey = url.searchParams.get('visitor_key')?.trim() || '';
  if (!ID_PATTERN.test(dreamId)) return json({ ok: false, error: 'Սխալ երազի նույնացուցիչ։' }, 400);
  if (visitorKey && !VISITOR_KEY_PATTERN.test(visitorKey)) return json({ ok: false, error: 'Սխալ այցելուի նույնացուցիչ։' }, 400);

  try {
    if (!(await isPublishedDream(env, dreamId))) return json({ ok: false, error: 'Երազը չի գտնվել։' }, 404);

    const counts = await getCounts(env, dreamId);
    let active: ReactionType[] = [];
    if (visitorKey) {
      const { results } = await env.DREAMS_DB
        .prepare('SELECT reaction_type FROM dream_reactions WHERE dream_id = ? AND visitor_key = ?')
        .bind(dreamId, visitorKey)
        .all<{ reaction_type: ReactionType }>();
      active = results.map((row) => row.reaction_type).filter((type) => REACTION_TYPES.includes(type));
    }
    return json({ ok: true, counts, active });
  } catch {
    console.error('dream reactions: query failed');
    return json({ ok: false, error: 'Չհաջողվեց բեռնել արձագանքները։' }, 503);
  }
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (request.headers.get('origin') !== requestUrl.origin) {
    return json({ ok: false, error: 'Հարցումը մերժվել է։' }, 403);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ ok: false, error: 'Սպասվում է JSON հարցում։' }, 415);
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: 'Հարցումը չափազանց մեծ է։' }, 413);

  let body: { dream_id?: unknown; reaction_type?: unknown; visitor_key?: unknown };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return json({ ok: false, error: 'Հարցումը չափազանց մեծ է։' }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Սխալ հարցում։' }, 400);
  }

  const dreamId = typeof body.dream_id === 'string' ? body.dream_id.trim() : '';
  const reactionType = typeof body.reaction_type === 'string' ? body.reaction_type.trim() : '';
  const visitorKey = typeof body.visitor_key === 'string' ? body.visitor_key.trim() : '';
  if (!ID_PATTERN.test(dreamId)) return json({ ok: false, error: 'Սխալ երազի նույնացուցիչ։' }, 400);
  if (!REACTION_TYPES.includes(reactionType as ReactionType)) return json({ ok: false, error: 'Սխալ արձագանք։' }, 400);
  if (!VISITOR_KEY_PATTERN.test(visitorKey)) return json({ ok: false, error: 'Սխալ այցելուի նույնացուցիչ։' }, 400);

  try {
    if (!(await isPublishedDream(env, dreamId))) return json({ ok: false, error: 'Երազը չի գտնվել։' }, 404);

    const removed = await env.DREAMS_DB
      .prepare('DELETE FROM dream_reactions WHERE dream_id = ? AND reaction_type = ? AND visitor_key = ?')
      .bind(dreamId, reactionType, visitorKey)
      .run();
    let active = false;
    if (!removed.meta?.changes) {
      const inserted = await env.DREAMS_DB
        .prepare('INSERT OR IGNORE INTO dream_reactions (id, dream_id, reaction_type, visitor_key, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), dreamId, reactionType, visitorKey, new Date().toISOString())
        .run();
      active = Boolean(inserted.meta?.changes);
    }

    const count = await getReactionCount(env, dreamId, reactionType as ReactionType);
    return json({ ok: true, active, count });
  } catch {
    console.error('dream reactions: toggle failed');
    return json({ ok: false, error: 'Չհաջողվեց պահպանել արձագանքը։' }, 503);
  }
}

function isPublishedDream(env: Env, dreamId: string): Promise<{ id: string } | null> {
  return env.DREAMS_DB
    .prepare("SELECT id FROM dream_submissions WHERE id = ? AND status = 'answered' AND answer_text IS NOT NULL AND TRIM(answer_text) <> '' LIMIT 1")
    .bind(dreamId)
    .first<{ id: string }>();
}

async function getCounts(env: Env, dreamId: string): Promise<Record<ReactionType, number>> {
  const row = await env.DREAMS_DB
    .prepare(`SELECT
      SUM(CASE WHEN reaction_type = 'helpful' THEN 1 ELSE 0 END) AS helpful,
      SUM(CASE WHEN reaction_type = 'interesting' THEN 1 ELSE 0 END) AS interesting,
      SUM(CASE WHEN reaction_type = 'not_helpful' THEN 1 ELSE 0 END) AS not_helpful
      FROM dream_reactions WHERE dream_id = ?`)
    .bind(dreamId)
    .first<{ helpful: number | null; interesting: number | null; not_helpful: number | null }>();
  return {
    helpful: Number(row?.helpful || 0),
    interesting: Number(row?.interesting || 0),
    not_helpful: Number(row?.not_helpful || 0),
  };
}

async function getReactionCount(env: Env, dreamId: string, reactionType: ReactionType): Promise<number> {
  const row = await env.DREAMS_DB
    .prepare('SELECT COUNT(*) AS count FROM dream_reactions WHERE dream_id = ? AND reaction_type = ?')
    .bind(dreamId, reactionType)
    .first<{ count: number }>();
  return Number(row?.count || 0);
}
