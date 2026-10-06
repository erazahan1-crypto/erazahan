import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeJsonForHtmlScript } from '../../src/lib/json-for-html-script.mjs';

const hostile = '</script><script>auditMarker()</script>';
const article = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: `Հայերեն «վերնագիր» ${hostile}`,
  description: 'Ամպեր & "երազներ" \u2028 \u2029',
  articleBody: hostile,
};
const serializedArticle = serializeJsonForHtmlScript(article);
assert.doesNotMatch(serializedArticle, /</, 'JSON-LD never exposes a literal HTML tag opener');
assert.doesNotMatch(serializedArticle, /\u2028|\u2029/, 'JSON-LD escapes JavaScript line separators');
assert.deepEqual(JSON.parse(serializedArticle), article, 'article JSON-LD round-trips without semantic changes');

const articleHtml = `<script type="application/ld+json">${serializedArticle}</script><p id="after">safe</p>`;
assert.equal((articleHtml.match(/<\/script/gi) ?? []).length, 1, 'only the template closing tag terminates the JSON-LD element');
assert.equal(articleHtml.includes('<script>auditMarker()</script>'), false, 'hostile markup cannot become a sibling script element');
assert.deepEqual(JSON.parse(articleHtml.match(/<script type="application\/ld\+json">([\s\S]*)<\/script>/)?.[1] ?? ''), article, 'rendered script content remains valid JSON');

const breadcrumb = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [{ '@type': 'ListItem', position: 1, name: hostile, item: 'https://erazahan.info/' }],
};
assert.deepEqual(JSON.parse(serializeJsonForHtmlScript(breadcrumb)), breadcrumb, 'breadcrumb fields receive the same protection');

const localizedArticle = { '@context': 'https://schema.org', '@type': 'Article', headline: `Русский ${hostile}`, inLanguage: 'ru' };
assert.deepEqual(JSON.parse(serializeJsonForHtmlScript(localizedArticle)), localizedArticle, 'localized JSON-LD projection round-trips unchanged');

const layout = readFileSync('src/layouts/Layout.astro', 'utf8');
const route = readFileSync('src/pages/[...path].astro', 'utf8');
assert.match(layout, /serializeJsonForHtmlScript\(websiteSchema\(\)\)/);
assert.equal((route.match(/serializeJsonForHtmlScript\(/g) ?? []).length, 4, 'every route JSON-LD script uses the shared serializer');
assert.doesNotMatch(`${layout}\n${route}`, /set:html=\{JSON\.stringify\([^}]*Schema/, 'JSON-LD set:html boundaries do not use raw JSON.stringify');

console.log('JSON-LD SCRIPT SAFETY PASS');
