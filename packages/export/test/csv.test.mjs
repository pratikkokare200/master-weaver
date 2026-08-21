import assert from 'node:assert/strict';
import test from 'node:test';

import { toCsv, toCsvText } from '../dist/csv.js';

const sheet = (columns, rows) => ({ name: 'S', columns, rows });
const text = (label) => ({ label, format: 'text' });
const number = (label) => ({ label, format: 'number' });

test('header and rows are CRLF-terminated, RFC 4180', () => {
  const out = toCsvText(sheet([text('a'), text('b')], [['1', '2']]));
  assert.equal(out, 'a,b\r\n1,2\r\n');
});

test('quotes only what needs quoting, and doubles embedded quotes', () => {
  const out = toCsvText(
    sheet([text('a')], [['plain'], ['has,comma'], ['has"quote'], ['has\nnewline'], [' padded ']]),
  );
  const lines = out.split('\r\n');
  assert.equal(lines[1], 'plain');
  assert.equal(lines[2], '"has,comma"');
  assert.equal(lines[3], '"has""quote"');
  // Split on CRLF, the record separator. A lone LF inside a quoted field is DATA and the field
  // survives it intact, which is the whole reason RFC 4180 has quoting.
  assert.equal(lines[4], '"has\nnewline"');
  assert.equal(lines[5], '" padded "');
});

test('null is an empty field, not the string null', () => {
  const out = toCsvText(sheet([text('a'), text('b')], [[null, 'x']]));
  assert.equal(out, 'a,b\r\n,x\r\n');
});

// -------------------------------------------------------------------------------------------
// Formula injection. The scraped strings in this file came from a page we do not control, and a
// spreadsheet executes a cell that begins with `=` when the file is opened.
// -------------------------------------------------------------------------------------------

test('neutralises strings that a spreadsheet would execute as formulas', () => {
  const attacks = ['=1+1', '+1', '-1+1', '@SUM(A1)', "=cmd|'/c calc'!A1"];
  const out = toCsvText(sheet([text('a')], attacks.map((value) => [value])));
  const lines = out.split('\r\n').slice(1, 1 + attacks.length);

  for (const line of lines) {
    assert.ok(line.startsWith("'") || line.startsWith('"\''), `not neutralised: ${line}`);
  }
});

test('NUMBERS are never neutralised — a negative price stays a number', () => {
  const out = toCsvText(sheet([number('delta')], [[-12.5], [0], [1299]]));
  assert.equal(out, 'delta\r\n-12.5\r\n0\r\n1299\r\n');
});

test('booleans and dates have one spelling each', () => {
  const when = new Date('2026-08-21T10:07:00.000Z');
  const out = toCsvText(sheet([text('ok'), text('t')], [[true, when], [false, null]]));
  assert.equal(out, 'ok,t\r\nTRUE,2026-08-21T10:07:00.000Z\r\nFALSE,\r\n');
});

test('non-finite numbers are written as empty rather than as Infinity', () => {
  const out = toCsvText(sheet([number('n')], [[Number.POSITIVE_INFINITY], [Number.NaN]]));
  assert.equal(out, 'n\r\n\r\n\r\n');
});

test('the file starts with a UTF-8 BOM so Excel does not mojibake it', () => {
  const buffer = toCsv(sheet([text('name')], [['Nova Ultralight 13 — 16GB']]));
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(buffer.toString('utf8').includes('—'));
});
