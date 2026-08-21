import type { CellValue, Sheet } from './sheet.js';

/**
 * CSV, RFC 4180, with the two accommodations a spreadsheet actually needs.
 *
 * **A UTF-8 BOM.** Excel on Windows reads a BOM-less UTF-8 file as the system code page, which turns
 * every non-ASCII product name into mojibake. The BOM is three bytes that make the file correct in
 * the program most people will open it with; every other consumer skips it.
 *
 * **CRLF line endings**, as RFC 4180 specifies. Nothing rejects LF, but this is the format's own
 * answer and there is no reason to deviate from it.
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than as text.
 *
 * A cell beginning with any of these is executed on open: `=cmd|'…'!A1` in a product name is a
 * remote-code-execution vector against whoever opens the export, and the scraped strings in this
 * file come from a page we do not control. This is the one place where a scraper's output reaches a
 * user's machine as something other than data.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Formula neutralisation applies to STRINGS ONLY, and that restriction is load-bearing.
 *
 * `-12.5` begins with `-`. Neutralising it would write `'-12.5`, which is text, and the column would
 * stop summing. Numbers reach the file through their own branch in `encodeCell` and never pass
 * through here, so a negative price stays a negative number and a hostile product name stays inert.
 */
function neutralise(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  if (!NEEDS_QUOTING.test(value) && value.trim() === value) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function encodeCell(value: CellValue): string {
  // Empty, not the string "null". An absent value must not arrive looking like a value.
  if (value === null || value === undefined) return '';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }

  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';

  // ISO 8601, UTC, always. A locale-formatted date in a CSV is a date whose meaning depends on who
  // opens it, and the ledger's timestamps are the axis every other number is read against.
  if (value instanceof Date) return value.toISOString();

  return quote(neutralise(value));
}

/** Encode a sheet as CSV text, without the BOM. */
export function toCsvText(sheet: Sheet): string {
  const lines: string[] = [];

  lines.push(sheet.columns.map((column) => quote(column.label)).join(','));
  for (const row of sheet.rows) {
    lines.push(row.map((cell) => encodeCell(cell)).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** Encode a sheet as a CSV file: BOM first, then the text. */
export function toCsv(sheet: Sheet): Buffer {
  return Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from(toCsvText(sheet), 'utf8')]);
}
