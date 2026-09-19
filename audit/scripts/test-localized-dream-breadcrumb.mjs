import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localizedDreamBreadcrumb } from '../../src/lib/localized-dream-breadcrumb.mjs';

const entry = (title, alphabetKey) => ({ published: { title, alphabet_key: alphabetKey } });

assert.deepEqual(localizedDreamBreadcrumb('en', entry('Tar Musical Instrument Dream Meaning', 'T')), [
  { href: '/en/', label: 'Home' },
  { href: '/en/letter/', label: 'Alphabet' },
  { href: '/en/letter/t/', label: 'T' },
  { href: null, label: 'Tar Musical Instrument Dream Meaning' },
]);
assert.deepEqual(localizedDreamBreadcrumb('ru', entry('Title does not choose the letter', '\u0401')), [
  { href: '/ru/', label: '\u0413\u043b\u0430\u0432\u043d\u0430\u044f' },
  { href: '/ru/letter/', label: '\u0410\u043b\u0444\u0430\u0432\u0438\u0442' },
  { href: '/ru/letter/\u0451/', label: '\u0401' },
  { href: null, label: 'Title does not choose the letter' },
]);
assert.deepEqual(localizedDreamBreadcrumb('en', entry('No manual key', null)), [
  { href: '/en/', label: 'Home' },
  { href: '/en/letter/', label: 'Alphabet' },
  { href: null, label: 'No manual key' },
]);

const component = readFileSync('src/components/LocalizedDreamBreadcrumb.astro', 'utf8');
const enPage = readFileSync('src/pages/en/[slug].astro', 'utf8');
const ruPage = readFileSync('src/pages/ru/[slug].astro', 'utf8');
assert.match(component, /<nav aria-label="Breadcrumb"/);
assert.match(component, /aria-current="page"/);
assert.match(component, /item\.href \?/);
assert.match(enPage, /<LocalizedDreamBreadcrumb locale="en" entry=\{entry\} \/>/);
assert.match(ruPage, /<LocalizedDreamBreadcrumb locale="ru" entry=\{entry\} \/>/);

const enHtml = readFileSync('dist/en/tar-musical-instrument-dream-meaning/index.html', 'utf8');
const breadcrumbArrow = String.fromCodePoint(0x2192);
const mojibakeSeparator = String.fromCodePoint(0x0432, 0x2020, 0x2019);
assert.match(enHtml, /<nav aria-label="Breadcrumb"/);
assert.ok(enHtml.includes(breadcrumbArrow), 'generated breadcrumb contains U+2192 RIGHTWARDS ARROW');
assert.equal(enHtml.includes(mojibakeSeparator), false, 'generated breadcrumb excludes the malformed separator');
for (const href of ['/en/', '/en/letter/', '/en/letter/t/']) assert.ok(enHtml.includes(`href="${href}"`));
assert.match(enHtml, /aria-current="page"[^>]*>Tar Musical Instrument Dream Meaning<\/span>/);
assert.equal(enHtml.includes('href="/en/tar-musical-instrument-dream-meaning/"'), false, 'current breadcrumb item is not self-linked');
assert.match(enHtml, /<meta name="robots" content="noindex, nofollow">/);
console.log('LOCALIZED DREAM BREADCRUMB PASS');
