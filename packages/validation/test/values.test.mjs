/**
 * Value extraction tests.
 *
 * The nested `price` envelope is the reason this layer exists — see the first block. The rest guard
 * the edges that turn into wrong scores rather than crashes: `false` and `0` counting as filled,
 * missing fields, empty containers, and rows that are not objects at all.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractFieldValue, isFilled, parseNumber, readPath, unwrapScalar } from '../dist/index.js';

const PRICE_FIELD = { name: 'price', type: 'number', required: true, min_fill: 0.9 };

// ---------------------------------------------------------------------------------------------
// The Bright Data money envelope
// ---------------------------------------------------------------------------------------------

test('a nested price object unwraps to its numeric value', () => {
  const price = { value: 1299, currency: 'USD', symbol: '$' };

  // The control: the envelope itself is not a number, so without unwrapping a healthy run scores 0.
  assert.equal(parseNumber(price), null);

  assert.equal(unwrapScalar(price, 'number'), 1299);
  assert.equal(extractFieldValue({ price }, PRICE_FIELD), 1299);
  assert.equal(parseNumber(extractFieldValue({ price }, PRICE_FIELD)), 1299);
});

test('a price envelope whose value is null scores as empty, not as a wrong type', () => {
  // The envelope arrived, the price inside it did not. Reporting this through fill_rate is what
  // makes the ledger say "the field came back empty" rather than "the field is the wrong shape".
  const value = extractFieldValue({ price: { value: null, currency: 'USD', symbol: '$' } }, PRICE_FIELD);
  assert.equal(value, null);
  assert.equal(isFilled(value), false);
});

test('a price envelope with no carrying key stays an object and fails the type check', () => {
  const price = { currency: 'USD', symbol: '$' };
  const value = extractFieldValue({ price }, PRICE_FIELD);
  assert.deepEqual(value, price);
  assert.equal(isFilled(value), true);
  assert.equal(parseNumber(value), null);
});

test('unwrapping follows the wrapper keys declared for each type', () => {
  assert.equal(unwrapScalar({ amount: '1,299.00' }, 'number'), '1,299.00');
  assert.equal(unwrapScalar({ url: '/p/1', text: 'Buy' }, 'url'), '/p/1');
  assert.equal(unwrapScalar({ href: '/p/1' }, 'url'), '/p/1');
  assert.equal(unwrapScalar({ text: 'AeroBook', tag: 'h2' }, 'text'), 'AeroBook');
  // Single-key objects unwrap regardless of the key's name.
  assert.equal(unwrapScalar({ price: 1299 }, 'number'), 1299);
  assert.equal(unwrapScalar({ value: { amount: 1299 } }, 'number'), 1299);
});

test('unwrapping is not fooled by a self-referential row', () => {
  const cyclic = {};
  cyclic.value = cyclic;
  assert.doesNotThrow(() => unwrapScalar(cyclic, 'number'));
});

// ---------------------------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------------------------

test('single-element arrays unwrap; wider ones are a broken selector, not a first-match', () => {
  assert.equal(unwrapScalar(['AeroBook'], 'text'), 'AeroBook');
  assert.equal(unwrapScalar([{ value: 1299 }], 'number'), 1299);

  const widened = ['AeroBook', 'Zenith', 'Nova'];
  assert.deepEqual(unwrapScalar(widened, 'text'), widened);
  assert.equal(isFilled(widened), true);
});

test('an empty array is an empty value', () => {
  assert.deepEqual(unwrapScalar([], 'text'), []);
  assert.equal(isFilled([]), false);
  assert.equal(isFilled(extractFieldValue({ price: [] }, PRICE_FIELD)), false);
});

// ---------------------------------------------------------------------------------------------
// Reading fields off a row
// ---------------------------------------------------------------------------------------------

test('readPath prefers a literal key, then falls back to a dotted path', () => {
  assert.equal(readPath({ 'input.url': 'literal', input: { url: 'nested' } }, 'input.url'), 'literal');
  assert.equal(readPath({ input: { url: 'nested' } }, 'input.url'), 'nested');
  assert.equal(readPath({ product_name: 'AeroBook' }, 'product_name'), 'AeroBook');
});

test('a missing field, or a row that is not an object, reads as undefined rather than throwing', () => {
  assert.equal(readPath({}, 'price'), undefined);
  assert.equal(readPath({ input: {} }, 'input.url.deep'), undefined);
  assert.equal(readPath(null, 'price'), undefined);
  assert.equal(readPath(undefined, 'price'), undefined);
  assert.equal(readPath('a string row', 'price'), undefined);
  assert.equal(readPath([], 'price'), undefined);
  assert.equal(extractFieldValue(null, PRICE_FIELD), undefined);
});

// ---------------------------------------------------------------------------------------------
// What counts as filled
// ---------------------------------------------------------------------------------------------

test('false and 0 are filled values', () => {
  // The two a truthiness check drops — which would read an out-of-stock product, or a free item,
  // as a scraping failure.
  assert.equal(isFilled(false), true);
  assert.equal(isFilled(0), true);
  assert.equal(isFilled('0'), true);
});

test('null, empty strings, empty containers and nullish tokens are not filled', () => {
  for (const empty of [null, undefined, '', '   ', '\n\t', [], {}, NaN]) {
    assert.equal(isFilled(empty), false, `${JSON.stringify(empty)} should not be filled`);
  }
  for (const token of ['null', 'NULL', 'undefined', 'N/A', 'n/a', 'NaN', 'None', '-', '—']) {
    assert.equal(isFilled(token), false, `${token} should not be filled`);
  }
});

test('ordinary values are filled', () => {
  for (const value of ['AeroBook', 1299, -1, true, ['a'], { a: 1 }]) {
    assert.equal(isFilled(value), true, `${JSON.stringify(value)} should be filled`);
  }
});
