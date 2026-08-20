/**
 * Diagnosis builder tests — doc 01 §5.
 *
 * The hard constraint is the 1000-character cap: the CLI rejects anything longer, and finding that
 * out at the heal call means an episode that did all its detection work and produced nothing. So the
 * cap is tested against deliberately hostile input — a huge page context, fourteen broken fields,
 * absurd field names — and the truncation ORDER is tested too, because the spec is specific about
 * what gets sacrificed first and what must never be sacrificed at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CLI_INPUT_LIMITS } from '@weaver/contracts';
import { scoreFhs } from '@weaver/validation';

import {
  buildDiagnosis,
  buildEvidence,
  diagnose,
  extractPageContext,
  refineDiagnosis,
  renderExample,
} from '../dist/index.js';

const MAX = CLI_INPUT_LIMITS.DIAGNOSIS_CHARS;

const CONTRACT = {
  collector_id: 'c_test',
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
    { name: 'price', type: 'number', required: true, min_fill: 0.9, range: [1, 100000] },
    { name: 'ram', type: 'text', required: true, min_fill: 0.95 },
    { name: 'storage', type: 'text', required: true, min_fill: 0.95 },
    { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
  ],
  row_count: { min: 5, drift_tolerance: 0.5 },
  golden_set: ['https://master-weaver-theta.vercel.app/?layout=v1'],
  golden_set_shape: 'listing',
};

const GOOD_ROW = {
  product_name: 'AeroBook Pro 14',
  price: { value: 1299, currency: 'USD', symbol: '$' },
  ram: '16 GB',
  storage: '512 GB',
  in_stock: true,
};

/** The v3 partial break: price stops extracting, everything else keeps working. */
function v3Rows(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    ...GOOD_ROW,
    product_name: `AeroBook Pro ${i + 1}`,
    price: i < 3 ? { value: 1299, currency: 'USD', symbol: '$' } : null,
  }));
}

function healthyRows(count = 10) {
  return Array.from({ length: count }, (_, i) => ({ ...GOOD_ROW, product_name: `AeroBook Pro ${i + 1}` }));
}

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------

test('evidence separates the broken fields from the ones still working', () => {
  const before = scoreFhs(healthyRows(), CONTRACT);
  const after = scoreFhs(v3Rows(), CONTRACT);

  const bundle = buildEvidence({
    after,
    before,
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
  });

  assert.deepEqual(bundle.failedFields.map((f) => f.name), ['price']);
  assert.deepEqual(bundle.healthyFields.sort(), ['in_stock', 'product_name', 'ram', 'storage']);
});

test('evidence records fill before and after, which is what makes the prompt a specification', () => {
  const bundle = buildEvidence({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
  });

  const price = bundle.failedFields[0];
  assert.equal(price.fillBefore, 1);
  assert.ok(Math.abs(price.fillAfter - 0.3) < 1e-6);
  assert.equal(price.goodExample, '1299');
  assert.equal(price.badExample, 'nothing');
});

test('worst-affected field comes first, so it wins the character budget', () => {
  const rows = healthyRows().map((r, i) => ({
    ...r,
    price: null, // 0% — total loss
    ram: i < 5 ? '16 GB' : null, // 50% — partial
  }));

  const bundle = buildEvidence({
    after: scoreFhs(rows, CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: rows[9],
  });

  assert.deepEqual(bundle.failedFields.map((f) => f.name), ['price', 'ram']);
});

test('a collector with no history still produces usable evidence', () => {
  const bundle = buildEvidence({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: null,
    contract: CONTRACT,
    goodRow: null,
    badRow: { ...GOOD_ROW, price: null },
  });

  assert.equal(bundle.failedFields[0].fillBefore, null);
  assert.ok(buildDiagnosis(bundle).length > 0);
});

// ---------------------------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------------------------

test('the description follows the doc 01 §5.2 template', () => {
  const { description } = diagnose({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
    pageMarkdown: 'Some page. The price 1299 now lives in a nested span. More text.',
  });

  assert.match(description, /stopped extracting 1 field/);
  assert.match(description, /BROKEN: price: was 100% filled, now 30%/);
  assert.match(description, /STILL WORKING:/);
  assert.match(description, /appears on the page near this content/);
  assert.match(description, /broken field\(s\) only/);
  assert.match(description, /Do not change the fields that still work\./);
});

test('the healthy fields are named — unconstrained healing "fixes" things that were never broken', () => {
  const { description } = diagnose({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
  });

  for (const name of ['product_name', 'ram', 'storage', 'in_stock']) {
    assert.ok(description.includes(name), `${name} should be pinned as still working`);
  }
});

test('at most three broken fields are enumerated', () => {
  const rows = healthyRows().map(() => ({ product_name: null, price: null, ram: null, storage: null, in_stock: null }));
  const { description } = diagnose({
    after: scoreFhs(rows, CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: rows[0],
  });

  assert.equal((description.match(/BROKEN:/g) ?? []).length, 3);
  // But the count in the header is honest about how many there really are.
  assert.match(description, /stopped extracting 5 field/);
});

// ---------------------------------------------------------------------------------------------
// The 1000-character cap
// ---------------------------------------------------------------------------------------------

test('a normal description fits the cap comfortably', () => {
  const { description } = diagnose({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
    pageMarkdown: 'x'.repeat(200),
  });
  assert.ok(description.length <= MAX, `${description.length} > ${MAX}`);
});

test('a huge page context is truncated rather than overflowing the cap', () => {
  const { description } = diagnose({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
    pageMarkdown: 'lorem ipsum '.repeat(5000),
  });
  assert.ok(description.length <= MAX, `${description.length} > ${MAX}`);
});

test('hostile input cannot breach the cap', () => {
  const wide = {
    collector_id: 'c_test',
    fields: Array.from({ length: 14 }, (_, i) => ({
      name: `an_extremely_long_field_name_number_${i}`.repeat(3),
      type: 'text',
      required: true,
      min_fill: 0.95,
    })),
    row_count: { min: 1, drift_tolerance: 0.5 },
    golden_set: ['https://example.test/'],
    golden_set_shape: 'listing',
  };
  const empty = [{}];

  const { description } = diagnose({
    after: scoreFhs(empty, wide),
    before: null,
    contract: wide,
    goodRow: null,
    badRow: {},
    pageMarkdown: 'y'.repeat(20_000),
  });

  assert.ok(description.length <= MAX, `${description.length} > ${MAX}`);
});

test('the closing instruction survives even the hardest truncation', () => {
  const wide = {
    collector_id: 'c_test',
    fields: Array.from({ length: 20 }, (_, i) => ({
      name: `field_${'x'.repeat(60)}_${i}`,
      type: 'text',
      required: true,
      min_fill: 0.95,
    })),
    row_count: { min: 1, drift_tolerance: 0.5 },
    golden_set: ['https://example.test/'],
    golden_set_shape: 'listing',
  };

  const { description } = diagnose({
    after: scoreFhs([{}], wide),
    before: null,
    contract: wide,
    goodRow: null,
    badRow: {},
    pageMarkdown: 'z'.repeat(9000),
  });

  assert.ok(description.length <= MAX);
  assert.match(description, /Do not change the fields that still work\./);
});

// ---------------------------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------------------------

test('page context is centred on the last-known-good value', () => {
  const page = `${'a'.repeat(500)} PRICE_MARKER_1299 ${'b'.repeat(500)}`;
  const context = extractPageContext(page, 'PRICE_MARKER_1299', 100);
  assert.ok(context.includes('PRICE_MARKER_1299'));
  assert.ok(context.length <= 100);
});

test('a vanished anchor falls back to the head of the page', () => {
  const context = extractPageContext('the page begins here and continues', 'not-present', 20);
  assert.ok(context.startsWith('the page begins'));
});

test('page context has its whitespace collapsed — it is charged against a hard budget', () => {
  const context = extractPageContext('lots\n\n   of\t\twhitespace   here', 'lots', 100);
  assert.equal(context, 'lots of whitespace here');
});

test('no page markdown means no context section, not an empty one', () => {
  assert.equal(extractPageContext(null, 'x'), null);
  assert.equal(extractPageContext('   ', 'x'), null);

  const { description } = diagnose({
    after: scoreFhs(v3Rows(), CONTRACT),
    before: scoreFhs(healthyRows(), CONTRACT),
    contract: CONTRACT,
    goodRow: GOOD_ROW,
    badRow: { ...GOOD_ROW, price: null },
    pageMarkdown: null,
  });
  assert.ok(!description.includes('appears on the page near this content'));
});

// ---------------------------------------------------------------------------------------------
// Refinement
// ---------------------------------------------------------------------------------------------

test('a refined description is not the same string as the one that was rejected', () => {
  const original = 'BROKEN: price: was 95% filled, now 30%.';
  const refined = refineDiagnosis(original, {
    field: 'price',
    observed: 'an empty string',
    expectedType: 'number',
  });

  assert.notEqual(refined, original);
  assert.ok(refined.startsWith(original));
  assert.match(refined, /A previous fix attempt was rejected because price still returned/);
  assert.match(refined, /Try a different approach for that field\./);
});

test('refinement respects the cap, keeping the correction over the older evidence', () => {
  const refined = refineDiagnosis('q'.repeat(990), {
    field: 'price',
    observed: 'null',
    expectedType: 'number',
  });

  assert.ok(refined.length <= MAX, `${refined.length} > ${MAX}`);
  assert.match(refined, /Try a different approach for that field\./);
});

// ---------------------------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------------------------

test('values render unambiguously for a prompt', () => {
  assert.equal(renderExample(null), 'null');
  assert.equal(renderExample(''), 'an empty string');
  assert.equal(renderExample('  '), 'an empty string');
  assert.equal(renderExample(1299), '1299');
  assert.equal(renderExample(true), 'true');
  assert.equal(renderExample('16 GB'), '"16 GB"');
});

test('an oversized object value is clipped rather than eating the budget', () => {
  const rendered = renderExample({ deeply: { nested: 'x'.repeat(500) } });
  assert.ok(rendered.length <= 80);
  assert.ok(rendered.endsWith('...'));
});
