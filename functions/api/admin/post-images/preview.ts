import {
  PostImageValidationError,
  validatePostImageKey,
  type PostImagesBucket,
} from '../../../_lib/post-images';

interface Context {
  request: Request;
  env: { POST_IMAGES?: PostImagesBucket };
}

export async function onRequestGet({ request, env }: Context): Promise<Response> {
  try {
    if (!env.POST_IMAGES) return new Response('R2 binding POST_IMAGES is unavailable.', { status: 503 });
    const key = validatePostImageKey(new URL(request.url).searchParams.get('key') || '');
    const object = await env.POST_IMAGES.get(key);
    if (!object) return new Response('Image not found.', { status: 404 });
    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType || 'image/webp',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof PostImageValidationError) return new Response(error.message, { status: 400 });
    console.error('Admin R2 preview failed', error);
    return new Response('Не удалось загрузить изображение.', { status: 502 });
  }
}
