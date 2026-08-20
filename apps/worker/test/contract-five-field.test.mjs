/**
 * The five-field listings contract — Day-4 audit finding F2, resolved on 2026-08-20.
 *
 * `LISTINGS_CONTRACT_FIVE_FIELD` is now the active contract: the live collector was healed in place
 * to extract `ram` and `storage`, the heal was approved at the gate, and a confirming run returned
 * both fields on every row before this was switched on.
 *
 * The tests kept their shape through that change, because what they pin is still true and still
 * worth pinning. `preHealRow` is no longer "what the collector returns today" — it is what the
 * collector returned BEFORE the heal, and the assertion that it scores 0.5556 is what a regression
 * would look like if the healed template were ever lost. That is a stronger guard now than it was
 * as a staging note.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyFhs, parseCollectorContract } from '@weaver/contracts';
import { captureListingBaseline, compareListingBaseline, scoreRun } from '@weaver/validation';

import { COLLECTORS, LISTINGS_BASELINE, LISTINGS_CONTRACT_FIVE_FIELD } from '../dist/seed.js';

/** What the collector returned BEFORE the heal: no `ram`, no `storage`. */
function currentRow(index = 1) {
  return {
    product_name: `AeroBook Pro ${index}`,
    price: { value: 1299 + index, currency: 'USD', symbol: '$' },
    in_stock: true,
    product_page_url: 'https://master-weaver-theta.vercel.app/?layout=v1',
    input: { url: 'https://master-weaver-theta.vercel.app/?layout=v1' },
  };
}

/** What the collector returns once it extracts the two cells the page already carries. */
function fiveFieldRow(index = 1) {
  return { ...currentRow(index), ram: '16 GB', storage: '512 GB' };
}

/** The live duplication: 12 distinct products, each emitted 12 times. */
function listingRun(rowFactory) {
  const out = [];
  for (let copy = 0; copy < 12; copy += 1) {
    for (let i = 1; i <= 12; i += 1) out.push(rowFactory(i));
  }
  return out;
}

test('the staged contract is a valid CollectorContract', () => {
  const parsed = parseCollectorContract(LISTINGS_CONTRACT_FIVE_FIELD);
  assert.deepEqual(
    parsed.fields.map((f) => f.name),
    ['product_name', 'price', 'ram', 'storage', 'in_stock'],
  );
});

test('ram and storage are text — the unit is part of the value the page publishes', () => {
  for (const name of ['ram', 'storage']) {
    const field = LISTINGS_CONTRACT_FIVE_FIELD.fields.find((f) => f.name === name);
    assert.equal(field.type, 'text', `${name} must be text, not number`);
    assert.equal(field.required, true);
  }
});

test('a page carrying all five fields scores a clean 1.0', () => {
  const score = scoreRun(listingRun(fiveFieldRow), LISTINGS_CONTRACT_FIVE_FIELD);
  assert.equal(score.fhs, 1);
  assert.deepEqual(score.failed_fields, []);
});

test('pre-heal output scores BROKEN against it — losing the healed template looks like this', () => {
  const score = scoreRun(listingRun(currentRow), LISTINGS_CONTRACT_FIVE_FIELD);

  // Weights are 2 + 2 + 2 + 2 + 1 = 9. ram and storage score 0, so 5/9.
  assert.ok(Math.abs(score.fhs - 5 / 9) < 1e-4, `expected ~0.5556, got ${score.fhs}`);
  assert.equal(classifyFhs(score.fhs), 'BROKEN');
  assert.deepEqual(score.failed_fields.sort(), ['ram', 'storage']);
});

test('the same output would have stayed HEALTHY against the old three-field contract', () => {
  // Why the contract stayed staged for a day: the collector was not broken, the contract simply
  // described more than the collector could produce. Activating it early would have manufactured a
  // BROKEN band out of nothing and ended the healthy price history.
  const old = {
    ...LISTINGS_CONTRACT_FIVE_FIELD,
    fields: LISTINGS_CONTRACT_FIVE_FIELD.fields.filter(
      (f) => f.name !== 'ram' && f.name !== 'storage',
    ),
  };

  const score = scoreRun(listingRun(currentRow), old);
  assert.equal(score.fhs, 1);
  assert.equal(classifyFhs(score.fhs), 'HEALTHY');
});

test('the seed actually wires the five-field contract to the live collector', () => {
  const listings = COLLECTORS.find((c) => c.name === 'marketplace-listings');
  assert.ok(listings, 'the flagship collector must be seeded');

  assert.deepEqual(
    listings.contract.fields.map((f) => f.name),
    ['product_name', 'price', 'ram', 'storage', 'in_stock'],
    'F2 is only resolved when the contract is wired, not merely defined',
  );
  assert.equal(listings.status, 'ACTIVE');
  assert.equal(listings.contract.collector_id, 'c_mt006kvtc12l54ywn', 'healed in place, same id');
});

test('the seeded intent prompt describes the same five fields the contract declares', () => {
  const listings = COLLECTORS.find((c) => c.name === 'marketplace-listings');
  // `intent_prompt` records what the contract was inferred from. A drift between the two makes the
  // ledger misleading about why the collector extracts what it extracts.
  for (const field of listings.contract.fields) {
    assert.ok(
      listings.intentPrompt.includes(field.name),
      `intent prompt never mentions ${field.name}`,
    );
  }
});

test('the seeded golden baseline records the healed shape, not the pre-heal one', () => {
  assert.ok(LISTINGS_BASELINE.field_shape.includes('ram'));
  assert.ok(LISTINGS_BASELINE.field_shape.includes('storage'));
  assert.deepEqual(
    [...LISTINGS_BASELINE.field_shape].sort(),
    LISTINGS_BASELINE.field_shape,
    'captureListingBaseline emits a sorted shape, so a re-capture must compare equal',
  );

  // Every pinned sample has to carry the new fields too, or the first confirmation run after a
  // repair would compare a five-field row against a three-field memory and fail on our own gap.
  for (const row of LISTINGS_BASELINE.sample_rows) {
    assert.equal(typeof row.ram, 'string');
    assert.equal(typeof row.storage, 'string');
  }
});

test('a five-field golden baseline records the two new fields in its shape', () => {
  const baseline = captureListingBaseline(listingRun(fiveFieldRow), LISTINGS_CONTRACT_FIVE_FIELD);

  assert.equal(baseline.row_count, 12, 'distinct products, not the duplicated row count');
  assert.ok(baseline.field_shape.includes('ram'));
  assert.ok(baseline.field_shape.includes('storage'));
});

test('losing ram and storage after activation is caught by the golden comparison', () => {
  const baseline = captureListingBaseline(listingRun(fiveFieldRow), LISTINGS_CONTRACT_FIVE_FIELD);
  const regressed = compareListingBaseline(
    listingRun(currentRow),
    baseline,
    LISTINGS_CONTRACT_FIVE_FIELD,
    'https://master-weaver-theta.vercel.app/?layout=v1',
  );

  assert.equal(regressed.passed, false);
  assert.ok(regressed.failures.includes('field_shape'));
});
