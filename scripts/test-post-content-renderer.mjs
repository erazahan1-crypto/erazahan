import assert from 'node:assert/strict';
import {
  detectPostContentFormat,
  plainTextFromPostContent,
  renderPostContent,
} from '../src/lib/render-post-content.ts';

const fixtures = {
  html: '<h2>Legacy</h2><p>Visible <strong>HTML</strong>.</p>',
  markdown: '## Markdown\n\n**Visible** [internal](/target/) and [external](https://example.com).',
  mixed: '<h2>Mixed</h2>\n\n**Visible Markdown** beside <em>HTML</em>.',
  faq: '<p>Visible FAQ intro.</p><script type="application/ld+json">{"@type":"FAQPage"}</script>',
  image: '![Useful alt](/uploads/example.webp)',
  internalLink: '[Internal](/target/)',
  table: '| A | B |\n|---|---|\n| 1 | 2 |',
};

assert.equal(detectPostContentFormat(fixtures.html), 'html');
assert.equal(detectPostContentFormat(fixtures.markdown), 'markdown');
assert.equal(detectPostContentFormat(fixtures.mixed), 'mixed');

for (const [name, source] of Object.entries(fixtures)) {
  const html = renderPostContent(source);
  assert.ok(html.trim(), `${name}: public HTML must not be empty`);
}

assert.match(renderPostContent(fixtures.markdown), /<h2>Markdown<\/h2>/);
assert.match(renderPostContent(fixtures.markdown), /<a href="\/target\/">internal<\/a>/);
assert.match(renderPostContent(fixtures.mixed), /<strong>Visible Markdown<\/strong>/);
assert.doesNotMatch(renderPostContent(fixtures.faq), /FAQPage|application\/ld\+json|<script/i);
assert.match(renderPostContent(fixtures.image), /<img src="\/uploads\/example\.webp" alt="Useful alt"/);
assert.match(
  renderPostContent('<img src="https://images.erazahan.info/posts/erazahan-bad.webp" alt="Duck" width="1600" height="1067" loading="lazy" decoding="async" onclick="bad()" style="width:100%">'),
  /<img src="https:\/\/images\.erazahan\.info\/posts\/erazahan-bad\.webp" alt="Duck" width="1600" height="1067" loading="lazy" decoding="async" \/>/,
);
assert.match(renderPostContent(fixtures.table), /<table>/);

const hostile = renderPostContent(`
<style>body { display: none }</style>
<script>alert(1)</script>
<iframe srcdoc="<script>alert(2)</script>"></iframe>
<object data="https://example.com/evil"></object>
<p onclick="alert(3)" style="background:url(javascript:alert(4))">Safe text</p>
<a href="javascript:alert(5)" onmouseover="alert(6)">Bad link</a>
<img src="data:text/html;base64,evil" onerror="alert(7)" alt="safe alt">
`);
assert.match(hostile, /Safe text/);
assert.doesNotMatch(hostile, /script|style=|onclick|onmouseover|onerror|javascript:|data:text|srcdoc|iframe|object/i);

const plainTextCases = [
  ['plain text', 'Պարզ հայկական տեքստ։', 'Պարզ հայկական տեքստ։'],
  ['Markdown link', '[բադ](/erazahan-bad-spanel/)', 'բադ'],
  ['bold and italic', '**թավ** և *շեղ* ու _ընդգծված_', 'թավ և շեղ ու ընդգծված'],
  ['blockquote', '> Մեջբերված տեքստ։', 'Մեջբերված տեքստ։'],
  ['raw HTML', '<p>HTML <strong>տեքստ</strong> &amp; նշան։</p>', 'HTML տեքստ & նշան։'],
  ['images', 'Սկիզբ ![alt](/image.webp) <img src="/other.webp" alt="other"> Վերջ։', 'Սկիզբ Վերջ։'],
  [
    'mixed Markdown and HTML',
    '## Վերնագիր\n\n> **Խառը** <em>HTML</em>\n\n- Առաջին\n- Երկրորդ\n\n`կոդ`',
    'Վերնագիր Խառը HTML Առաջին Երկրորդ կոդ',
  ],
];

for (const [name, source, expected] of plainTextCases) {
  assert.equal(plainTextFromPostContent(source), expected, name);
}

const malformedImageBlock = `Հին տեքստ։

> **«<img src="https://images.erazahan.info/posts/erazahan-bad.webp" alt="Բադ">։**

Հաջորդ տեքստ։`;
assert.equal(
  plainTextFromPostContent(malformedImageBlock),
  'Հին տեքստ։ Հաջորդ տեքստ։',
  'an image-only Markdown block must not leave wrapper punctuation in plain text',
);

console.log('Post renderer and plain-text excerpts: HTML, Markdown, images, links, blocks, and sanitization OK');
