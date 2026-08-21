import type { CollectorContract, RunState } from '@weaver/contracts';
import { ECHO_KEYS, dedupeRows, unwrapScalar } from '@weaver/validation';

import type { CellFormat, CellValue, Column, Sheet } from './sheet.js';

/**
 * What each export contains — the only place a column's meaning is decided.
 *
 * Three datasets, one per panel that has something worth taking away:
 *
 *   - `rows`     the scraped data itself, what the table shows
 *   - `runs`     the run ledger, what the chart plots
 *   - `episodes` the healing ledger, what the timeline lists
 *
 * The rule is "export what you are looking at", and it is worth stating because the tempting
 * alternative — one export containing everything — produces a file nobody can open in the program
 * they were going to use it in.
 */

// ---------------------------------------------------------------------------------------------
// Rows — the scraped data
// ---------------------------------------------------------------------------------------------

/**
 * The money envelope, and the reason the row exporter is not a plain flattener.
 *
 * `price` arrives as `{ value: 1299, currency: "USD", symbol: "$" }`. Writing that object into a
 * cell gives `[object Object]`; writing only `1299` silently discards the currency, which for a
 * price comparison tool is the difference between a fact and a wrong fact. So a field whose value
 * carries a `currency` key becomes two columns.
 *
 * Detected structurally rather than by matching the name `price`, because the next collector's money
 * field will not be called price.
 */
function hasCurrency(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'currency' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Column label from a field key: `product_name` reads better as `Product name` in a header. */
function labelFor(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface FieldPlan {
  readonly key: string;
  readonly format: CellFormat;
  readonly currency: boolean;
  readonly width: number;
}

/**
 * Decide the columns by looking at the data, with the contract as the ordering authority.
 *
 * Contract fields come first and in contract order, so the columns the collector is measured on are
 * the columns you see first. Everything else the collector returned follows in first-seen order —
 * included rather than dropped, because a field outside the contract is still data somebody paid to
 * scrape, and `product_page_url` was unscored for the whole of week one.
 */
function planFields(rows: readonly unknown[], contract?: CollectorContract): FieldPlan[] {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const field of contract?.fields ?? []) {
    if (!seen.has(field.name)) {
      seen.add(field.name);
      order.push(field.name);
    }
  }
  for (const row of rows) {
    if (!isRecord(row)) continue;
    for (const key of Object.keys(row)) {
      // Echo keys are the request reflected back, not something the collector extracted: `input`
      // repeats the target URL identically on every row. De-duplication already ignores them, and
      // exporting one would put a column of the same string 144 times next to the real data.
      if (seen.has(key) || ECHO_KEYS.has(key)) continue;
      seen.add(key);
      order.push(key);
    }
  }

  const declared = new Map((contract?.fields ?? []).map((field) => [field.name, field.type]));

  return order.map((key) => {
    const type = declared.get(key);
    let currency = false;
    let numeric = type === 'number';
    let long = false;

    for (const row of rows) {
      if (!isRecord(row)) continue;
      const raw = row[key];
      if (hasCurrency(raw)) currency = true;
      const scalar = unwrapScalar(raw, type ?? 'text');
      if (typeof scalar === 'number') numeric = true;
      if (typeof scalar === 'string' && scalar.length > 40) long = true;
    }

    return {
      key,
      // A money field gets the money format; any other number stays general, because a row count
      // and a rating should not be forced to two decimal places.
      format: currency ? 'money' : numeric ? 'number' : 'text',
      currency,
      width: long ? 44 : numeric ? 12 : 20,
    } satisfies FieldPlan;
  });
}

export interface RowsSheetOptions {
  readonly sheetName?: string;
  readonly contract?: CollectorContract;
  /**
   * De-duplicate before writing. Default true — the read-path rule (audit F1): the ledger stores
   * what the CLI returned, verbatim and duplicated, and every reader collapses it. An export that
   * disagreed with the table on screen would be the more confusing artifact of the two.
   */
  readonly dedupe?: boolean;
}

export function rowsSheet(rows: readonly unknown[], options: RowsSheetOptions = {}): Sheet {
  const source = options.dedupe === false ? [...rows] : dedupeRows(rows);
  const plan = planFields(source, options.contract);

  const columns: Column[] = [];
  for (const field of plan) {
    columns.push({ label: labelFor(field.key), format: field.format, width: field.width });
    if (field.currency) columns.push({ label: `${labelFor(field.key)} currency`, format: 'text', width: 10 });
  }

  const declared = new Map((options.contract?.fields ?? []).map((f) => [f.name, f.type]));

  const body = source.map((row) => {
    const cells: CellValue[] = [];
    for (const field of plan) {
      const raw = isRecord(row) ? row[field.key] : undefined;
      const scalar = unwrapScalar(raw, declared.get(field.key) ?? 'text');

      if (scalar === null || scalar === undefined) cells.push(null);
      else if (typeof scalar === 'number' || typeof scalar === 'boolean') cells.push(scalar);
      else if (typeof scalar === 'string') cells.push(scalar);
      // Anything still an object after unwrapping is a genuine break — the envelope arrived without
      // its value. JSON rather than `[object Object]`, so the export shows what was actually there.
      else cells.push(JSON.stringify(scalar));

      if (field.currency) {
        const currency = hasCurrency(raw) ? raw['currency'] : null;
        cells.push(typeof currency === 'string' ? currency : null);
      }
    }
    return cells;
  });

  return { name: options.sheetName ?? 'Rows', columns, rows: body };
}

// ---------------------------------------------------------------------------------------------
// Runs — the run ledger
// ---------------------------------------------------------------------------------------------

export interface RunRecord {
  readonly started_at: Date | string;
  readonly finished_at: Date | string | null;
  readonly run_state: RunState;
  /** `numeric` from node-postgres, so a string. Parsed here rather than trusted. */
  readonly fhs: string | number | null;
  readonly row_count: number | null;
  readonly credits_spent: string | number | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const RUN_COLUMNS: readonly Column[] = [
  { label: 'Started (UTC)', format: 'datetime', width: 20 },
  { label: 'Finished (UTC)', format: 'datetime', width: 20 },
  { label: 'Duration (s)', format: 'number', width: 12 },
  { label: 'State', format: 'text', width: 18 },
  { label: 'FHS', format: 'fhs', width: 12 },
  { label: 'Rows', format: 'number', width: 8 },
  { label: 'Credits', format: 'number', width: 10 },
];

/**
 * The run ledger.
 *
 * Every finished run, healthy or not. The dips are the point: a history filtered to successful runs
 * cannot show a break, and a break is the only thing worth exporting this to prove.
 *
 * FHS keeps six decimals (`0.000000`) because the band boundary is 0.95 exactly, and a spreadsheet
 * that rounds 0.949999 to 0.95 has erased the distinction between DEGRADED and HEALTHY.
 */
export function runsSheet(runs: readonly RunRecord[], sheetName = 'Runs'): Sheet {
  const body = runs.map((run) => {
    const started = toDate(run.started_at);
    const finished = toDate(run.finished_at);
    const duration =
      started && finished ? Math.round(((finished.getTime() - started.getTime()) / 1000) * 10) / 10 : null;

    return [
      started,
      finished,
      duration,
      run.run_state,
      toNumber(run.fhs),
      run.row_count ?? null,
      toNumber(run.credits_spent),
    ] satisfies CellValue[];
  });

  return { name: sheetName, columns: RUN_COLUMNS, rows: body };
}

// ---------------------------------------------------------------------------------------------
// Episodes — the healing ledger
// ---------------------------------------------------------------------------------------------

export interface EpisodeAttemptRecord {
  readonly attempt_no: number;
  readonly canary_fhs: string | number | null;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
  readonly rejection_reason: string | null;
  readonly description_sent: string;
}

export interface EpisodeRecord {
  readonly triggered_at: Date | string;
  readonly resolved_at: Date | string | null;
  readonly trigger_reason: 'DEGRADED' | 'BROKEN';
  readonly authorised_by: 'AUTONOMOUS' | 'OPERATOR';
  readonly final_state: 'RESTORED' | 'QUARANTINED' | 'DISMISSED' | null;
  readonly fhs_before: string | number | null;
  readonly fhs_after: string | number | null;
  readonly credits_spent: string | number | null;
  readonly duration_ms: number | null;
  readonly failed_fields: readonly string[] | null;
  readonly attempts: readonly EpisodeAttemptRecord[] | null;
}

const EPISODE_COLUMNS: readonly Column[] = [
  { label: 'Triggered (UTC)', format: 'datetime', width: 20 },
  { label: 'Trigger', format: 'text', width: 12 },
  { label: 'Authorised by', format: 'text', width: 14 },
  { label: 'Outcome', format: 'text', width: 14 },
  { label: 'FHS before', format: 'fhs', width: 12 },
  { label: 'FHS after', format: 'fhs', width: 12 },
  { label: 'Failed fields', format: 'text', width: 24 },
  { label: 'Attempt', format: 'number', width: 8 },
  { label: 'Canary FHS', format: 'fhs', width: 12 },
  { label: 'Decision', format: 'text', width: 12 },
  { label: 'Rejection reason', format: 'text', width: 40 },
  { label: 'Diagnosis sent', format: 'text', width: 60 },
  { label: 'Credits', format: 'number', width: 10 },
  { label: 'Duration (s)', format: 'number', width: 12 },
];

/**
 * The healing ledger, one row per ATTEMPT rather than per episode.
 *
 * An episode row can only record its final outcome. "Attempt 1 rejected at 0.71, attempt 2 approved
 * at 0.98" is the sequence that makes the audit trail worth reading, and it does not survive being
 * flattened to one row per episode. So the episode's own columns repeat down its attempts, which is
 * what makes the sheet filterable and pivotable — the reason to export it at all.
 *
 * **Rejected attempts are included.** Doc 05 §6, and it is right on the merits: a system that shows
 * you the fix it refused is more convincing than one that only reports its successes.
 *
 * An episode the breaker refused has no attempts and still gets a row, with the attempt columns
 * empty. It happened, it cost a decision, and it belongs in the record.
 */
export function episodesSheet(episodes: readonly EpisodeRecord[], sheetName = 'Healing ledger'): Sheet {
  const body: CellValue[][] = [];

  for (const episode of episodes) {
    const head: CellValue[] = [
      toDate(episode.triggered_at),
      episode.trigger_reason,
      episode.authorised_by,
      // An episode still running has no verdict, and "in progress" is the honest cell. Filling it
      // with a plausible final state would put a guess into an audit trail.
      episode.final_state ?? 'IN PROGRESS',
      toNumber(episode.fhs_before),
      toNumber(episode.fhs_after),
      (episode.failed_fields ?? []).join(', ') || null,
    ];

    const tail: CellValue[] = [
      toNumber(episode.credits_spent),
      episode.duration_ms === null || episode.duration_ms === undefined
        ? null
        : Math.round(episode.duration_ms / 100) / 10,
    ];

    const attempts = episode.attempts ?? [];
    if (attempts.length === 0) {
      body.push([...head, null, null, null, null, null, ...tail]);
      continue;
    }

    for (const attempt of attempts) {
      body.push([
        ...head,
        attempt.attempt_no,
        toNumber(attempt.canary_fhs),
        attempt.decision,
        attempt.rejection_reason,
        attempt.description_sent,
        ...tail,
      ]);
    }
  }

  return { name: sheetName, columns: EPISODE_COLUMNS, rows: body };
}
