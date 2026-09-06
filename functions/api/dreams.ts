interface D1Statement {
  bind(...values: string[]): D1Statement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface Env {
  DREAMS_DB: D1Database;
  DREAMS_EMAIL?: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim().slice(0, 120);
  const dream = String(form.get('dream') ?? '').trim().slice(0, 5000);

  if (!dream) {
    return json({ ok: false, error: 'dream is required' }, 400);
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  try {
    await env.DREAMS_DB
      .prepare('INSERT INTO dreams (id, name, dream, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, name, dream, createdAt)
      .run();
  } catch (error) {
    console.error('dreams: failed to store submission', error);
    return json({ ok: false, error: 'could not save dream' }, 503);
  }

  if (env.DREAMS_EMAIL) {
    try {
      await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(env.DREAMS_EMAIL)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          _subject: 'New dream from erazahan.info',
          name: name || 'Anonymous',
          dream,
        }),
      });
    } catch (error) {
      console.error('dreams: failed to email submission', error);
    }
  }

  return json({ ok: true }, 200);
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });