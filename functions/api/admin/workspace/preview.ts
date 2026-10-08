import { isContentId } from '../../../../src/lib/content-schema/schema.mjs';
import { LocalizedContentValidationError, renderLocalizedContent } from '../../../../src/lib/localized-content-pipeline.mjs';
import { localizedAuthoringContext } from '../../../_lib/localized-reference-context.mjs';

interface AssetsBinding { fetch(request: Request): Promise<Response>; }
interface Context { request: Request; env: { ASSETS: AssetsBinding }; }

function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!)); }

async function loadPublishedLinkIndex(assets: AssetsBinding, request: Request) {
  // Use the static-asset binding rather than a same-origin fetch: a Worker
  // subrequest would re-enter /admin/** without the browser's Access JWT.
  const response = await assets.fetch(new Request(new URL('/admin/workspace/reference-index.json', request.url)));
  const value: unknown = await response.json();
  if (!response.ok || !value || typeof value !== 'object' || !Array.isArray((value as { known_content_ids?: unknown }).known_content_ids) || !Array.isArray((value as { paths?: unknown }).paths)) throw new Error('Preview reference index is unavailable');
  const knownContentIds = new Set((value as { known_content_ids: unknown[] }).known_content_ids.filter((id): id is string => typeof id === 'string'));
  const pathsByContentId = new Map<string, Map<string, string>>();
  for (const row of (value as { paths: unknown[] }).paths) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || !row[1] || typeof row[1] !== 'object' || Array.isArray(row[1])) continue;
    const paths = new Map(Object.entries(row[1]).filter(([locale, path]) => (locale === 'hy' || locale === 'ru' || locale === 'en') && typeof path === 'string')) as Map<string, string>;
    pathsByContentId.set(row[0], paths);
  }
  return { knownContentIds, pathsByContentId };
}

function page(title: string, description: string, renderedContent: string, locale: string) {
  // The noindex shell is editorial-only; the body is rendered by the same
  // localized-content pipeline as the public RU and EN article routes.
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive"><title>${escapeHtml(title)} — Preview</title><meta name="description" content="${escapeHtml(description)}"><style>body{margin:0;background:#0b1020;color:#e5e7eb;font:18px/1.7 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:48px 24px}article{background:#11182b;border:1px solid #334155;border-radius:18px;padding:32px}small{color:#a5b4fc;text-transform:uppercase;letter-spacing:.08em}h1{line-height:1.2;color:white}.dream-content :is(h2,h3,h4){color:#fff;line-height:1.25}.dream-content a{color:#c4b5fd;text-decoration:underline}.dream-content img{max-width:100%;height:auto;border-radius:12px}.dream-content blockquote{border-left:3px solid #8b5cf6;margin-left:0;padding-left:1rem;color:#cbd5e1}</style></head><body><main><small>Authenticated editorial preview · not published</small><article><h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ''}<div class="dream-content">${renderedContent}</div></article></main></body></html>`;
}

export async function onRequestPost(context: Context) {
  if (context.request.headers.get('origin') !== new URL(context.request.url).origin) return new Response('Forbidden', { status: 403 });
  try {
    const form = await context.request.formData();
    const contentId = form.get('content_id'), locale = form.get('locale'), payload = form.get('payload');
    if (typeof contentId !== 'string' || !isContentId(contentId) || (locale !== 'ru' && locale !== 'en') || typeof payload !== 'string') return new Response('Invalid preview request', { status: 400 });
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (typeof value.title !== 'string' || !value.title.trim() || typeof value.content !== 'string' || typeof value.description !== 'string' && value.description !== null || !value.image_alts || typeof value.image_alts !== 'object' || Array.isArray(value.image_alts)) return new Response('Invalid preview content', { status: 400 });
    const contentLinkIndex = await loadPublishedLinkIndex(context.env.ASSETS, context.request);
    const renderedContent = renderLocalizedContent({ content: value.content, imageAlts: value.image_alts, locale, currentContentId: contentId, contentLinkIndex, mediaIndex: localizedAuthoringContext.mediaIndex });
    return new Response(page(value.title, typeof value.description === 'string' ? value.description : '', renderedContent, locale), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' } });
  } catch (error) {
    const message = error instanceof LocalizedContentValidationError ? error.message : 'Invalid preview request';
    return new Response(message, { status: 400, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow, noarchive' } });
  }
}

export function onRequest() { return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } }); }
