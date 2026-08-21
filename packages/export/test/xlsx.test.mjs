import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { columnName, dateSerial, toXlsx } from '../dist/xlsx.js';
import { crc32 } from '../dist/zip.js';

const FIXED = new Date('2026-08-21T10:07:00.000Z');

/**
 * A ZIP reader that walks the CENTRAL DIRECTORY, not the local headers.
 *
 * Deliberately the other end of the file from the one the writer builds first. A test that read the
 * local headers back would agree with the writer about a wrong offset; reading the directory means
 * the two records have to agree with each other, which is what a real unzip does.
 */
function readZip(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(eocd, -1, 'no end-of-central-directory record');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'bad central directory signature');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const checksum = buffer.readUInt32LE(offset + 16);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `bad local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = inflateRawSync(compressed);

    assert.equal(data.length, uncompressedSize, `size mismatch for ${name}`);
    assert.equal(crc32(data), checksum, `crc mismatch for ${name}`);

    entries.set(name, data.toString('utf8'));
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }

  return entries;
}

const simple = {
  name: 'Rows',
  columns: [
    { label: 'Product', format: 'text', width: 30 },
    { label: 'Price', format: 'money' },
    { label: 'FHS', format: 'fhs' },
    { label: 'Started', format: 'datetime' },
    { label: 'In stock', format: 'text' },
  ],
  rows: [['Nova Ultralight 13', 1299, 0.949999, FIXED, true]],
};

test('crc32 matches the standard check vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('the archive holds exactly the six parts a workbook needs', () => {
  const entries = readZip(toXlsx(simple, FIXED));
  assert.deepEqual(
    [...entries.keys()],
    [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ],
  );
});

test('[Content_Types].xml is the first entry, which some readers require', () => {
  const buffer = toXlsx(simple, FIXED);
  const firstName = buffer.toString('utf8', 30, 30 + buffer.readUInt16LE(26));
  assert.equal(firstName, '[Content_Types].xml');
});

test('the same input twice produces byte-identical archives', () => {
  assert.deepEqual(toXlsx(simple, FIXED), toXlsx(simple, FIXED));
});

test('numbers are numbers and strings are inline strings', () => {
  const sheet = readZip(toXlsx(simple, FIXED)).get('xl/worksheets/sheet1.xml');

  // The product name: an inline string.
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">Nova Ultralight 13<\/t>/);
  // The price: a bare value, so the column sums.
  assert.match(sheet, /<c r="B2" s="4"><v>1299<\/v><\/c>/);
  // The boolean.
  assert.match(sheet, /<c r="E2" t="b"><v>1<\/v><\/c>/);
});

test('FHS keeps six decimals — the DEGRADED/HEALTHY boundary is 0.95 exactly', () => {
  const sheet = readZip(toXlsx(simple, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="C2" s="3"><v>0.949999<\/v><\/c>/);
  const styles = readZip(toXlsx(simple, FIXED)).get('xl/styles.xml');
  assert.match(styles, /numFmtId="165" formatCode="0\.000000"/);
});

test('a date is written as an Excel serial, not as text', () => {
  const sheet = readZip(toXlsx(simple, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<c r="D2" s="2"><v>46255\./);
  // 2026-08-21 is 46255 days after 1899-12-30, and 10:07 UTC is 0.42… of a day.
  assert.equal(Math.floor(dateSerial(FIXED)), 46255);
});

test('a value the header row must not lose: empty cells are omitted, not blanked', () => {
  const withGap = { ...simple, rows: [['A', null, null, null, null]] };
  const sheet = readZip(toXlsx(withGap, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<row r="2"><c r="A2"[^>]*>.*?<\/c><\/row>/);
  assert.ok(!sheet.includes('r="B2"'), 'an absent value should produce no cell at all');
});

test('control characters are stripped rather than corrupting the workbook', () => {
  const hostile = { ...simple, rows: [['bad\u0001name', 1, 1, FIXED, false]] };
  const sheet = readZip(toXlsx(hostile, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.ok(!sheet.includes('\u0001'));
  assert.match(sheet, /badname/);
});

test('XML metacharacters in scraped text are escaped', () => {
  const hostile = { ...simple, rows: [['<script> & "quotes"', 1, 1, FIXED, false]] };
  const sheet = readZip(toXlsx(hostile, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /&lt;script&gt; &amp; &quot;quotes&quot;/);
});

test('an illegal sheet name is repaired instead of producing a file Excel calls corrupt', () => {
  const named = { ...simple, name: 'Runs [2026/08]: everything we have ever collected' };
  const workbook = readZip(toXlsx(named, FIXED)).get('xl/workbook.xml');
  const match = /name="([^"]*)"/.exec(workbook);
  assert.ok(match);
  assert.ok(match[1].length <= 31, `sheet name too long: ${match[1]}`);
  assert.doesNotMatch(match[1], /[:\\/?*[\]]/);
});

test('column names are bijective base-26', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(51), 'AZ');
  assert.equal(columnName(52), 'BA');
  assert.equal(columnName(701), 'ZZ');
  assert.equal(columnName(702), 'AAA');
});

test('the header is frozen and filterable over the real dimension', () => {
  const sheet = readZip(toXlsx(simple, FIXED)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<dimension ref="A1:E2"\/>/);
  assert.match(sheet, /state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:E2"\/>/);
  // autoFilter must follow sheetData, or Excel calls the file corrupt.
  assert.ok(sheet.indexOf('<autoFilter') > sheet.indexOf('</sheetData>'));
});
