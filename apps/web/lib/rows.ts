/**
 * The read path for scraped rows — the single boundary every view goes through.
 *
 * **Why this file exists.** The live listing collector returns 144 rows carrying 12 distinct
 * products, each an exact copy (Day-3 audit finding F1). The Field Health Score does not notice and
 * should not: every field is populated on every copy, so the run is genuinely healthy by the measure
 * that catches breakage. Duplication is a different defect and gets a different tool.
 *
 * **The raw rows stay raw.** `runs.rows` keeps exactly what the CLI returned, because the ledger is
 * evidence and evidence that was quietly reshaped before storage is worth less than evidence that
 * was not. The collapse happens here, on the way to the screen.
 *
 * **Everything that displays rows imports from this module.** When the Supabase reads land, they
 * return raw rows and pass them through {@link readRows} — the table, the chart, the JSON view and
 * the export all receive the de-duplicated set, and all of them agree, because there is one place
 * that decides.
 */

import { describeDuplication, dedupeRows } from '@weaver/validation';
import type { DuplicationReport } from '@weaver/validation';

import type { ProductRow } from './seed';

/** Rows ready to render, plus what de-duplication found on the way. */
export interface ReadRowsResult<T> {
  /** De-duplicated, in page order, first occurrence of each kept. */
  rows: T[];
  /** What was collapsed. Surface it rather than hiding it — a collector that starts duplicating
   *  has had something change on the target page, and that is worth knowing even at FHS 1.0. */
  duplication: DuplicationReport;
}

/**
 * Turn stored rows into rows to render.
 *
 * The entry point for every view. Null-safe because a run that failed before returning anything
 * stores no rows at all, and a table asking for `.length` on that should get 0, not a crash.
 */
export function readRows<T>(raw: readonly T[] | null | undefined): ReadRowsResult<T> {
  return {
    rows: dedupeRows(raw),
    duplication: describeDuplication(raw),
  };
}

/** {@link readRows} for the product-row shape the table and chart render. */
export function readProductRows(
  raw: readonly ProductRow[] | null | undefined,
): ReadRowsResult<ProductRow> {
  return readRows(raw);
}

/**
 * A short line for the UI when rows were collapsed, or `null` when they were not.
 *
 * Plain English, in the product's own voice — doc 03 §1.1 keeps the lore out of the interface, and
 * doc 05 §9 rejects a label a judge has to translate.
 */
export function duplicationNotice(report: DuplicationReport): string | null {
  if (!report.has_duplicates) return null;

  const factor = Number.isInteger(report.factor) ? report.factor : report.factor.toFixed(1);
  return `The page returned each row ${factor}× — showing ${report.distinct_count} of ${report.raw_count} rows.`;
}
