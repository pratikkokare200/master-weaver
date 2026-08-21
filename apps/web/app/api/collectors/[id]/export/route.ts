import {
  EXPORT_FORMATS,
  episodesSheet,
  isExportFormat,
  rowsSheet,
  runsSheet,
  safeFilename,
  toCsv,
  toXlsx,
  type Sheet,
} from '@weaver/export';

import { isUuid } from '@/lib/db.server';
import {
  getCollectorName,
  getEpisodeRecords,
  getRowsForExport,
  getRunRecords,
} from '@/lib/queries.server';

/**
 * Export — the data, the run ledger, or the healing ledger, as CSV or XLSX.
 *
 * `GET /api/collectors/<id>/export?dataset=rows|runs|episodes&format=csv|xlsx`
 *
 * A plain GET returning an attachment, so the control on the page is an `<a download>` and not a
 * fetch that assembles a Blob and synthesises a click. The browser's own download handling gets the
 * progress indicator, the cancel button and the retry for free, and the URL is something you can
 * paste into a terminal.
 *
 * Read-only, like everything else in Layer A except the repair route.
 *
 * ⚠️ Unauthenticated, in common with the rest of v1 (doc 03 §2.3): anyone holding a collector id can
 * download its data. That is the same exposure the collector page already has — this endpoint adds
 * no access, only a file extension — but it is worth naming rather than leaving to be noticed.
 */

// node:zlib, so the Node runtime rather than Edge. Not incidental: the XLSX writer deflates.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATASETS = ['rows', 'runs', 'episodes'] as const;
type Dataset = (typeof DATASETS)[number];

function isDataset(value: string): value is Dataset {
  return (DATASETS as readonly string[]).includes(value);
}

function fail(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) return fail('not a collector id', 404);

  const url = new URL(request.url);
  const dataset = (url.searchParams.get('dataset') ?? 'rows').toLowerCase();
  const format = (url.searchParams.get('format') ?? 'csv').toLowerCase();

  // Both are named in the error, because a typo in a query string is otherwise indistinguishable
  // from a broken endpoint.
  if (!isDataset(dataset)) return fail(`unknown dataset: ${dataset}`, 400);
  if (!isExportFormat(format)) return fail(`unknown format: ${format}`, 400);

  let sheet: Sheet;
  let collectorName: string;

  if (dataset === 'rows') {
    const source = await getRowsForExport(id);
    if (!source) return fail('no such collector', 404);
    collectorName = source.name;
    sheet = rowsSheet(source.rows, {
      contract: source.contract ?? undefined,
      sheetName: 'Rows',
    });
  } else if (dataset === 'runs') {
    const [name, runs] = await Promise.all([getCollectorName(id), getRunRecords(id)]);
    if (name === null) return fail('no such collector', 404);
    collectorName = name;
    sheet = runsSheet(runs);
  } else {
    const [name, episodes] = await Promise.all([getCollectorName(id), getEpisodeRecords(id)]);
    if (name === null) return fail('no such collector', 404);
    collectorName = name;
    sheet = episodesSheet(episodes);
  }

  const { extension, mime } = EXPORT_FORMATS[format];
  const body = format === 'csv' ? toCsv(sheet) : toXlsx(sheet);

  // The date in the filename is the day it was taken, not the day the data covers. A folder of
  // these sorts chronologically and never collides.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = safeFilename([collectorName, dataset, stamp], extension);

  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': mime,
      // `filename*` carries the UTF-8 form for a collector named in a non-Latin script; `filename`
      // is the ASCII fallback that older clients read. Both, because they disagree about which one
      // wins and the cost of sending both is nothing.
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(body.byteLength),
      // An export is a snapshot of a ledger that changes every fifteen minutes. Caching it would
      // hand someone yesterday's numbers under today's filename.
      'Cache-Control': 'no-store',
    },
  });
}
