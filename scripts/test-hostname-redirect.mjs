import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.ts';
import { productionRedirectLocation } from '../functions/_lib/hostname-redirect.ts';

assert.equal(
  productionRedirectLocation('https://erazahan.pages.dev/'),
  'https://erazahan.info/',
);
assert.equal(
  productionRedirectLocation('https://erazahan.pages.dev/erazahan-bad/'),
  'https://erazahan.info/erazahan-bad/',
);
assert.equal(
  productionRedirectLocation('https://erazahan.pages.dev/erazahan-bad/?x=1&name=%D4%B5'),
  'https://erazahan.info/erazahan-bad/?x=1&name=%D4%B5',
);

for (const url of [
  'https://erazahan.info/',
  'https://erazahan.info/admin/posts/',
  'https://erazahan.info/api/dreams',
  'https://images.erazahan.info/posts/example.webp',
  'https://not-erazahan.pages.dev/',
]) {
  assert.equal(productionRedirectLocation(url), null, `${url} must not redirect`);
}

let nextCalls = 0;
const redirected = await onRequest({
  request: new Request('https://erazahan.pages.dev/erazahan-bad/?x=1'),
  next: async () => {
    nextCalls += 1;
    return new Response('unexpected');
  },
});
assert.equal(redirected.status, 301);
assert.equal(redirected.headers.get('location'), 'https://erazahan.info/erazahan-bad/?x=1');
assert.equal(nextCalls, 0, 'Pages hostname must redirect before downstream handlers run');

for (const url of [
  'https://erazahan.info/',
  'https://erazahan.info/admin/posts/',
  'https://erazahan.info/api/dreams',
]) {
  const response = await onRequest({
    request: new Request(url),
    next: async () => {
      nextCalls += 1;
      return new Response('normal response', { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'normal response');
}
assert.equal(nextCalls, 3, 'Production requests must continue through the normal Pages chain');

console.log('Hostname redirect: 301, path/query preservation, production pass-through, and host isolation OK');
