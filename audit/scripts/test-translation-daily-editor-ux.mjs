import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { ambiguousTranslationWriteMessage, formatTranslationWriteFailure, requestTranslationWrite } from '../../src/lib/admin-translation-write-diagnostics.mjs';
import { parseTranslationImport } from '../../src/lib/translation-import-contract.mjs';

const source = readFileSync('src/pages/admin/translations/edit.astro', 'utf8');
assert.match(source, /data-source-toggle[^>]*type="button"[^>]*aria-expanded="false"[^>]*aria-controls="hy-source-fields"/);
assert.match(source, /id="hy-source-fields" data-source-fields hidden/);
assert.match(source, /data-source-revision/);
assert.match(source, /data-source-fingerprint/);
assert.match(source, /data-outdated-warning/);
assert.match(source, /<input data-draft-field="tags" type="hidden"/);
assert.doesNotMatch(source, /<textarea[^>]*data-draft-field="tags"/);
assert.match(source, /<details[^>]*><summary[^>]*>Advanced: Image alts JSON<\/summary>[\s\S]*?data-draft-field="image_alts"[\s\S]*?<\/details>/);
assert.match(source, /data-internal-link-action/);
assert.match(source, /data-insert-image-action/);

// Execute the actual page controller with a minimal DOM, without loading or writing a server.
class Element {
  value = ''; hidden = false; disabled = false; children = []; attributes = {}; listeners = {};
  textContent = ''; classList = { toggle() {} };
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  focus() { focused = this; }
  querySelectorAll(selector) { return selector === 'button' ? this.children.flatMap((child) => child.children.filter((node) => node.tagName === 'button')) : []; }
}
let focused;
const elements = new Map();
const document = {
  querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
  querySelectorAll() { return []; },
  createElement(tagName) { return Object.assign(new Element(), { tagName }); },
};
const field = (name) => document.querySelector(`[data-draft-field="${name}"]`);
const node = (name) => document.querySelector(`[data-${name}]`);
const requests = [];
const window = {};
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/import \{ prepareSearchIndex, rankPreparedSearch \} from '[^']+';/, '')
  .replace(/import \{ parseTranslationImport \} from '[^']+';/, '')
  .replace(/import \{ ambiguousTranslationWriteMessage, formatTranslationWriteFailure, requestTranslationWrite \} from '[^']+';/, '')
  .replace(/\n    load\(\);\s*$/, '');
const code = stripTypeScriptTypes(script);
const controller = Function('document', 'window', 'location', 'fetch', 'requestTranslationWrite', 'formatTranslationWriteFailure', 'ambiguousTranslationWriteMessage', 'parseTranslationImport', `${code}
  return { initializeDraft, syncDraftFromForm, addTag, saveDraft, canPublish, isDirty,
    publishedLocaleUrl, renderViewOnSite,
    getBuffer: () => structuredClone(draftBuffer),
    reset: (data) => { loadedState = data; localeBlobSha = data.locale_blob_sha; initializeDraft(data); }
  };`)(document, window, { search: '?locale=en' }, async (url, options) => {
  requests.push(JSON.parse(options.body));
  return { ok: false, status: 409, text: async () => JSON.stringify({ ok: false, code: 'STALE_TEST' }) };
}, requestTranslationWrite, formatTranslationWriteFailure, ambiguousTranslationWriteMessage, parseTranslationImport);
const payload = { slug: 'dream', title: 'Dream', description: null, content: 'Text', image_alts: { asset: '', meaningful: 'Localized ALT' }, tags: ['сон', 'Dream'], alphabet_key: 'D' };
const fixture = {
  content_id: 'efa61838-86c8-56b8-815c-0a38b0a83242', locale: 'en', locale_blob_sha: 'a'.repeat(40),
  translation_state: { publication_state: 'DRAFT', draft_synchronization: 'CURRENT' },
  locale_document: { draft: payload, published: null }, slug_locked: false, alphabet_suggestion: 'D',
};
assert.equal(controller.publishedLocaleUrl({ locale: 'ru', locale_document: { draft: null, published: { slug: 'son-ob-utke' } } }), '/ru/son-ob-utke/');
assert.equal(controller.publishedLocaleUrl({ locale: 'en', locale_document: { draft: null, published: { slug: 'duck-dream' } } }), '/en/duck-dream/');
assert.equal(controller.publishedLocaleUrl({ locale: 'ru', locale_document: { draft: { slug: 'draft-only' }, published: null } }), null, 'draft-only never gets a public URL');
assert.equal(controller.publishedLocaleUrl({ locale: 'en', locale_document: { draft: { slug: 'draft' }, published: { slug: 'published' } } }), '/en/published/', 'published-with-draft uses the published slug');
assert.equal(controller.publishedLocaleUrl({ locale: 'hy', locale_document: { draft: null, published: { slug: 'fallback' } } }), null, 'there is no cross-language or HY fallback');
controller.renderViewOnSite({ locale: 'ru', translation_state: { publication_state: 'PUBLISHED' }, locale_document: { draft: null, published: { slug: 'son-ob-utke' } } });
assert.equal(node('view-on-site').hidden, false);
assert.equal(node('view-on-site-link').href, '/ru/son-ob-utke/');
assert.match(node('view-on-site-deployment').textContent, /Cloudflare Pages deployment succeeds/);
controller.renderViewOnSite({ locale: 'en', translation_state: { publication_state: 'PUBLISHED_WITH_DRAFT' }, locale_document: { draft: { slug: 'draft' }, published: { slug: 'published' } } });
assert.equal(node('view-on-site-link').href, '/en/published/');
assert.match(node('view-on-site-version').textContent, /does not include the draft/);
controller.renderViewOnSite({ locale: 'ru', translation_state: { publication_state: 'DRAFT' }, locale_document: { draft: { slug: 'draft-only' }, published: null } });
assert.equal(node('view-on-site').hidden, true);
assert.equal(node('view-on-site-unavailable').hidden, false);
controller.reset(fixture);
assert.equal(controller.isDirty(), false);
assert.equal(controller.canPublish(), true);
assert.deepEqual(JSON.parse(field('tags').value), payload.tags);
assert.equal(node('tag-chips').children.length, 2);
assert.equal(node('tag-chips').children[0].children[1].attributes['aria-label'], 'Remove tag: сон');

const input = node('tag-input');
input.value = '  новый тег  ';
input.listeners.input();
assert.equal(controller.isDirty(), true, 'pending text warns before navigation');
assert.equal(controller.canPublish(), false);
await controller.saveDraft();
assert.equal(requests.length, 0, 'pending text cannot be silently dropped by Save');
let prevented = false;
input.listeners.keydown({ key: 'Enter', isComposing: false, preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.deepEqual(controller.getBuffer().tags, ['сон', 'Dream', 'новый тег']);
assert.equal(focused, input);
assert.equal(requests.length, 0, 'adding a chip never writes');
input.value = ' Dream ';
controller.addTag();
assert.deepEqual(controller.getBuffer().tags, ['сон', 'Dream', 'новый тег']);
input.value = '   ';
controller.addTag();
assert.equal(controller.getBuffer().tags.length, 3);
input.value = 'composition';
input.listeners.keydown({ key: 'Enter', isComposing: true, preventDefault() { assert.fail('IME Enter must not be intercepted'); } });
assert.equal(controller.getBuffer().tags.length, 3);
input.value = '<img src=x onerror=alert(1)>';
controller.addTag();
assert.equal(node('tag-chips').children[3].children[0].textContent, input.value || '<img src=x onerror=alert(1)>');
assert.equal(node('tag-chips').children[3].children[0].children.length, 0, 'tag text is not interpreted as HTML');
node('tag-chips').children[1].children[1].listeners.click();
assert.deepEqual(controller.getBuffer().tags, ['сон', 'новый тег', '<img src=x onerror=alert(1)>']);
assert.equal(focused, node('tag-chips').children[1].children[1]);
await controller.saveDraft();
assert.equal(requests.length, 1);
assert.equal(requests[0].action, 'update_draft');
assert.deepEqual(requests[0].payload, { ...payload, tags: ['сон', 'новый тег', '<img src=x onerror=alert(1)>'] });
assert.equal(requests[0].expected_locale_blob_sha, fixture.locale_blob_sha);

controller.reset(fixture);
field('image_alts').value = '{broken';
controller.syncDraftFromForm();
assert.equal(controller.canPublish(), false);
assert.equal(controller.isDirty(), true);
assert.equal(typeof window.onbeforeunload, 'function');
input.value = 'safe tag'; controller.addTag();
assert.equal(field('image_alts').value, '{broken', 'chip edits preserve invalid raw ALT text');
assert.deepEqual(controller.getBuffer().image_alts, payload.image_alts, 'invalid raw data cannot overwrite good state');
await controller.saveDraft();
assert.equal(requests.length, 1, 'invalid ALT JSON blocks Save');
field('image_alts').value = JSON.stringify(payload.image_alts); controller.syncDraftFromForm();
assert.deepEqual(controller.getBuffer().tags, ['сон', 'Dream', 'safe tag']);
while (node('tag-chips').children.length) node('tag-chips').children[0].children[1].listeners.click();
assert.deepEqual(controller.getBuffer().tags, []);
assert.deepEqual(JSON.parse(field('tags').value), []);
assert.equal(focused, input);
assert.equal(requests.length, 1, 'removing chips never writes');
controller.reset(fixture);
assert.equal(controller.isDirty(), false);
assert.equal(window.onbeforeunload, null);
assert.deepEqual(controller.getBuffer(), payload);
node('source-fields').hidden = true;
node('source-toggle').listeners.click();
assert.equal(node('source-fields').hidden, false);
assert.equal(node('source-toggle').attributes['aria-expanded'], 'true');
node('source-toggle').listeners.click();
assert.equal(node('source-fields').hidden, true);
assert.equal(node('source-toggle').attributes['aria-expanded'], 'false');
assert.equal(controller.isDirty(), false, 'collapse is not a draft mutation');
assert.equal(requests.length, 1);
console.log('TRANSLATION DAILY EDITOR UX PASS');
