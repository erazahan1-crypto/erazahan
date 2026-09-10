import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const posts = JSON.parse(readFileSync('src/data/posts.json', 'utf8'));
assert.equal(posts.length, 5800);
assert.equal(new Set(posts.map((post) => post.slug)).size, 5800);

for (const post of posts) {
  const outputPath = join('dist', post.slug, 'index.html');
  assert.ok(existsSync(outputPath), `missing public route: ${post.slug}`);
  const html = readFileSync(outputPath, 'utf8');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${post.slug}: expected exactly one h1`);
  if (post.content.trim()) {
    assert.match(html, /class="dream-content mt-6"[^>]*>[^]*?<\/div>/, `${post.slug}: empty public content`);
  }
}

const sample = (predicate, label) => {
  const post = posts.find(predicate);
  assert.ok(post, `missing ${label} source sample`);
  return { post, html: readFileSync(join('dist', post.slug, 'index.html'), 'utf8') };
};

const markdown = sample(
  (post) => !/<[a-z][^>]*>/i.test(post.content) && /(?:^|\n)\s*[-*+]\s+/m.test(post.content),
  'Markdown',
);
assert.match(markdown.html, /<ul>/);

const mixed = sample(
  (post) => /<[a-z][^>]*>/i.test(post.content) && /\*\*[^*]+\*\*/m.test(post.content),
  'mixed HTML/Markdown',
);
assert.match(mixed.html, /<strong>[^]*?<\/strong>/);

const faq = sample((post) => /<script\b[^>]*application\/ld\+json[^>]*>[^]*?FAQPage/i.test(post.content), 'FAQPage');
assert.doesNotMatch(faq.html, /FAQPage/);

const link = sample((post) => /<a\b[^>]*href=/i.test(post.content), 'internal-link');
assert.match(link.html, /<a\b[^>]*href=/);

const table = sample((post) => /<table\b/i.test(post.content), 'table');
assert.match(table.html, /<table>/);

const searchIndex = JSON.parse(readFileSync('dist/search-index.json', 'utf8'));
assert.equal(searchIndex.length, posts.length);
assert.ok(searchIndex.some((entry) => entry.slug === 'erazahan-bad'));

const sitemap = readFileSync('dist/sitemap.xml', 'utf8');
assert.equal(posts.filter((post) => sitemap.includes(`/${post.slug}/`)).length, posts.length);

const assetFiles = readdirSync('dist/_astro').map((name) => join('dist/_astro', name));
assert.ok(assetFiles.every((file) => !statSync(file).isFile() || statSync(file).size < 7_000_000));

console.log({
  publicPostRoutes: posts.length,
  searchIndexEntries: searchIndex.length,
  sitemapPostUrls: posts.length,
  regressionSamples: {
    legacy: 'erazahan-bad',
    markdown: markdown.post.slug,
    mixed: mixed.post.slug,
    faq: faq.post.slug,
    link: link.post.slug,
    table: table.post.slug,
  },
});
