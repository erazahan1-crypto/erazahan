import { productionRedirectLocation } from './_lib/hostname-redirect.ts';

interface Context {
  request: Request;
  next(): Promise<Response>;
}

export function onRequest(context: Context): Promise<Response> | Response {
  const location = productionRedirectLocation(context.request.url);
  if (location) {
    return new Response(null, {
      status: 301,
      headers: { location },
    });
  }

  return context.next();
}
