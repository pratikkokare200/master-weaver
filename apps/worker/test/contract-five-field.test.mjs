/**
 * The staged five-field listings contract — Day-4 audit finding F2.
 *
 * `LISTINGS_CONTRACT_FIVE_FIELD` is defined but deliberately not wired into the seed, because the
 * live collector cannot yet emit `ram` or `storage` and both routes to making it (a replacement
 * collector, or a heal) are blocked on Bright Data account state. Staged code that nobody exercises
 * rots, so it is verified here instead: the contract is valid, it scores a page that carries the
 * fields, and — the assertion that actually matters — it scores TODAY's collector output below the
 * BROKEN line, which is the whole reason it is not switched on yet.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyFhs, parseCollectorContract } from '@weaver/contracts';
import { captureListingBaseline, compareListingBaseline, scoreRun } from '@weaver/validation';

import { LISTINGS_CONTRACT_FIVE_FIELD } from '../dist/seed.js';

/** What the collector returns today: no `ram`, no `storage`. */
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

test("today's collector output scores BROKEN against it — this is why it is not active", () => {
  const score = scoreRun(listingRun(currentRow), LISTINGS_CONTRACT_FIVE_FIELD);

  // Weights are 2 + 2 + 2 + 2 + 1 = 9. ram and storage score 0, so 5/9.
  assert.ok(Math.abs(score.fhs - 5 / 9) < 1e-4, `expected ~0.5556, got ${score.fhs}`);
  assert.equal(classifyFhs(score.fhs), 'BROKEN');
  assert.deepEqual(score.failed_fields.sort(), ['ram', 'storage']);
});

test('the same output stays HEALTHY against the contract that is actually active', async () => {
  const { LISTINGS_CONTRACT_FIVE_FIELD: staged } = await import('../dist/seed.js');
  // Drop the two staged fields to get back to the live three-field shape.
  const live = { ...staged, fields: staged.fields.filter((f) => f.name !== 'ram' && f.name !== 'storage') };

  const score = scoreRun(listingRun(currentRow), live);
  assert.equal(score.fhs, 1);
  assert.equal(classifyFhs(score.fhs), 'HEALTHY');
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
