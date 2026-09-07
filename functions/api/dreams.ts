interface D1Statement {
  bind(...values: (string | null)[]): D1Statement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface Env {
  DREAMS_DB: D1Database;
}

interface PagesContext {
  request: Request;
  env: Env;
}

export async function onRequestPost({ request, env }: PagesContext): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Հարցումը հնարավոր չէ մշակել։' }, 400);
  }

  const name = field(form, 'name');
  const email = field(form, 'email').toLowerCase();
  const dreamText = field(form, 'dream_text');
  const website = field(form, 'website');

  // Silently accept bot submissions so the honeypot cannot be discovered by its response.
  if (website) return json({ ok: true }, 200);

  if (name.length > 80) {
    return json({ ok: false, error: 'Անունը չպետք է գերազանցի 80 նիշը։' }, 400);
  }

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json({ ok: false, error: 'Նշեք վավեր էլփոստի հասցե։' }, 400);
  }

  if (dreamText.length < 20) {
    return json({ ok: false, error: 'Երազի նկարագրությունը պետք է պարունակի առնվազն 20 նիշ։' }, 400);
  }

  if (dreamText.length > 5000) {
    return json({ ok: false, error: 'Երազի նկարագրությունը չպետք է գերազանցի 5000 նիշը։' }, 400);
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await env.DREAMS_DB
      .prepare(
        `INSERT INTO dream_submissions
          (id, name, email, dream_text, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(id, name || null, email, dreamText, createdAt, createdAt)
      .run();
  } catch {
    console.error('dreams: database write failed');
    return json({ ok: false, error: 'Չհաջողվեց պահպանել երազը։ Խնդրում ենք փորձել ավելի ուշ։' }, 503);
  }

  return json({ ok: true }, 200);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const field = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
