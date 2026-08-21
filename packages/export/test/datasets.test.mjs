import assert from 'node:assert/strict';
import test from 'node:test';

import { episodesSheet, rowsSheet, runsSheet } from '../dist/datasets.js';
import { safeFilename } from '../dist/index.js';

const CONTRACT = {
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.9 },
    { name: 'price', type: 'number', required: true, min_fill: 0.9 },
    { name: 'ram', type: 'text', required: false, min_fill: 0.8 },
  ],
};

const row = (over = {}) => ({
  product_name: 'Nova Ultralight 13',
  price: { value: 1299, currency: 'USD', symbol: '$' },
  ram: '16GB',
  product_page_url: 'https://example.test/nova',
  ...over,
});

const labels = (sheet) => sheet.columns.map((column) => column.label);

// -------------------------------------------------------------------------------------------
// Rows
// -------------------------------------------------------------------------------------------

test('the money envelope becomes a value column and a currency column', () => {
  const sheet = rowsSheet([row()], { contract: CONTRACT });
  assert.deepEqual(labels(sheet), [
    'Product name',
    'Price',
    'Price currency',
    'Ram',
    'Product page url',
  ]);
  assert.deepEqual(sheet.rows[0], ['Nova Ultralight 13', 1299, 'USD', '16GB', 'https://example.test/nova']);
});

test('a price is a number, so the column sums', () => {
  const sheet = rowsSheet([row()], { contract: CONTRACT });
  assert.equal(typeof sheet.rows[0][1], 'number');
  assert.equal(sheet.columns[1].format, 'money');
});

test('contract fields come first, in contract order; extra fields follow', () => {
  const sheet = rowsSheet([{ extra: 'x', ram: '8GB', product_name: 'A', price: 10 }], {
    contract: CONTRACT,
  });
  assert.deepEqual(labels(sheet), ['Product name', 'Price', 'Ram', 'Extra']);
});

test('a field outside the contract is exported, not dropped', () => {
  const sheet = rowsSheet([row()], { contract: CONTRACT });
  assert.ok(labels(sheet).includes('Product page url'));
});

test('rows are de-duplicated on the read path, as every reader does', () => {
  const twelve = Array.from({ length: 12 }, () => row());
  assert.equal(rowsSheet(twelve, { contract: CONTRACT }).rows.length, 1);
  assert.equal(rowsSheet(twelve, { contract: CONTRACT, dedupe: false }).rows.length, 12);
});

test('a missing value is null, not an empty string', () => {
  const sheet = rowsSheet([row({ ram: null })], { contract: CONTRACT });
  assert.equal(sheet.rows[0][3], null);
});

test('an envelope that arrived without its value is shown as JSON, not [object Object]', () => {
  const sheet = rowsSheet([row({ price: { currency: 'USD', symbol: '$' } })], { contract: CONTRACT });
  assert.equal(sheet.rows[0][1], '{"currency":"USD","symbol":"$"}');
  assert.equal(sheet.rows[0][2], 'USD');
});

test('false and 0 survive — an out-of-stock product is not a missing one', () => {
  const sheet = rowsSheet([{ in_stock: false, discount: 0 }]);
  assert.deepEqual(sheet.rows[0], [false, 0]);
});

test('a collector with no contract still exports every key it returned', () => {
  const sheet = rowsSheet([{ a: 1 }, { b: 2 }]);
  assert.deepEqual(labels(sheet), ['A', 'B']);
  assert.deepEqual(sheet.rows, [
    [1, null],
    [null, 2],
  ]);
});

// -------------------------------------------------------------------------------------------
// Runs
// -------------------------------------------------------------------------------------------

test('the run ledger keeps unhealthy runs — the dips are the point', () => {
  const sheet = runsSheet([
    {
      started_at: '2026-08-21T10:00:00.000Z',
      finished_at: '2026-08-21T10:00:12.500Z',
      run_state: 'BROKEN',
      fhs: '0.083333',
      row_count: 12,
      credits_spent: '1.5',
    },
  ]);

  const [started, finished, duration, state, fhs, rows, credits] = sheet.rows[0];
  assert.ok(started instanceof Date);
  assert.ok(finished instanceof Date);
  assert.equal(duration, 12.5);
  assert.equal(state, 'BROKEN');
  assert.equal(fhs, 0.083333);
  assert.equal(rows, 12);
  assert.equal(credits, 1.5);
});

test('numeric arrives from Postgres as a string and is parsed, not concatenated', () => {
  const sheet = runsSheet([
    {
      started_at: new Date('2026-08-21T10:00:00.000Z'),
      finished_at: null,
      run_state: 'RUNNING',
      fhs: null,
      row_count: null,
      credits_spent: null,
    },
  ]);
  assert.equal(sheet.rows[0][1], null);
  assert.equal(sheet.rows[0][2], null, 'an unfinished run has no duration');
  assert.equal(sheet.rows[0][4], null, 'an unscored run has no FHS, which is not zero');
});

test('FHS is formatted to six decimals so the band boundary stays visible', () => {
  const sheet = runsSheet([]);
  assert.equal(sheet.columns.find((c) => c.label === 'FHS').format, 'fhs');
});

// -------------------------------------------------------------------------------------------
// Episodes
// -------------------------------------------------------------------------------------------

const EPISODE = {
  triggered_at: '2026-08-21T09:00:00.000Z',
  resolved_at: '2026-08-21T09:01:00.000Z',
  trigger_reason: 'BROKEN',
  authorised_by: 'AUTONOMOUS',
  final_state: 'QUARANTINED',
  fhs_before: '0.083333',
  fhs_after: null,
  credits_spent: '3',
  duration_ms: 41_200,
  failed_fields: ['ram', 'storage'],
  attempts: [
    {
      attempt_no: 1,
      canary_fhs: '0.710000',
      decision: 'REJECTED',
      rejection_reason: 'canary 0.71 below gate 0.90',
      description_sent: 'first diagnosis',
    },
    {
      attempt_no: 2,
      canary_fhs: '1.000000',
      decision: 'APPROVED',
      rejection_reason: null,
      description_sent: 'refined diagnosis',
    },
  ],
};

test('one row per ATTEMPT — rejected then approved is the sequence worth reading', () => {
  const sheet = episodesSheet([EPISODE]);
  assert.equal(sheet.rows.length, 2);
  assert.equal(sheet.rows[0][7], 1);
  assert.equal(sheet.rows[0][9], 'REJECTED');
  assert.equal(sheet.rows[1][7], 2);
  assert.equal(sheet.rows[1][9], 'APPROVED');
});

test('rejected attempts are never filtered out', () => {
  const decisions = episodesSheet([EPISODE]).rows.map((r) => r[9]);
  assert.deepEqual(decisions, ['REJECTED', 'APPROVED']);
});

test('episode columns repeat down its attempts, so the sheet pivots', () => {
  const [first, second] = episodesSheet([EPISODE]).rows;
  assert.deepEqual(first.slice(0, 7), second.slice(0, 7));
  assert.equal(first[6], 'ram, storage');
});

test('an episode the breaker refused has no attempts and still gets a row', () => {
  const refused = { ...EPISODE, attempts: [], final_state: 'QUARANTINED' };
  const sheet = episodesSheet([refused]);
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0][7], null, 'no attempt number');
  assert.equal(sheet.rows[0][3], 'QUARANTINED');
});

test('an episode still in flight reads as in progress, not as a verdict', () => {
  const open = { ...EPISODE, final_state: null, resolved_at: null };
  assert.equal(episodesSheet([open]).rows[0][3], 'IN PROGRESS');
});

test('duration is seconds to one decimal, from milliseconds', () => {
  assert.equal(episodesSheet([EPISODE]).rows[0][13], 41.2);
});

// -------------------------------------------------------------------------------------------
// Filenames
// -------------------------------------------------------------------------------------------

test('filenames survive a collector name with punctuation in it', () => {
  assert.equal(safeFilename(['marketplace listings', 'rows'], 'csv'), 'marketplace-listings_rows.csv');
  assert.equal(safeFilename(['../../etc/passwd'], 'csv'), 'etc-passwd.csv');
  assert.equal(safeFilename([''], 'csv'), 'export.csv');
});

test('Windows reserved device names are not usable as filenames', () => {
  assert.equal(safeFilename(['nul'], 'csv'), 'export.csv');
  assert.equal(safeFilename(['COM1'], 'xlsx'), 'export.xlsx');
});

test('echo keys are not columns — `input` is the request, not the data', () => {
  const sheet = rowsSheet([{ product_name: 'A', input: 'https://target.test/?layout=v1' }]);
  assert.deepEqual(labels(sheet), ['Product name']);
});
