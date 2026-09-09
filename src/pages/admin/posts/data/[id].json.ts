import type { GetStaticPaths } from 'astro';
import postsJson from '../../../../data/posts.json';
import type { Post } from '../../../../lib/site';

const posts = postsJson as Post[];

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
