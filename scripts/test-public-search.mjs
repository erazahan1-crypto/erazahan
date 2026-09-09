import assert from 'node:assert/strict';
import { normalizeSearchText, prepareSearchIndex, rankPreparedSearch } from '../src/lib/public-search.mjs';

const fixtures = [
  { slug: 'text-only', title: 'Այլ հոդված', text: 'մարդ մարդ մարդ' },
  { slug: 'substring', title: 'Անմարդաբնակ վայր', text: '' },
  { slug: 'inflection', title: 'Մարդիկ', text: '' },
  { slug: 'whole-second', title: 'Տեսնել մարդ երազում', text: '' },
  { slug: 'whole-first', title: 'Մարդ երազում', text: '' },
  { slug: 'base', title: 'Ուրիշ վերնագիր', text: '', baseWord: 'մարդ' },
  { slug: 'metadata', title: 'Բառարան', text: '', keywords: ['մարդ'] },
  { slug: 'exact', title: 'Երազահան Մարդ: Erazahan Mard', text: '' },
  { slug: 'two-letter', title: 'Օձ', text: '' },
];

const prepared = prepareSearchIndex(fixtures);
const ranked = rankPreparedSearch('մարդ', prepared, 20);
const order = ranked.map(({ slug }) => slug);

assert.equal(order[0], 'exact');
assert.ok(order.indexOf('whole-first') < order.indexOf('substring'));
assert.ok(order.indexOf('whole-second') < order.indexOf('substring'));
assert.ok(order.indexOf('base') < order.indexOf('substring'));
assert.ok(order.indexOf('metadata') < order.indexOf('substring'));
assert.ok(order.indexOf('inflection') < order.indexOf('substring'));
assert.ok(order.indexOf('substring') < order.indexOf('text-only'));
assert.equal(rankPreparedSearch('օձ', prepared, 20)[0]?.slug, 'two-letter');
assert.equal(rankPreparedSearch('  «ՄԱՐԴ» — ', prepared, 20)[0]?.slug, 'exact');
assert.equal(normalizeSearchText('  «ՄԱՐԴ»—երազում  '), 'մարդ երազում');
assert.deepEqual(
  rankPreparedSearch('մարդ', prepared, 20).map(({ slug }) => slug),
  order,
  'equal queries must keep a stable order',
);

console.log('Query: մարդ');
console.table(ranked.map(({ title, score, match }) => ({ title, score, match })));
console.log('2-letter Armenian query, punctuation/case normalization, and stable order: OK');
