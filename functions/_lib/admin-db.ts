export interface D1Result {
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export interface AdminEnv {
  DREAMS_DB: D1Database;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
