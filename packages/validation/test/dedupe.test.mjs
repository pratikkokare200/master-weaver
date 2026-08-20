/**
 * Read-path de-duplication tests — Day-3 audit finding F1.
 *
 * The shape under test is the real one: the live listing collector returns 144 rows carrying 12
 * distinct products, each an exact copy. The case that matters most is the one asserting that the
 * SCORER is untouched by any of this — de-duplicating before scoring would silently rewrite what
 * every historical FHS means.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalRowKey,
  describeDuplication,
  dedupeRows,
  dedupeRowsBy,
  rowIdentity,
  scoreRun,
} from '../dist/index.js';
import { CONTRACT, healthyRow } from './fixtures.mjs';

/** The observed live shape: every product repeated `factor` times, interleaved as the CLI returns them. */
function duplicatedRun(distinct = 12, factor = 12) {
  const out = [];
  for (let copy = 0; copy < factor; copy += 1) {
    for (let i = 1; i <= distinct; i += 1) out.push(healthyRow(i));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The live case
// ---------------------------------------------------------------------------------------------

test('144 rows carrying 12 distinct products collapse to 12', () => {
  const rows = duplicatedRun(12, 12);
  assert.equal(rows.length, 144);
  assert.equal(dedupeRows(rows).length, 12);
});

test('describeDuplication reports the factor without changing anything', () => {
  const report = describeDuplication(duplicatedRun(12, 12));
  assert.deepEqual(report, {
    raw_count: 144,
    distinct_count: 12,
    factor: 12,
    has_duplicates: true,
  });
});

test('a clean run reports a factor of 1 and no duplicates', () => {
  const report = describeDuplication([healthyRow(1), healthyRow(2), healthyRow(3)]);
  assert.equal(report.factor, 1);
  assert.equal(report.has_duplicates, false);
});

test('an empty run does not divide by zero', () => {
  assert.deepEqual(describeDuplication([]), {
    raw_count: 0,
    distinct_count: 0,
    factor: 1,
    has_duplicates: false,
  });
});

// ---------------------------------------------------------------------------------------------
// The scorer must not move
// ---------------------------------------------------------------------------------------------

test('de-duplication does not touch the score — stored rows stay evidence', () => {
  const raw = duplicatedRun(12, 12);
  const deduped = dedupeRows(raw);

  // Same FHS either way: every field is filled on every copy, so duplication is invisible to the
  // measure that catches breakage. That is exactly why it needed a separate tool.
  assert.equal(scoreRun(raw, CONTRACT).fhs, scoreRun(deduped, CONTRACT).fhs);
  // And the raw array is untouched.
  assert.equal(raw.length, 144);
});

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

test('order is preserved, first occurrence wins', () => {
  const a = healthyRow(1);
  const b = healthyRow(2);
  const c = healthyRow(3);
  assert.deepEqual(dedupeRows([c, a, c, b, a]), [c, a, b]);
});

test('key order within a row does not create a false distinct row', () => {
  const forward = { product_name: 'AeroBook Pro 14', price: { value: 1299, currency: 'USD' } };
  const reversed = { price: { currency: 'USD', value: 1299 }, product_name: 'AeroBook Pro 14' };
  assert.equal(canonicalRowKey(forward), canonicalRowKey(reversed));
  assert.equal(dedupeRows([forward, reversed]).length, 1);
});

test('the request echo is ignored, so a batch run over two URLs collapses correctly', () => {
  const fromA = { ...healthyRow(1), input: { url: 'https://example.test/a' } };
  const fromB = { ...healthyRow(1), input: { url: 'https://example.test/b' } };
  assert.equal(dedupeRows([fromA, fromB]).length, 1);
});

test('genuinely different products are never merged', () => {
  // Same name, different storage — a real catalogue shape that a name-only key would destroy.
  const small = { ...healthyRow(1), storage: '512 GB' };
  const large = { ...healthyRow(1), storage: '1024 GB' };
  assert.equal(dedupeRows([small, large]).length, 2);
});

test('rowIdentity is stable when a price moves', () => {
  const before = healthyRow(1);
  const after = { ...before, price: { value: 1149, currency: 'USD', symbol: '$' } };
  assert.equal(rowIdentity(before, CONTRACT), rowIdentity(after, CONTRACT));
  // But the rows themselves are still distinct by content.
  assert.notEqual(canonicalRowKey(before), canonicalRowKey(after));
});

test('rowIdentity falls back to content when the contract declares no text or url identity', () => {
  const numbersOnly = {
    ...CONTRACT,
    fields: [{ name: 'price', type: 'number', required: true, min_fill: 0.9 }],
  };
  const row = healthyRow(1);
  assert.equal(rowIdentity(row, numbersOnly), canonicalRowKey(row));
});

test('rows whose identity fields are all empty fall back to content rather than collapsing together', () => {
  const blankA = { product_name: null, product_url: null, price: { value: 10, currency: 'USD' } };
  const blankB = { product_name: null, product_url: null, price: { value: 20, currency: 'USD' } };
  assert.equal(dedupeRowsBy([blankA, blankB], (r) => rowIdentity(r, CONTRACT)).length, 2);
});

test('null and undefined inputs return an empty array rather than throwing', () => {
  assert.deepEqual(dedupeRows(null), []);
  assert.deepEqual(dedupeRows(undefined), []);
});

test('dedupeRowsBy accepts a caller-supplied key', () => {
  const rows = [healthyRow(1), healthyRow(2), healthyRow(3)];
  // Everything under one key collapses to a single row.
  assert.equal(dedupeRowsBy(rows, () => 'same').length, 1);
});
