import type { AdminEnv } from '../../_lib/admin-db';

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Context {
  request: Request;
  env: AdminEnv & { ASSETS: AssetsBinding };
}

export function onRequestGet({ request, env }: Context): Promise<Response> {
  const assetUrl = new URL('/admin/dreams/editor/', request.url);
  return env.ASSETS.fetch(new Request(assetUrl, request));
}
