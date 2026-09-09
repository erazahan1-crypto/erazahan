import type { GetStaticPaths } from 'astro';
import { posts } from '../../../../lib/site';

export const getStaticPaths = (() => posts.map((post, id) => ({
  params: { id: String(id) },
  props: { post },
}))) satisfies GetStaticPaths;

export function GET({ props }: { props: { post: (typeof posts)[number] } }) {
  return new Response(JSON.stringify({ ok: true, post: props.post, writable: false }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}
