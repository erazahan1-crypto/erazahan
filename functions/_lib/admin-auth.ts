interface AdminAuthEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
}

interface AccessClaims {
  aud?: string | string[];
  email?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
}

interface AccessHeader {
  alg?: string;
  kid?: string;
}

interface AccessCerts {
  keys?: JsonWebKey[];
}

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401 | 503 };

let cachedKeys: { issuer: string; expiresAt: number; keys: JsonWebKey[] } | null = null;

export async function verifyAdminRequest(request: Request, env: AdminAuthEnv): Promise<AdminAuthResult> {
  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const allowedAudiences = splitList(env.CF_ACCESS_AUD);
  const allowedEmails = splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase());

  if (!teamDomain || !allowedAudiences.length || !allowedEmails.length) {
    return { ok: false, status: 503 };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return { ok: false, status: 401 };

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, status: 401 };

    const header = decodeJson<AccessHeader>(parts[0]);
    const claims = decodeJson<AccessClaims>(parts[1]);
    if (header.alg !== 'RS256' || !header.kid) return { ok: false, status: 401 };

    const issuer = `https://${teamDomain}`;
    const now = Math.floor(Date.now() / 1000);
    const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    const email = claims.email?.trim().toLowerCase();

    if (
      claims.iss !== issuer ||
      !claims.exp ||
      claims.exp < now - 60 ||
      (claims.nbf && claims.nbf > now + 60) ||
      !tokenAudiences.some((audience) => allowedAudiences.includes(audience)) ||
      !email ||
      !allowedEmails.includes(email)
    ) {
      return { ok: false, status: 401 };
    }

    const keys = await getAccessKeys(issuer);
    const jwk = keys.find((key) => key.kid === header.kid);
    if (!jwk) return { ok: false, status: 401 };

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );

    return valid ? { ok: true, email } : { ok: false, status: 401 };
  } catch {
    return { ok: false, status: 401 };
  }
}

export function authFailure(result: Extract<AdminAuthResult, { ok: false }>): Response {
  const message = result.status === 503
    ? 'Админка не настроена. Проверьте переменные Cloudflare Access.'
    : 'Доступ запрещён.';
  return new Response(message, {
    status: result.status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function getAccessKeys(issuer: string): Promise<JsonWebKey[]> {
  if (cachedKeys && cachedKeys.issuer === issuer && cachedKeys.expiresAt > Date.now()) {
    return cachedKeys.keys;
  }

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Could not load Access certificates');
  const body = await response.json() as AccessCerts;
  if (!Array.isArray(body.keys)) throw new Error('Invalid Access certificates');

  cachedKeys = { issuer, keys: body.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
  return body.keys;
}

function splitList(value?: string): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
