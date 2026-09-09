import { posts, stripHtml } from '../lib/site';

// Full, canonical article text for server-side admin previews and future AI context.
export function GET() {
  const dreamArticles = posts
    .filter((post) => (
      /^Երազահան(?:\s|$)/.test(post.title)
      || post.categories.some((category) => /^(?:Երազներ|Երաներ) սկսող /.test(category) || category === 'Երազահան')
    ))
    .map((post) => {
      const interpretation = stripHtml(post.content);
      return {
        slug: post.slug,
        title: post.title,
        interpretation,
      };
    });

  return new Response(JSON.stringify(dreamArticles), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
