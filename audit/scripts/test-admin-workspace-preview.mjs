import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { onRequest, onRequestPost } from '../../functions/api/admin/workspace/preview.ts';

// Functions imports omit the TypeScript extension; keep this focused test on
// the same Node resolution path used by the admin-auth regression test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier.endsWith('admin-auth')
      ? nextResolve(`${specifier}.ts`, context)
      : nextResolve(specifier, context);
  },
});

const { onRequest: apiAdminMiddleware } = await import('../../functions/api/admin/_middleware.ts');

const contentId = 'f0438140-c7fb-5fc1-ba23-6daf02f8588f';
const linkedContentId = '000a77c9-5b0b-5531-b65f-f2d27e51212c';
const assetId = '019c2a10-4e61-7a32-8c15-2a37bcf94d02';
const endpointUrl = 'https://site.test/api/admin/workspace/preview';
const workspacePage = readFileSync('src/pages/admin/posts/workspace.astro', 'utf8');

// The browser contract intentionally uses a transient form: article content
// remains in the POST body, the current normalized panel is used, and the
// resulting document can open in a separate tab without a public preview URL.
assert.match(workspacePage, /form\.method\s*=\s*'POST'/, 'Preview submits with POST');
assert.match(workspacePage, /form\.action\s*=\s*'\/api\/admin\/workspace\/preview'/, 'Preview targets the authenticated endpoint');
assert.match(workspacePage, /form\.target\s*=\s*'_blank'/, 'Preview opens in a new tab when allowed by the browser');
assert.match(workspacePage, /add\('payload', JSON\.stringify\(normalized\(panel\)\)\)/, 'Preview sends current in-browser normalized fields');
assert.doesNotMatch(workspacePage, /(?:href|window\.open)\s*[^\n]*workspace\/preview/, 'Preview is never navigated by GET');

function previewPayload(locale) {
  return {
    slug: locale === 'ru' ? 'nesokhranyonnaya-rabota' : 'unsaved-workspace-preview',
    title: `Unsaved ${locale.toUpperCase()} title`,
    description: `Unsaved ${locale.toUpperCase()} description`,
    content: `## Unsaved ${locale.toUpperCase()} body\n\n[Published reference](content://${linkedContentId})\n\n![](asset://${assetId})\n\nPreview must render this value before Save All.`,
    image_alts: { [assetId]: `Unsaved ${locale.toUpperCase()} ALT` },
    tags: ['unsaved', locale],
    alphabet_key: locale === 'ru' ? '\u043d' : 'u',
  };
}

function previewRequest(locale, payload = previewPayload(locale)) {
  // This is the native serialization of the dynamically-created HTML form:
  // forms default to application/x-www-form-urlencoded, not multipart.
  const body = new URLSearchParams({ content_id: contentId, locale, payload: JSON.stringify(payload) });
  return new Request(endpointUrl, {
    method: 'POST',
    headers: { origin: 'https://site.test', 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
}

const originalFetch = globalThis.fetch;
const assetReads = [];
const env = { ASSETS: { fetch: async (request) => {
  const url = new URL(request.url);
  assetReads.push({ url: url.href, method: request.method });
  assert.equal(url.pathname, '/admin/workspace/reference-index.json', 'preview reads the generated reference index directly from ASSETS');
  assert.equal(request.method, 'GET', 'preview performs no GitHub/R2 or other mutation request');
  return Response.json({
    known_content_ids: [contentId, linkedContentId],
    paths: [[linkedContentId, { ru: '/ru/published-reference/', en: '/en/published-reference/' }]],
  });
} } };
globalThis.fetch = async () => {
  throw new Error('Preview must not make a same-origin network fetch');
};

try {
  const getResponse = onRequest();
  assert.equal(getResponse.status, 405, 'GET is rejected');
  assert.equal(getResponse.headers.get('allow'), 'POST');

  for (const locale of ['ru', 'en']) {
    const payload = previewPayload(locale);
    const response = await onRequestPost({ request: previewRequest(locale, payload), env });
    const html = await response.text();
    assert.equal(response.status, 200, `${locale.toUpperCase()} NOT_CREATED locale previews without a draft`);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.match(html, new RegExp(payload.title), 'unsaved title is rendered');
    assert.match(html, new RegExp(`Unsaved ${locale.toUpperCase()} body`), 'unsaved body is rendered');
    assert.match(html, new RegExp(`href="/${locale}/published-reference/"`), 'content:// uses the published same-locale path');
    assert.match(html, new RegExp(`alt="Unsaved ${locale.toUpperCase()} ALT"`), 'asset:// uses the current localized ALT');
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  }

  // No write endpoint is called and no draft, reservation, or claim can be
  // created: preview only uses its in-memory POST body plus a static asset.
  assert.deepEqual(assetReads, [
    { url: 'https://site.test/admin/workspace/reference-index.json', method: 'GET' },
    { url: 'https://site.test/admin/workspace/reference-index.json', method: 'GET' },
  ]);

  const malformed = await onRequestPost({
    request: new Request(endpointUrl, { method: 'POST', headers: { origin: 'https://site.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'content_id=not-a-content-id&locale=ru&payload=%7B%7D' }),
    env,
  });
  assert.equal(malformed.status, 400, 'malformed browser-form payload remains a controlled validation error');

  let previewHandlerCalls = 0;
  const unauthenticated = await apiAdminMiddleware({
    request: new Request(endpointUrl, { method: 'POST' }),
    env: { CF_ACCESS_TEAM_DOMAIN: 'access.example.test', CF_ACCESS_AUD: 'preview', ADMIN_EMAILS: 'admin@example.com' },
    next: async () => {
      previewHandlerCalls += 1;
      return onRequestPost({ request: previewRequest('ru'), env });
    },
  });
  assert.equal(unauthenticated.status, 401, 'the API admin middleware rejects unauthenticated preview access');
  assert.equal(previewHandlerCalls, 0, 'the preview handler is not reached without Access authentication');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('ADMIN WORKSPACE PREVIEW PASS');
