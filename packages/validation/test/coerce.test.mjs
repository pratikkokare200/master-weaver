/**
 * Type coercion tests.
 *
 * These guard the boundary between "presentation drifted" and "the collector broke". Everything in
 * the first group of each block must pass so a healthy run is not failed for cosmetics; everything
 * in the second must fail, because each one is a real break that a lenient parser would wave through.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeNumericString,
  parseBoolean,
  parseNumber,
  parseText,
  parseUrl,
} from '../dist/index.js';

// ---------------------------------------------------------------------------------------------
// number
// ---------------------------------------------------------------------------------------------

test('parseNumber accepts the shapes a price legitimately arrives in', () => {
  assert.equal(parseNumber(1299), 1299);
  assert.equal(parseNumber(488.78), 488.78);
  assert.equal(parseNumber(0), 0);
  assert.equal(parseNumber(-5), -5);
  assert.equal(parseNumber('1299'), 1299);
  assert.equal(parseNumber('  1299  '), 1299);
  assert.equal(parseNumber('$1,299.00'), 1299);
  assert.equal(parseNumber('1,299'), 1299);
  assert.equal(parseNumber('1,234,567'), 1234567);
  assert.equal(parseNumber('1299 USD'), 1299);
  assert.equal(parseNumber('USD 1,299.50'), 1299.5);
  assert.equal(parseNumber('£999.99'), 999.99);
  assert.equal(parseNumber('.5'), 0.5);
});

test('parseNumber reads European separators by which one comes last', () => {
  assert.equal(parseNumber('1.299,00'), 1299);
  assert.equal(parseNumber('€1.299,50'), 1299.5);
  assert.equal(parseNumber('1 299,00'), 1299);
  // A single comma with a three-digit tail is a group separator; two digits is a decimal point.
  assert.equal(parseNumber('1,299'), 1299);
  assert.equal(parseNumber('1,29'), 1.29);
});

test('parseNumber rejects everything that is not a number', () => {
  // The tail matters: parseFloat would return 1299 for the first two and score a break as healthy.
  assert.equal(parseNumber('1299abc'), null);
  assert.equal(parseNumber('1299 <span>'), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('$'), null);
  assert.equal(parseNumber('USD'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('   '), null);
  assert.equal(parseNumber('N/A'), null);
  assert.equal(parseNumber(NaN), null);
  assert.equal(parseNumber(Infinity), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber(undefined), null);
  assert.equal(parseNumber([]), null);
  assert.equal(parseNumber({}), null);
});

test('parseNumber does not treat booleans as 1 and 0', () => {
  // A number field answering with a boolean means the extractor grabbed the wrong node.
  assert.equal(parseNumber(true), null);
  assert.equal(parseNumber(false), null);
});

test('normalizeNumericString is exposed and separator handling is inspectable', () => {
  assert.equal(normalizeNumericString('$1,299.00'), '1299.00');
  assert.equal(normalizeNumericString('1.299,50'), '1299.50');
  assert.equal(normalizeNumericString('   '), null);
  assert.equal(normalizeNumericString('$'), null);
});

// ---------------------------------------------------------------------------------------------
// boolean
// ---------------------------------------------------------------------------------------------

test('parseBoolean reads real availability strings', () => {
  assert.equal(parseBoolean(true), true);
  assert.equal(parseBoolean(false), false);
  assert.equal(parseBoolean('In Stock'), true);
  assert.equal(parseBoolean('OUT OF STOCK'), false);
  assert.equal(parseBoolean('in_stock'), true);
  assert.equal(parseBoolean('Sold Out'), false);
  assert.equal(parseBoolean('yes'), true);
  assert.equal(parseBoolean('no'), false);
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('  False  '), false);
  assert.equal(parseBoolean('1'), true);
  assert.equal(parseBoolean('0'), false);
  assert.equal(parseBoolean(1), true);
  assert.equal(parseBoolean(0), false);
});

test('parseBoolean rejects anything it cannot read unambiguously', () => {
  assert.equal(parseBoolean(2), null);
  assert.equal(parseBoolean(-1), null);
  assert.equal(parseBoolean('maybe'), null);
  assert.equal(parseBoolean('In Stock: 4 left'), null);
  assert.equal(parseBoolean(''), null);
  assert.equal(parseBoolean(null), null);
  assert.equal(parseBoolean({}), null);
});

// ---------------------------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------------------------

test('parseText trims and accepts stringifiable scalars', () => {
  assert.equal(parseText('  AeroBook Pro 14  '), 'AeroBook Pro 14');
  // The same field drifts between 16 and "16 GB" across runs; failing a run for that is a false alarm.
  assert.equal(parseText(16), '16');
  assert.equal(parseText(true), 'true');
});

test('parseText rejects empty strings and containers', () => {
  assert.equal(parseText(''), null);
  assert.equal(parseText('   '), null);
  assert.equal(parseText(null), null);
  assert.equal(parseText(undefined), null);
  assert.equal(parseText({ a: 1 }), null);
  assert.equal(parseText(['a', 'b']), null);
  assert.equal(parseText(NaN), null);
});

// ---------------------------------------------------------------------------------------------
// url
// ---------------------------------------------------------------------------------------------

test('parseUrl accepts absolute http(s) URLs under either mode', () => {
  const url = 'https://master-weaver-theta.vercel.app/p/1?x=2#top';
  assert.equal(parseUrl(url, { absolute: true }), url);
  assert.equal(parseUrl(url), url);
  assert.equal(parseUrl('http://example.com'), 'http://example.com');
  assert.equal(parseUrl('  https://example.com/a  '), 'https://example.com/a');
});

test('absolute: true rejects the site-relative path a redesign starts emitting', () => {
  assert.equal(parseUrl('/p/1', { absolute: true }), null);
  assert.equal(parseUrl('../p/1', { absolute: true }), null);
  assert.equal(parseUrl('product/46', { absolute: true }), null);
  assert.equal(parseUrl('//cdn.example.com/a.png', { absolute: true }), null);
});

test('without absolute, relative references pass but bare tokens do not', () => {
  assert.equal(parseUrl('/p/1'), '/p/1');
  assert.equal(parseUrl('./p/1'), './p/1');
  assert.equal(parseUrl('../p/1'), '../p/1');
  assert.equal(parseUrl('product/46'), 'product/46');
  assert.equal(parseUrl('//cdn.example.com/a.png'), '//cdn.example.com/a.png');
  // The `/` requirement is what stops a price or a stock label counting as a URL.
  assert.equal(parseUrl('1299'), null);
  assert.equal(parseUrl('AeroBook'), null);
});

test('parseUrl rejects non-http schemes and non-strings', () => {
  assert.equal(parseUrl('data:image/svg+xml,%3Csvg%3E'), null);
  assert.equal(parseUrl('javascript:alert(1)'), null);
  assert.equal(parseUrl('mailto:sales@example.com'), null);
  assert.equal(parseUrl('ftp://example.com/a'), null);
  assert.equal(parseUrl('Out of Stock'), null);
  assert.equal(parseUrl(''), null);
  assert.equal(parseUrl('   '), null);
  assert.equal(parseUrl(null), null);
  assert.equal(parseUrl(1299), null);
  assert.equal(parseUrl({ url: 'https://example.com' }), null);
});
