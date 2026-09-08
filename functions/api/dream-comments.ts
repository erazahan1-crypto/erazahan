interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface Env {
  DREAMS_DB: { prepare(query: string): D1Statement };
}

interface Context {
  request: Request;
  env: Env;
}

interface PublicComment {
  name: string | null;
  comment_text: string;
  created_at: string;
}

const ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;
const RAW_HTML = /<\/?[a-z][^>]*>/i;
const MAX_BODY_BYTES = 5_000;
const MIN_COMMENT_LENGTH = 3;
const MAX_COMMENT_LENGTH = 2_000;
const MAX_NAME_LENGTH = 80;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const dreamId = new URL(request.url).searchParams.get('dream_id')?.trim() || '';
  if (!ID_PATTERN.test(dreamId)) return json({ ok: false, error: 'Սխալ երազի նույնացուցիչ։' }, 400);

  try {
    if (!(await isPublishedDream(env, dreamId))) return json({ ok: false, error: 'Երազը չի գտնվել։' }, 404);
    const { results } = await env.DREAMS_DB
      .prepare("SELECT name, comment_text, created_at FROM dream_comments WHERE dream_id = ? AND status = 'approved' ORDER BY created_at ASC")
      .bind(dreamId)
      .all<PublicComment>();
    return json({ ok: true, comments: results, count: results.length });
  } catch {
    console.error('dream comments: query failed');
    return json({ ok: false, error: 'Չհաջողվեց բեռնել մեկնաբանությունները։' }, 503);
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

  let body: { dream_id?: unknown; name?: unknown; comment_text?: unknown; website?: unknown };
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
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const commentText = typeof body.comment_text === 'string' ? body.comment_text.trim() : '';
  const honeypot = typeof body.website === 'string' ? body.website.trim() : '';
  if (!ID_PATTERN.test(dreamId)) return json({ ok: false, error: 'Սխալ երազի նույնացուցիչ։' }, 400);
  if (honeypot) return json({ ok: true, submitted: true });
  if (name.length > MAX_NAME_LENGTH) return json({ ok: false, error: 'Անունը չի կարող գերազանցել 80 նիշը։' }, 400);
  if (commentText.length < MIN_COMMENT_LENGTH) return json({ ok: false, error: 'Մեկնաբանությունը պետք է պարունակի առնվազն 3 նիշ։' }, 400);
  if (commentText.length > MAX_COMMENT_LENGTH) return json({ ok: false, error: 'Մեկնաբանությունը չի կարող գերազանցել 2000 նիշը։' }, 400);
  if (RAW_HTML.test(name) || RAW_HTML.test(commentText)) return json({ ok: false, error: 'HTML չի թույլատրվում։' }, 400);

  try {
    if (!(await isPublishedDream(env, dreamId))) return json({ ok: false, error: 'Երազը չի գտնվել։' }, 404);
    const now = new Date().toISOString();
    await env.DREAMS_DB
      .prepare("INSERT INTO dream_comments (id, dream_id, name, comment_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
      .bind(crypto.randomUUID(), dreamId, name || null, commentText, now, now)
      .run();
    return json({ ok: true, submitted: true }, 201);
  } catch {
    console.error('dream comments: insert failed');
    return json({ ok: false, error: 'Չհաջողվեց ուղարկել մեկնաբանությունը։' }, 503);
  }
}

function isPublishedDream(env: Env, dreamId: string): Promise<{ id: string } | null> {
  return env.DREAMS_DB
    .prepare("SELECT id FROM dream_submissions WHERE id = ? AND status = 'answered' AND answer_text IS NOT NULL AND TRIM(answer_text) <> '' LIMIT 1")
    .bind(dreamId)
    .first<{ id: string }>();
}
