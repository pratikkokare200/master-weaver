/**
 * Field Health Score tests.
 *
 * The arithmetic is hand-computed against the doc 01 §3.1 contract, whose weights are
 * 2 + 2 + 1 + 2 = 7, so every expected FHS below can be checked by reading it. The partial-break
 * case is the one to look at first: it reproduces the demo's own break and lands on 0.80, in the
 * DEGRADED band, which is the number the whole tiering decision in §3.2 hangs on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { CollectorContractSchema, EMPTY_CANARY_FHS, classifyFhs } from '@weaver/contracts';

import { evaluateField, fhsScorer, scoreCanary, scoreFhs, scoreRun } from '../dist/index.js';
import { CONTRACT, TOTAL_WEIGHT, deepFreeze, rows } from './fixtures.mjs';

/** Float-tolerant comparison, so a hand-computed expectation can be written as the fraction it is. */
function approx(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message ?? 'value'}: expected ~${expected}, got ${actual}`,
  );
}

// ---------------------------------------------------------------------------------------------
// The fixture is a real contract
// ---------------------------------------------------------------------------------------------

test('the test contract parses as a real CollectorContract', () => {
  assert.doesNotThrow(() => CollectorContractSchema.parse(CONTRACT));
  const weights = CONTRACT.fields.reduce((sum, f) => sum + (f.required ? 2 : 1), 0);
  assert.equal(weights, TOTAL_WEIGHT);
});

// ---------------------------------------------------------------------------------------------
// The happy path, and the nested price
// ---------------------------------------------------------------------------------------------

test('a healthy run scores 1.0 with no failed fields', () => {
  const result = scoreRun(rows(10), CONTRACT);

  assert.equal(result.fhs, 1);
  assert.deepEqual(result.failed_fields, []);
  assert.deepEqual(result.field_scores, {
    product_name: 1,
    price: 1,
    in_stock: 1,
    product_url: 1,
  });
});

test('the nested price envelope scores as the number inside it', () => {
  // Every row's price is `{ value, currency, symbol }`. Scored as-is that object is not a number,
  // so a scorer without extraction would report price 0 and drag a perfect run to 5/7 = 0.714.
  const result = scoreRun(rows(10), CONTRACT);
  assert.equal(result.field_scores.price, 1);
  assert.ok(!result.failed_fields.includes('price'));

  const priceField = CONTRACT.fields[1];
  const detail = evaluateField(rows(10), priceField);
  assert.equal(detail.fill_rate, 1);
  assert.equal(detail.type_pass, 1);
  assert.equal(detail.weight, 2);
});

// ---------------------------------------------------------------------------------------------
// Nulls
// ---------------------------------------------------------------------------------------------

test('nulls are penalised through fill_rate — the demo break scores 0.80, DEGRADED', () => {
  // Doc 01 §3.3: one field's location moves, so price returns empty on 70% of rows while the other
  // three fields keep working. A null check on the first row would call this healthy.
  const broken = rows(10, (row, i) => (i < 7 ? { ...row, price: null } : row));
  const result = scoreRun(broken, CONTRACT);

  assert.equal(result.field_scores.price, 0.3);
  assert.equal(result.field_scores.product_name, 1);
  approx(result.fhs, 5.6 / TOTAL_WEIGHT, 'fhs');
  assert.equal(result.fhs, 0.8);
  assert.deepEqual(result.failed_fields, ['price']);
  assert.equal(classifyFhs(result.fhs), 'DEGRADED');
});

test('every flavour of empty counts against fill_rate identically', () => {
  const empties = [null, undefined, '', '   ', 'N/A', 'null', [], {}, { value: null }];
  const broken = rows(10, (row, i) => (i < empties.length ? { ...row, price: empties[i] } : row));

  const detail = evaluateField(broken, CONTRACT.fields[1]);
  assert.equal(detail.fill_rate, 0.1);
  assert.equal(detail.field_score, 0.1);
});

test('a field missing from every row scores 0 without throwing', () => {
  const broken = rows(10, (row) => {
    const { price, ...rest } = row;
    return rest;
  });
  const result = scoreRun(broken, CONTRACT);

  assert.equal(result.field_scores.price, 0);
  approx(result.fhs, 5 / TOTAL_WEIGHT, 'fhs');
  assert.deepEqual(result.failed_fields, ['price']);
});

test('type_pass is 1 when nothing was filled, so the ledger reads "empty" not "wrong type"', () => {
  const broken = rows(4, (row) => ({ ...row, price: null }));
  const detail = evaluateField(broken, CONTRACT.fields[1]);

  assert.equal(detail.fill_rate, 0);
  assert.equal(detail.type_pass, 1);
  assert.equal(detail.field_score, 0);
  assert.equal(detail.below_min_fill, true);
});

// ---------------------------------------------------------------------------------------------
// Type mismatches
// ---------------------------------------------------------------------------------------------

test('values that are present but the wrong type are penalised through type_pass', () => {
  // The classic: the selector shifts one node and starts returning the stock label as the price.
  const broken = rows(10, (row, i) => (i < 4 ? { ...row, price: 'Out of Stock' } : row));
  const detail = evaluateField(broken, CONTRACT.fields[1]);

  assert.equal(detail.fill_rate, 1);
  assert.equal(detail.type_pass, 0.6);
  assert.equal(detail.field_score, 0.6);

  approx(scoreRun(broken, CONTRACT).fhs, 6.2 / TOTAL_WEIGHT, 'fhs');
});

test('a number outside the declared range fails type_pass', () => {
  // Contract range is [1, 100000]. A price of 0 parses as a number but is the "scraped the shipping
  // cost" failure doc 01 §3.4 relies on catching.
  const broken = rows(10, (row, i) => (i < 5 ? { ...row, price: { value: 0, currency: 'USD' } } : row));
  const detail = evaluateField(broken, CONTRACT.fields[1]);

  assert.equal(detail.fill_rate, 1);
  assert.equal(detail.type_pass, 0.5);
});

test('a relative URL fails a field contracted as absolute', () => {
  const broken = rows(10, (row, i) => (i < 5 ? { ...row, product_url: '/p/1' } : row));
  const detail = evaluateField(broken, CONTRACT.fields[3]);

  assert.equal(detail.fill_rate, 1);
  assert.equal(detail.type_pass, 0.5);
  assert.equal(detail.below_min_fill, true);
});

test('an out-of-stock boolean is a value, not a gap', () => {
  // `false` must count as filled. If it did not, every out-of-stock product would look like breakage.
  const mixed = rows(10, (row, i) => ({ ...row, in_stock: i % 2 === 0 ? false : 'Out of Stock' }));
  const detail = evaluateField(mixed, CONTRACT.fields[2]);

  assert.equal(detail.fill_rate, 1);
  assert.equal(detail.type_pass, 1);
  assert.equal(scoreRun(mixed, CONTRACT).fhs, 1);
});

// ---------------------------------------------------------------------------------------------
// Weighting
// ---------------------------------------------------------------------------------------------

test('required fields weigh double', () => {
  const twoField = {
    ...CONTRACT,
    fields: [
      { name: 'must', type: 'text', required: true, min_fill: 0.9 },
      { name: 'nice', type: 'text', required: false, min_fill: 0.5 },
    ],
  };
  const onlyOptional = [{ must: null, nice: 'present' }];
  const onlyRequired = [{ must: 'present', nice: null }];

  // (2×0 + 1×1) / 3 vs (2×1 + 1×0) / 3 — the same one-of-two fields working, twice the score.
  approx(scoreRun(onlyOptional, twoField).fhs, 1 / 3, 'optional only');
  approx(scoreRun(onlyRequired, twoField).fhs, 2 / 3, 'required only');
});

test('below_min_fill compares field_score against the field’s own min_fill', () => {
  // in_stock is optional with min_fill 0.50. Exactly 0.50 is not below it.
  const half = rows(10, (row, i) => (i < 5 ? { ...row, in_stock: null } : row));
  const result = scoreRun(half, CONTRACT);

  assert.equal(result.field_scores.in_stock, 0.5);
  assert.deepEqual(result.failed_fields, []);

  const under = rows(10, (row, i) => (i < 6 ? { ...row, in_stock: null } : row));
  assert.deepEqual(scoreRun(under, CONTRACT).failed_fields, ['in_stock']);
});

// ---------------------------------------------------------------------------------------------
// Empty and malformed input
// ---------------------------------------------------------------------------------------------

test('an empty run scores 0 and fails every field', () => {
  const result = scoreRun([], CONTRACT);

  assert.equal(result.fhs, 0);
  assert.deepEqual(result.failed_fields, ['product_name', 'price', 'in_stock', 'product_url']);
  assert.deepEqual(Object.values(result.field_scores), [0, 0, 0, 0]);
  assert.equal(classifyFhs(result.fhs), 'BROKEN');
});

test('rows that are not an array, or not objects, score 0 rather than throwing', () => {
  for (const input of [null, undefined, 'not rows', 42, {}]) {
    assert.equal(scoreRun(input, CONTRACT).fhs, 0, `${JSON.stringify(input)} should score 0`);
  }
  assert.equal(scoreRun([null, undefined, 'row', 42, []], CONTRACT).fhs, 0);
});

test('one malformed row among healthy ones costs exactly one row', () => {
  const withJunk = [...rows(9), null];
  const result = scoreRun(withJunk, CONTRACT);

  assert.equal(result.field_scores.price, 0.9);
  approx(result.fhs, 0.9, 'fhs');
});

test('a contract with no fields scores 0, never a vacuous 1', () => {
  const empty = { ...CONTRACT, fields: [] };
  const result = scoreRun(rows(10), empty);

  assert.equal(result.fhs, 0);
  assert.deepEqual(result.field_scores, {});
});

// ---------------------------------------------------------------------------------------------
// Run-level penalties
// ---------------------------------------------------------------------------------------------

test('the row penalty scales a short run down and never rewards a long one', () => {
  const healthy = rows(5);

  assert.equal(scoreFhs(healthy, CONTRACT, { trailingMedianRowCount: 10 }).fhs, 0.5);
  assert.equal(scoreFhs(healthy, CONTRACT, { trailingMedianRowCount: 5 }).fhs, 1);
  assert.equal(scoreFhs(healthy, CONTRACT, { trailingMedianRowCount: 2 }).fhs, 1);
  // No history on a first run, so no penalty.
  assert.equal(scoreFhs(healthy, CONTRACT, { trailingMedianRowCount: null }).fhs, 1);
  assert.equal(scoreFhs(healthy, CONTRACT).fhs, 1);
});

test('the golden penalty multiplies through, and both penalties compose', () => {
  const healthy = rows(10);

  assert.equal(scoreFhs(healthy, CONTRACT, { goldenSetMatchRate: 2 / 3 }).fhs, 0.666667);
  assert.equal(scoreFhs(healthy, CONTRACT, { goldenSetMatchRate: 0 }).fhs, 0);

  const both = scoreFhs(healthy, CONTRACT, {
    trailingMedianRowCount: 20,
    goldenSetMatchRate: 0.5,
  });
  approx(both.fhs, 1 * 0.5 * 0.5, 'composed penalties');
  assert.equal(both.fhs_raw, 1);
  assert.equal(both.row_penalty, 0.5);
  assert.equal(both.golden_penalty, 0.5);
});

test('the full breakdown reports everything the ledger needs', () => {
  const broken = rows(10, (row, i) => (i < 7 ? { ...row, price: null } : row));
  const breakdown = scoreFhs(broken, CONTRACT, { trailingMedianRowCount: 10, goldenSetMatchRate: 1 });

  assert.equal(breakdown.row_count, 10);
  assert.equal(breakdown.trailing_median_row_count, 10);
  assert.equal(breakdown.band, 'DEGRADED');
  assert.equal(breakdown.fhs, breakdown.fhs_raw);
  assert.equal(breakdown.field_scores.length, 4);
  assert.deepEqual(Object.keys(breakdown.field_scores[1]).sort(), [
    'below_min_fill',
    'field_score',
    'fill_rate',
    'type_pass',
    'weight',
    'field',
  ].sort());
});

// ---------------------------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------------------------

test('scoreRun returns exactly the three documented keys', () => {
  const result = scoreRun(rows(3), CONTRACT);
  assert.deepEqual(Object.keys(result).sort(), ['failed_fields', 'fhs', 'field_scores'].sort());
  assert.deepEqual(Object.keys(result.field_scores), CONTRACT.fields.map((f) => f.name));
  assert.ok(Array.isArray(result.failed_fields));
  assert.equal(typeof result.fhs, 'number');
});

test('scoring is pure — it never touches its inputs and repeats exactly', () => {
  const input = deepFreeze(rows(10, (row, i) => (i < 3 ? { ...row, price: null } : row)));
  const contract = deepFreeze(structuredClone(CONTRACT));

  const first = scoreRun(input, contract);
  const second = scoreRun(input, contract);

  assert.deepEqual(first, second);
  assert.equal(input.length, 10);
});

test('scoreCanary skips the golden penalty and rejects an empty sample', () => {
  assert.equal(scoreCanary([], CONTRACT).fhs, EMPTY_CANARY_FHS);
  assert.equal(scoreCanary(null, CONTRACT).fhs, EMPTY_CANARY_FHS);
  assert.equal(scoreCanary(undefined, CONTRACT).fhs, EMPTY_CANARY_FHS);

  // A 3-row canary is not penalised for being smaller than a 40-row production run.
  assert.equal(scoreCanary(rows(3), CONTRACT).fhs, 1);
});

test('fhsScorer implements the FhsScorer interface from @weaver/contracts', () => {
  assert.equal(typeof fhsScorer.score, 'function');
  const viaInterface = fhsScorer.score(rows(10), CONTRACT, { goldenSetMatchRate: 0.5 });
  const direct = scoreFhs(rows(10), CONTRACT, { goldenSetMatchRate: 0.5 });
  assert.deepEqual(viaInterface, direct);
});

// ---------------------------------------------------------------------------------------------
// Real CLI output
// ---------------------------------------------------------------------------------------------

test('a captured Bright Data run scores healthy end to end', (t) => {
  const path = fileURLToPath(new URL('../../../docs/samples/run_v1.json', import.meta.url));
  let capturedRows;
  try {
    capturedRows = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    t.skip('docs/samples/run_v1.json not available');
    return;
  }

  // The field names the CLI actually returned, not the doc's illustrative ones.
  const contract = {
    ...CONTRACT,
    fields: [
      { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
      { name: 'price', type: 'number', required: true, min_fill: 0.9, range: [1, 100000] },
      { name: 'ram', type: 'text', required: false, min_fill: 0.5 },
      { name: 'stock', type: 'boolean', required: false, min_fill: 0.5 },
      { name: 'product_page_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
      { name: 'input.url', type: 'url', required: false, min_fill: 0.95, absolute: true },
    ],
  };

  const result = scoreRun(capturedRows, contract);

  assert.equal(capturedRows.length, 24);
  assert.equal(result.fhs, 1, `expected a clean run, got ${JSON.stringify(result)}`);
  assert.deepEqual(result.failed_fields, []);
  // Both "In Stock" and "Out of Stock" appear in this capture, and neither is a gap.
  assert.equal(result.field_scores.stock, 1);
});
