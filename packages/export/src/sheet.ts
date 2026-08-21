/**
 * The sheet model — one description of an export, consumed by both writers.
 *
 * CSV and XLSX are produced from the same `Sheet`, deliberately. The alternative is two functions
 * that each read the ledger and each decide what a column means, which is how a CSV and an XLSX of
 * the same view end up disagreeing about a rounded number or a missing value. Here the decisions
 * are made once, in `datasets.ts`, and the writers only encode.
 */

/**
 * Everything a cell may hold.
 *
 * `null` is a member and is not the same as `''`. A collector that returned no `ram` and a collector
 * that returned an empty string are different facts, and the whole product rests on being able to
 * tell them apart — the table renders the first as an em dash for exactly that reason.
 */
export type CellValue = string | number | boolean | Date | null;

/**
 * How a value should be presented, not what type it is.
 *
 * The distinction matters for `fhs`: it is a number, but a number that must keep six decimals,
 * because the difference between 0.949999 and 0.950000 is the difference between DEGRADED and
 * HEALTHY. A spreadsheet that rounds it to 0.95 has destroyed the only thing it was asked to show.
 */
export type CellFormat = 'text' | 'number' | 'money' | 'fhs' | 'datetime';

export interface Column {
  /** Header text. Also the CSV header. */
  readonly label: string;
  readonly format: CellFormat;
  /** XLSX column width, in characters. Ignored by CSV. */
  readonly width?: number;
}

export interface Sheet {
  /** Worksheet name. Excel restricts these; `safeSheetName` enforces it. */
  readonly name: string;
  readonly columns: readonly Column[];
  readonly rows: readonly (readonly CellValue[])[];
}

/**
 * Excel's rules for a worksheet name, applied rather than assumed: at most 31 characters, none of
 * `: \ / ? * [ ]`, and not empty. A workbook with an illegal sheet name does not open with a
 * warning — Excel calls the file corrupt and offers to repair it.
 */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\/?*[\]]/g, ' ').trim();
  return (cleaned === '' ? 'Sheet1' : cleaned).slice(0, 31);
}
