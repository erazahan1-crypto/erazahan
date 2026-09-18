import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { authFailure, verifyAdminRequest } from '../../functions/_lib/admin-auth.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier.endsWith('admin-auth')
      ? nextResolve(`${specifier}.ts`, context)
      : nextResolve(specifier, context);
  },
});

const { onRequest: apiAdminMiddleware } = await import('../../functions/api/admin/_middleware.ts');
const { onRequest: adminMiddleware } = await import('../../functions/admin/_middleware.ts');

const encoder = new TextEncoder();
const keyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const invalidSignatureKeyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const exportedPublicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
let teamSequence = 0;

function base64Url(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonSegment(value) {
  return base64Url(JSON.stringify(value));
}

function nextTeam() {
  teamSequence += 1;
  return `access-auth-test-${teamSequence}.example`;
}

function envFor(teamDomain = nextTeam(), overrides = {}) {
  return {
    CF_ACCESS_TEAM_DOMAIN: teamDomain,
    CF_ACCESS_AUD: 'test-audience, second-audience',
    ADMIN_EMAILS: 'admin@example.com, second@example.com',
    ...overrides,
  };
}

async function signedToken(options = {}) {
  const teamDomain = options.teamDomain;
  const issuer = options.issuer ?? `https://${teamDomain}`;
  const aud = Object.hasOwn(options, 'aud') ? options.aud : 'test-audience';
  const email = Object.hasOwn(options, 'email') ? options.email : 'admin@example.com';
  const exp = Object.hasOwn(options, 'exp') ? options.exp : Math.floor(Date.now() / 1000) + 300;
  const nbf = Object.hasOwn(options, 'nbf') ? options.nbf : Math.floor(Date.now() / 1000) - 5;
  const alg = options.alg ?? 'RS256';
  const kid = Object.hasOwn(options, 'kid') ? options.kid : 'test-kid';
  const signingKey = options.signingKey ?? keyPair.privateKey;
  const header = jsonSegment({ alg, ...(kid === undefined ? {} : { kid }) });
  const claims = jsonSegment({ iss: issuer, aud, ...(email === undefined ? {} : { email }), ...(exp === undefined ? {} : { exp }), ...(nbf === undefined ? {} : { nbf }) });
  const input = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, encoder.encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

function request(token, method = 'GET') {
  return new Request('https://admin.example.test/protected', {
    method,
    headers: token === undefined ? {} : { 'Cf-Access-Jwt-Assertion': token },
  });
}

async function withJwks(issuer, responseForRequest, operation) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const unexpectedRequests = [];
  globalThis.fetch = async (url, init) => {
    calls += 1;
    if (String(url) !== `${issuer}/cdn-cgi/access/certs` || !isDeepStrictEqual(init, { headers: { accept: 'application/json' } })) {
      unexpectedRequests.push({ url: String(url), init });
    }
    return typeof responseForRequest === 'function' ? responseForRequest() : responseForRequest;
  };
  try {
    const result = await operation(() => calls);
    assert.deepEqual(unexpectedRequests, []);
    return result;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jwks(kid = 'test-kid', key = exportedPublicKey) {
  return new Response(JSON.stringify({ keys: [{ ...key, kid, alg: 'RS256', use: 'sig' }] }), {
    headers: { 'content-type': 'application/json' },
  });
}

async function expectRejectedWithoutFetch(token, env) {
  const issuer = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  await withJwks(issuer, jwks(), async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(token), env), { ok: false, status: 401 });
    assert.equal(calls(), 0);
  });
}

for (const missing of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'ADMIN_EMAILS']) {
  const env = envFor(undefined, { [missing]: '   ' });
  await withJwks('https://unused.example', jwks(), async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(undefined), env), { ok: false, status: 503 });
    assert.equal(calls(), 0);
  });
}

{
  const env = envFor();
  await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, jwks(), async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(undefined), env), { ok: false, status: 401 });
    assert.equal(calls(), 0);
  });
}

for (const malformed of ['one.two', '@@@.e30.signature', `${base64Url('{not json')}.${jsonSegment({})}.signature`]) {
  const env = envFor();
  await expectRejectedWithoutFetch(malformed, env);
}

for (const header of [{ alg: 'HS256', kid: 'test-kid' }, { alg: 'RS256' }]) {
  const env = envFor();
  await expectRejectedWithoutFetch(`${jsonSegment(header)}.${jsonSegment({})}.signature`, env);
}

{
  const env = envFor();
  const token = await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, email: ' ADMIN@EXAMPLE.COM ' });
  await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, jwks(), async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(token), env), { ok: true, email: 'admin@example.com' });
    assert.equal(calls(), 1);
  });
}

{
  const env = envFor();
  const token = await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, signingKey: invalidSignatureKeyPair.privateKey });
  await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, jwks(), async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(token), env), { ok: false, status: 401 });
    assert.equal(calls(), 1);
  });
}

for (const options of [
  { issuer: 'https://wrong.example' },
  { aud: undefined },
  { aud: 'wrong-audience' },
  { aud: ['wrong-audience'] },
  { email: undefined },
  { exp: undefined },
  { email: 'not-allowed@example.com' },
  { exp: 0 },
  { exp: Math.floor(Date.now() / 1000) - 120 },
  { nbf: Math.floor(Date.now() / 1000) + 120 },
]) {
  const env = envFor();
  await expectRejectedWithoutFetch(await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, ...options }), env);
}

for (const options of [
  { aud: ['wrong-audience', 'second-audience'] },
  { exp: Math.floor(Date.now() / 1000) - 30 },
  { nbf: Math.floor(Date.now() / 1000) + 30 },
]) {
  const env = envFor();
  const token = await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN, ...options });
  await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, jwks(), async (calls) => {
    assert.equal((await verifyAdminRequest(request(token), env)).ok, true);
    assert.equal(calls(), 1);
  });
}

for (const response of [
  new Response('unavailable', { status: 503 }),
  new Response(JSON.stringify({}), { headers: { 'content-type': 'application/json' } }),
  jwks('different-kid'),
  new Response(JSON.stringify({ keys: [{ kty: 'RSA', kid: 'test-kid' }] }), { headers: { 'content-type': 'application/json' } }),
]) {
  const env = envFor();
  const token = await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN });
  await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, response, async (calls) => {
    assert.deepEqual(await verifyAdminRequest(request(token), env), { ok: false, status: 401 });
    assert.equal(calls(), 1);
  });
}

for (const [status, body] of [
  [401, '\u0414\u043e\u0441\u0442\u0443\u043f \u0437\u0430\u043f\u0440\u0435\u0449\u0451\u043d.'],
  [503, '\u0410\u0434\u043c\u0438\u043d\u043a\u0430 \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435 Cloudflare Access.'],
]) {
  const response = authFailure({ ok: false, status });
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), body);
}

for (const [name, middleware] of [['/api/admin/**', apiAdminMiddleware], ['/admin/** Functions', adminMiddleware]]) {
  for (const missing of ['CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'ADMIN_EMAILS']) {
    const env = envFor(undefined, { [missing]: '   ' });
    let nextCalls = 0;
    await withJwks('https://unused.example', jwks(), async (calls) => {
      const response = await middleware({ request: request(undefined), env, next: async () => { nextCalls += 1; return new Response('next'); } });
      assert.equal(response.status, 503, `${name} fails closed when ${missing} is absent`);
      assert.equal(calls(), 0);
    });
    assert.equal(nextCalls, 0);
  }
  {
    const env = envFor();
    let nextCalls = 0;
    const response = await middleware({ request: request(undefined), env, next: async () => { nextCalls += 1; return new Response('next'); } });
    assert.equal(response.status, 401, `${name} rejects an unauthenticated request`);
    assert.equal(nextCalls, 0);
  }
  {
    const env = envFor();
    const token = await signedToken({ teamDomain: env.CF_ACCESS_TEAM_DOMAIN });
    let nextCalls = 0;
    await withJwks(`https://${env.CF_ACCESS_TEAM_DOMAIN}`, jwks(), async (calls) => {
      const response = await middleware({ request: request(token), env, next: async () => { nextCalls += 1; return new Response('next', { status: 209 }); } });
      assert.equal(response.status, 209, `${name} invokes next for valid Access JWT`);
      assert.equal(calls(), 1);
    });
    assert.equal(nextCalls, 1);
  }
  {
    const env = envFor();
    let nextCalls = 0;
    const response = await middleware({ request: request(undefined, 'OPTIONS'), env, next: async () => { nextCalls += 1; return new Response('next'); } });
    assert.equal(response.status, 401, `${name} does not bypass OPTIONS authentication`);
    assert.equal(nextCalls, 0);
  }
}

{
  const first = envFor('cache-first.example');
  const second = envFor('cache-second.example');
  const firstToken = await signedToken({ teamDomain: first.CF_ACCESS_TEAM_DOMAIN });
  const secondToken = await signedToken({ teamDomain: second.CF_ACCESS_TEAM_DOMAIN });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return jwks();
  };
  try {
    assert.equal((await verifyAdminRequest(request(firstToken), first)).ok, true);
    assert.equal((await verifyAdminRequest(request(secondToken), second)).ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(calls, [
    'https://cache-first.example/cdn-cgi/access/certs',
    'https://cache-second.example/cdn-cgi/access/certs',
  ]);
}

console.log('ADMIN AUTH PASS');
