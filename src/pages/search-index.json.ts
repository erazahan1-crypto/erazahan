import { posts, stripHtml } from '../lib/site';

// Индекс собирается вместе с контентом и доступен как статический JSON на Pages.

export function GET() {
  const index = posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    letter: p.letter,
    text: stripHtml(p.content).slice(0, 220),
  }));

  return new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json' },
  });
}
