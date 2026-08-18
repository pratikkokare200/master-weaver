/**
 * Reads and writes against the ledger tables: `collectors` and `runs`.
 *
 * Ledger integrity rule (doc 03 section 4): every state transition writes its row *before* the next
 * CLI call is made, so a run interrupted by a crash is still auditable up to the point of failure.
 * {@link insertRun} is that rule in practice — the RUNNING row exists before the subprocess is
 * spawned, which is also what lets the dashboard show a scrape in progress rather than only its
 * result.
 */

import {
  type CollectorContract,
  type FieldScore,
  type RunState,
  isLegalTransition,
  safeParseCollectorContract,
} from '@weaver/contracts';

import type { Queryable } from './db.js';

/** A `collectors` row, narrowed to what the runner needs. */
export interface CollectorRow {
  id: string;
  workspace_id: string;
  /** Bright Data's collector id. This is what goes to the CLI. */
  collector_id: string;
  name: string;
  target_url: string;
  /** Raw JSONB. Untrusted until it has been through `safeParseCollectorContract`. */
  contract: unknown;
  status: string;
}

export interface RunRow {
  id: string;
  collector_id: string;
  job_id: string | null;
  run_state: RunState;
  row_count: number;
  fhs: number | null;
}

export async function getCollector(db: Queryable, collectorId: string): Promise<CollectorRow | null> {
  const { rows } = await db.query<CollectorRow>(
    `select id, workspace_id, collector_id, name, target_url, contract, status
       from collectors
      where id = $1`,
    [collectorId],
  );
  return rows[0] ?? null;
}

/** Open a run in RUNNING. Called before the CLI is spawned, never after. */
export async function insertRun(
  db: Queryable,
  input: { collectorId: string; jobId: string | null },
): Promise<RunRow> {
  const { rows } = await db.query<RunRow>(
    `insert into runs (collector_id, job_id, run_state, started_at)
     values ($1, $2, 'RUNNING', now())
     returning id, collector_id, job_id, run_state, row_count, fhs`,
    [input.collectorId, input.jobId],
  );
  const run = rows[0];
  if (!run) throw new Error('insertRun inserted no row');
  return run;
}

export class IllegalTransitionError extends Error {
  constructor(from: RunState, to: RunState) {
    super(`${from} -> ${to} is not a legal run-state transition (doc 01 section 2.2)`);
    this.name = 'IllegalTransitionError';
  }
}

/**
 * Move a run to its next state, refusing edges the state machine does not have.
 *
 * Checked twice on purpose: `isLegalTransition` rejects an edge the frozen machine forbids, and the
 * `run_state = $3` predicate makes the write itself conditional on the row still being where we
 * think it is. The second is what stops a stale in-memory state from overwriting a newer one.
 */
export async function transitionRun(
  db: Queryable,
  runId: string,
  from: RunState,
  to: RunState,
): Promise<void> {
  if (!isLegalTransition(from, to)) throw new IllegalTransitionError(from, to);

  const { rows } = await db.query<{ id: string }>(
    `update runs set run_state = $2 where id = $1 and run_state = $3 returning id`,
    [runId, to, from],
  );
  if (rows.length === 0) {
    throw new Error(`run ${runId} was not in ${from} when transitioning to ${to}`);
  }
}

/** Close a run: its rows, its score, and the state the score put it in. */
export async function finishRun(
  db: Queryable,
  input: {
    runId: string;
    from: RunState;
    to: RunState;
    rows: unknown[];
    fhs: number | null;
    fieldScores: FieldScore[] | null;
  },
): Promise<void> {
  if (!isLegalTransition(input.from, input.to)) throw new IllegalTransitionError(input.from, input.to);

  const { rows } = await db.query<{ id: string }>(
    `update runs
        set "rows"       = $2::jsonb,
            row_count    = $3,
            fhs          = $4,
            field_scores = $5::jsonb,
            run_state    = $6,
            finished_at  = now()
      where id = $1
        and run_state = $7
    returning id`,
    [
      input.runId,
      JSON.stringify(input.rows),
      input.rows.length,
      input.fhs,
      input.fieldScores === null ? null : JSON.stringify(input.fieldScores),
      input.to,
      input.from,
    ],
  );
  if (rows.length === 0) {
    throw new Error(`run ${input.runId} was not in ${input.from} when finishing as ${input.to}`);
  }
}

/**
 * Trailing median row count over recent HEALTHY runs — the denominator of the FHS row penalty.
 *
 * HEALTHY only, deliberately. The median is a baseline for "how many rows this collector normally
 * returns", and folding in the runs where it returned three would drag the baseline down to meet
 * the breakage, which is the same self-lowering bar doc 01 section 3.4 warns about for golden
 * baselines. Returns null when there is no history, and the penalty is then skipped.
 */
export async function trailingMedianRowCount(
  db: Queryable,
  collectorId: string,
  window: number,
): Promise<number | null> {
  const { rows } = await db.query<{ row_count: number }>(
    `select row_count
       from runs
      where collector_id = $1
        and run_state = 'HEALTHY'
        and finished_at is not null
      order by started_at desc
      limit $2`,
    [collectorId, window],
  );
  if (rows.length === 0) return null;

  const counts = rows.map((row) => Number(row.row_count)).sort((a, b) => a - b);
  const middle = Math.floor(counts.length / 2);
  if (counts.length % 2 === 1) return counts[middle] ?? null;
  return ((counts[middle - 1] ?? 0) + (counts[middle] ?? 0)) / 2;
}

/**
 * Parse a stored contract, which is LLM output and stays untrusted after a database round trip.
 *
 * Returns null rather than throwing: a collector with an unparseable contract is a configuration
 * fault, and the runner turns it into a failed job with a readable error instead of a stack trace.
 */
export function readContract(raw: unknown): CollectorContract | null {
  const result = safeParseCollectorContract(raw);
  return result.success ? result.data : null;
}
