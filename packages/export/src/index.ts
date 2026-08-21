/**
 * @weaver/export — CSV and XLSX for the Observation Deck.
 *
 * One sheet model, two writers, no dependencies outside the workspace. `datasets.ts` decides what a
 * column means; `csv.ts` and `xlsx.ts` only encode. That split is why the CSV and the XLSX of the
 * same view can never disagree about a rounded number or a missing value.
 *
 * Node only — `xlsx.ts` uses `node:zlib`. The route handlers that call it run on the Node runtime.
 */

export type { CellFormat, CellValue, Column, Sheet } from './sheet.js';
export { safeSheetName } from './sheet.js';

export { toCsv, toCsvText } from './csv.js';
export { toXlsx, columnName, dateSerial } from './xlsx.js';
export { zip, crc32 } from './zip.js';
export type { ZipEntry } from './zip.js';

export { rowsSheet, runsSheet, episodesSheet } from './datasets.js';
export type { RowsSheetOptions, RunRecord, EpisodeRecord, EpisodeAttemptRecord } from './datasets.js';

/** MIME types and file extensions, so the route handler does not spell them out again. */
export const EXPORT_FORMATS = {
  csv: { extension: 'csv', mime: 'text/csv; charset=utf-8' },
  xlsx: {
    extension: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
} as const;

export type ExportFormat = keyof typeof EXPORT_FORMATS;

export function isExportFormat(value: string): value is ExportFormat {
  return value === 'csv' || value === 'xlsx';
}

/**
 * A filename that survives Content-Disposition, a Windows filesystem, and a shell.
 *
 * Windows additionally forbids a trailing dot and the reserved device names (`CON`, `PRN`, `AUX`,
 * `NUL`, `COM1`…). A file called `nul.csv` cannot be saved there at all, and a collector called
 * `nul` is not an implausible thing for a test to create.
 */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeFilename(parts: readonly string[], extension: string): string {
  const slug = parts
    .map((part) =>
      part
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        // Leading dots and dashes go too, not just dashes. `../../etc/passwd` otherwise survives as
        // `..-..-etc-passwd`, which is harmless in a header but reads like a traversal that got
        // through, and a name beginning with a dot is a hidden file on every Unix desktop.
        .replace(/^[-.]+|[-.]+$/g, ''),
    )
    .filter((part) => part !== '')
    .join('_')
    .replace(/\.+$/, '')
    .slice(0, 120);

  const base = slug === '' || RESERVED.test(slug) ? 'export' : slug;
  return `${base}.${extension}`;
}
