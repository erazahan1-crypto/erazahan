import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { onRequestGet as getPublishedDreams } from '../functions/api/published-dreams.ts';
import {
  HOMEPAGE_FEATURED_LIMIT,
  selectHomepageFeaturedDreams,
} from '../functions/_lib/featured-dreams.ts';
import {
  onRequestGet as getAdminDream,
  onRequestPost as updateAdminDream,
} from '../functions/api/admin/dreams/[id].ts';

const migration = readFileSync('migrations/0008_add_dream_featured_home.sql', 'utf8');
assert.match(migration, /featured_home INTEGER NOT NULL DEFAULT 0/i);
assert.match(migration, /CHECK\s*\(featured_home IN \(0, 1\)\)/i);
const migrationDatabase = new DatabaseSync(':memory:');
migrationDatabase.exec(`
  CREATE TABLE dream_submissions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    answered_at TEXT
  );
  INSERT INTO dream_submissions (id, status, answered_at)
  VALUES ('existing', 'answered', '2026-01-01T00:00:00.000Z');
`);
migrationDatabase.exec(migration);
assert.equal(
  migrationDatabase.prepare("SELECT featured_home FROM dream_submissions WHERE id = 'existing'").get().featured_home,
  0,
);
migrationDatabase.close();

const record = (id, overrides = {}) => ({
  id,
  dream_text: `**Dream ${id}** <b>private markup</b>`,
  answer_text: `Answer [link](/safe/) ${id}`,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  answered_at: '2026-01-01T00:00:00.000Z',
  status: 'answered',
  featured_home: 1,
  email: `private-${id}@example.com`,
  ip: '192.0.2.1',
  name: 'Private name',
  ...overrides,
});

const fixtureRows = [
  ...Array.from({ length: 8 }, (_, index) => record(`public-${index}`, {
    answered_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  })),
  record('pending', { status: 'pending', answered_at: '2027-01-01T00:00:00.000Z' }),
  record('not-featured', { featured_home: 0, answered_at: '2027-01-02T00:00:00.000Z' }),
  record('empty-answer', { answer_text: '   ', answered_at: '2027-01-03T00:00:00.000Z' }),
];

const cards = selectHomepageFeaturedDreams(fixtureRows);
assert.equal(cards.length, HOMEPAGE_FEATURED_LIMIT);
assert.deepEqual(cards.map((card) => card.url), [7, 6, 5, 4, 3, 2].map((id) => `/chgtnvac-erazner/public-${id}/`));
assert.doesNotMatch(JSON.stringify(cards), /private-|example\.com|192\.0\.2\.1|Private name|dream_text|answer_text|featured_home|\*\*|<b>|\[link\]/);
assert.deepEqual(Object.keys(cards[0]).sort(), ['excerpt', 'title', 'url']);

let featuredQuery = '';
const publicResponse = await getPublishedDreams({
  request: new Request('https://erazahan.info/api/published-dreams?featured=home'),
  env: {
    DREAMS_DB: {
      prepare(query) {
        featuredQuery = query;
        return { all: async () => ({ results: fixtureRows }) };
      },
    },
  },
});
assert.equal(publicResponse.status, 200);
assert.match(featuredQuery, /featured_home = 1/);
assert.match(featuredQuery, /status = 'answered'/);
assert.match(featuredQuery, /TRIM\(answer_text\) <> ''/);
assert.match(featuredQuery, /ORDER BY COALESCE\(answered_at, updated_at, created_at\) DESC/);
assert.match(featuredQuery, /LIMIT 6/);
const publicBody = await publicResponse.json();
assert.equal(publicBody.dreams.length, 6);
assert.doesNotMatch(JSON.stringify(publicBody), /email|\bip\b|name|public-7@example/);
assert.equal(publicBody.dreams[0].url, '/chgtnvac-erazner/public-7/');

const emptyResponse = await getPublishedDreams({
  request: new Request('https://erazahan.info/api/published-dreams?featured=home'),
  env: { DREAMS_DB: { prepare: () => ({ all: async () => ({ results: [] }) }) } },
});
assert.deepEqual(await emptyResponse.json(), { ok: true, dreams: [] });

const homepage = readFileSync('src/pages/index.astro', 'utf8');
assert.match(homepage, /data-featured-dreams-mount/);
assert.match(homepage, /if \(!mount \|\| dreams\.length === 0\) return;/);
assert.match(homepage, /result\.dreams\.length === 0\) return;/);

const adminState = record('admin-record', {
  name: null,
  email: 'admin-test@example.com',
  ai_draft: null,
  notification_sent_at: null,
  seo_index: 0,
  featured_home: 0,
});
const adminDatabase = {
  prepare(query) {
    const statement = {
      values: [],
      bind(...values) {
        this.values = values;
        return this;
      },
      async first() {
        return { ...adminState };
      },
      async run() {
        if (/SET featured_home = \?/i.test(query)) {
          adminState.featured_home = this.values[0];
          adminState.updated_at = this.values[1];
        }
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  },
};

const adminGetResponse = await getAdminDream({
  request: new Request('https://erazahan.info/api/admin/dreams/admin-record'),
  env: { DREAMS_DB: adminDatabase },
  params: { id: 'admin-record' },
});
assert.equal((await adminGetResponse.json()).dream.featured_home, 0);

for (const expected of [true, false]) {
  const response = await updateAdminDream({
    request: new Request('https://erazahan.info/api/admin/dreams/admin-record', {
      method: 'POST',
      headers: { origin: 'https://erazahan.info', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update_featured_home', featured_home: expected }),
    }),
    env: { DREAMS_DB: adminDatabase },
    params: { id: 'admin-record' },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).dream.featured_home, expected ? 1 : 0);
  assert.equal(adminState.seo_index, 0, 'featured_home must not change seo_index');
}

console.log('Featured dreams: migration default, admin read/write, public filtering/order/limit, privacy, and empty state OK');
