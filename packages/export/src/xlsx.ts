import type { CellFormat, CellValue, Sheet } from './sheet.js';
import { safeSheetName } from './sheet.js';
import { zip, type ZipEntry } from './zip.js';

/**
 * XLSX — a ZIP of six XML parts, written by hand.
 *
 * Why not a library: the two obvious candidates are a package npm has deprecated and a 400 KB one,
 * either of them pulled into a Vercel function to write a few hundred rows. What a spreadsheet
 * export actually needs from OOXML is small and completely specified, and `zip.ts` already supplies
 * the container.
 *
 * What this deliberately does NOT implement: shared strings (inline strings cost bytes and save a
 * part), multiple sheets, formulas, images, charts, merged cells. Adding any of them is a change to
 * this file rather than a fight with an abstraction.
 *
 * The point of XLSX over CSV is typing: a number arrives as a number and a timestamp as a date, so
 * a column sums and an axis sorts. If that were not true, the CSV would be the better artifact.
 */

// ---------------------------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------------------------

/**
 * Characters XML 1.0 cannot represent at all — most of the C0 control range.
 *
 * Not a formatting nicety: a NUL or a 0x01 inside a `<t>` element makes the workbook unreadable,
 * and Excel reports that as a corrupt file rather than as a bad character. Scraped product names
 * are exactly where such a byte arrives from, which this project has already learned once at the
 * database seam (`pgSafe` in the worker). Same defect, different boundary, same answer: strip at
 * the edge that cannot carry it.
 */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function xml(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// ---------------------------------------------------------------------------------------------
// Cell addressing
// ---------------------------------------------------------------------------------------------

/** 0 -> A, 25 -> Z, 26 -> AA. Bijective base-26, which is not the same as base-26. */
export function columnName(index: number): string {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/**
 * Excel's date serial: days since 1899-12-30.
 *
 * The 30th, not the 31st, because Excel deliberately reproduces a Lotus 1-2-3 bug in which 1900 is
 * a leap year. Shifting the epoch back a day makes every date after 1900-03-01 — which is every
 * date this system will ever export — come out right.
 *
 * UTC throughout. The ledger's timestamps are UTC and a spreadsheet cell has no timezone, so
 * converting to local time would move a run across a day boundary depending on who opened the file.
 */
export function dateSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

// ---------------------------------------------------------------------------------------------
// Styles
//
// Index into `cellXfs` below. A named object rather than inline numbers, because a style index that
// silently shifts by one turns every timestamp into a five-digit number.
// ---------------------------------------------------------------------------------------------

const STYLE = { general: 0, header: 1, datetime: 2, fhs: 3, money: 4 } as const;

function styleFor(format: CellFormat): number {
  if (format === 'datetime') return STYLE.datetime;
  if (format === 'fhs') return STYLE.fhs;
  if (format === 'money') return STYLE.money;
  return STYLE.general;
}

const STYLES_XML = `${DECLARATION}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/>
<numFmt numFmtId="165" formatCode="0.000000"/>
<numFmt numFmtId="166" formatCode="#,##0.00"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

function cell(ref: string, value: CellValue, format: CellFormat): string {
  // An empty cell is omitted entirely rather than written as an empty value. Omission is how OOXML
  // says "no value"; a blank string is a value that happens to be blank, and the two read
  // differently in every formula that touches the column.
  if (value === null || value === undefined || value === '') return '';

  if (value instanceof Date) {
    return `<c r="${ref}" s="${STYLE.datetime}"><v>${dateSerial(value)}</v></c>`;
  }

  const style = styleFor(format);
  const s = style === STYLE.general ? '' : ` s="${style}"`;

  if (typeof value === 'number') {
    // Infinity and NaN have no XLSX representation. Writing one produces a file Excel repairs.
    if (!Number.isFinite(value)) return '';
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }

  // `xml:space="preserve"` so a value with leading or trailing spaces survives the round trip.
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const lastColumn = columnName(Math.max(sheet.columns.length - 1, 0));
  const lastRow = sheet.rows.length + 1;
  const dimension = `A1:${lastColumn}${lastRow}`;

  const cols = sheet.columns
    .map((column, index) => {
      const width = column.width ?? 14;
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const header = sheet.columns
    .map(
      (column, index) =>
        `<c r="${columnName(index)}1" t="inlineStr" s="${STYLE.header}"><is><t>${xml(column.label)}</t></is></c>`,
    )
    .join('');

  const body = sheet.rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2; // row 1 is the header
      const cells = sheet.columns
        .map((column, columnIndex) =>
          cell(`${columnName(columnIndex)}${number}`, row[columnIndex] ?? null, column.format),
        )
        .join('');
      return `<row r="${number}">${cells}</row>`;
    })
    .join('');

  // Element order follows the schema's sequence — `autoFilter` after `sheetData`, not before. Excel
  // rejects a worksheet whose children are out of order with the same "corrupt file" dialog it uses
  // for a genuinely damaged archive.
  return `${DECLARATION}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dimension}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData><row r="1">${header}</row>${body}</sheetData>
<autoFilter ref="${dimension}"/>
</worksheet>`;
}

// ---------------------------------------------------------------------------------------------
// The package
// ---------------------------------------------------------------------------------------------

const CONTENT_TYPES = `${DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `${DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function workbookXml(name: string): string {
  return `${DECLARATION}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

/**
 * Encode a sheet as an XLSX workbook.
 *
 * `modified` is passed through to the archive's timestamps so the output is deterministic for a
 * fixed input — which is what lets the tests assert on bytes rather than on a re-parse by the same
 * code that wrote them.
 */
export function toXlsx(sheet: Sheet, modified: Date = new Date()): Buffer {
  const name = safeSheetName(sheet.name);

  // `[Content_Types].xml` must be the FIRST entry in the archive. Some readers scan for it rather
  // than reading the central directory, and those readers fail on an archive that merely contains
  // it somewhere.
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(sheet), 'utf8') },
  ];

  return zip(entries, modified);
}
