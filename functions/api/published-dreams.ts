interface D1Statement {
  all<T>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface Env {
  DREAMS_DB: D1Database;
}

interface Context {
  env: Env;
}

interface PublishedDream {
  id: string;
  name: string | null;
  dream_text: string;
  answer_text: string;
  created_at: string;
  answered_at: string | null;
  updated_at: string;
  status: string;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export async function onRequestGet({ env }: Context): Promise<Response> {
  try {
    const { results } = await env.DREAMS_DB.prepare(
      `SELECT id, name, dream_text, answer_text, created_at, answered_at, updated_at, status
       FROM dream_submissions
       WHERE status = 'answered'
         AND answer_text IS NOT NULL
         AND TRIM(answer_text) <> ''
       ORDER BY COALESCE(answered_at, updated_at, created_at) DESC
       LIMIT 10`,
    ).all<PublishedDream>();

    return jsonResponse({ ok: true, dreams: results });
  } catch {
    return jsonResponse(
      { ok: false, error: 'Չհաջողվեց բեռնել հրապարակված պատասխանները։' },
      500,
    );
  }
}
