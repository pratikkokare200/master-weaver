/**
 * Executing one claimed job: run the scraper, score the result, write the ledger row.
 *
 * The sequence is deliberately the one doc 01 section 2.2 draws:
 *
 *   RUNNING --> VALIDATING --> HEALTHY | DEGRADED | BROKEN
 *   RUNNING --> TRANSIENT_RETRY                       (the CLI call itself failed)
 *
 * and it STOPS THERE. Nothing in this file diagnoses, heals, approves or opens a healing episode.
 * A run that lands in DEGRADED or BROKEN is written to the ledger, logged, and left alone; the
 * state machine that decides what happens next is a separate concern and is not wired up yet.
 * DEGRADED in particular must never trigger a repair unattended (architect decision 3), so the
 * absence of that code here is a feature rather than a gap to be filled in passing.
 */

import type { BrightDataClient } from '@weaver/brightdata';
import { classifyFhs, type FieldScore, type RunState } from '@weaver/contracts';
import { scoreFhs } from '@weaver/validation';

import type { Queryable } from './db.js';
import {
  finishRun,
  getCollector,
  insertRun,
  readContract,
  trailingMedianRowCount,
  transitionRun,
} from './ledger.js';
import type { Logger } from './log.js';

/** What the poll loop needs to know about a finished job. */
export type JobOutcome =
  /** The scrape ran and was scored. `state` is the band it landed in. */
  | { kind: 'scored'; runId: string; state: RunState; fhs: number; rowCount: number }
  /** The CLI call failed. Worth another attempt if the job has any left. */
  | { kind: 'transient'; runId: string | null; error: string }
  /** Something about this job will never work: no collector, unparseable contract. */
  | { kind: 'permanent'; error: string };

export interface RunnerDeps {
  db: Queryable;
  brightdata: BrightDataClient;
  log: Logger;
  /** How many recent HEALTHY runs feed the trailing median row count. */
  rowHistoryWindow: number;
}

export interface RunnableJob {
  id: string;
  collector_id: string;
  kind: string;
  attempts: number;
}

export async function executeJob(deps: RunnerDeps, job: RunnableJob): Promise<JobOutcome> {
  const { db, log } = deps;

  const collector = await getCollector(db, job.collector_id);
  if (!collector) {
    return { kind: 'permanent', error: `collector ${job.collector_id} does not exist` };
  }

  const contract = readContract(collector.contract);
  if (!contract) {
    // Running would still cost credits, and the rows could not be validated against anything. A
    // loud failure here is cheaper than a ledger full of unscored runs.
    return {
      kind: 'permanent',
      error: `collector ${collector.collector_id} has a contract that does not parse as a CollectorContract`,
    };
  }

  // The ledger row exists before the subprocess does — doc 03 section 4.
  const run = await insertRun(db, { collectorId: collector.id, jobId: job.id });
  const runLog = log.child({ run_id: run.id, collector_id: collector.collector_id });
  runLog.info('run started', { target_url: collector.target_url, job_kind: job.kind });

  const result = await deps.brightdata.runScraper({
    collectorId: collector.collector_id,
    url: collector.target_url,
    name: `${collector.name} (${job.kind})`,
  });

  if (!result.ok) {
    const error = result.error?.message ?? `scraper run exited ${result.exitCode}`;
    // RUNNING -> TRANSIENT_RETRY is legal and is as far as this worker goes. Whether the cause is
    // genuinely transient or a structural break is decided by the `scrape` probe (doc 01 section
    // 4.3), which belongs to the healing layer.
    await finishRun(db, {
      runId: run.id,
      from: 'RUNNING',
      to: 'TRANSIENT_RETRY',
      rows: [],
      fhs: null,
      fieldScores: null,
    });
    runLog.warn('scraper run failed', {
      error,
      timed_out: result.timedOut,
      exit_code: result.exitCode,
      argv: result.argvRedacted,
      stderr: result.stderrExcerpt,
    });
    return { kind: 'transient', runId: run.id, error };
  }

  const rows = Array.isArray(result.data) ? result.data : [];

  await transitionRun(db, run.id, 'RUNNING', 'VALIDATING');

  const trailingMedian = await trailingMedianRowCount(db, collector.id, deps.rowHistoryWindow);
  // The golden penalty is omitted, not zeroed: there is no golden-set confirmation run today, and
  // `goldenSetMatchRate: 0` would score every healthy run at 0. Absent means "not measured".
  const breakdown = scoreFhs(rows, contract, { trailingMedianRowCount: trailingMedian });
  const band = classifyFhs(breakdown.fhs);

  await finishRun(db, {
    runId: run.id,
    from: 'VALIDATING',
    to: band,
    rows,
    fhs: breakdown.fhs,
    fieldScores: breakdown.field_scores satisfies FieldScore[],
  });

  const summary = {
    fhs: breakdown.fhs,
    fhs_raw: breakdown.fhs_raw,
    row_count: breakdown.row_count,
    row_penalty: breakdown.row_penalty,
    trailing_median_row_count: trailingMedian,
    failed_fields: breakdown.failed_fields,
    duration_ms: result.durationMs,
  };

  if (band === 'HEALTHY') {
    runLog.info('run healthy', summary);
  } else {
    // The one line an operator needs to see. Healing is not wired up, so this is where it stops.
    runLog.warn('run not healthy — healing is not enabled in this build', { band, ...summary });
  }

  return { kind: 'scored', runId: run.id, state: band, fhs: breakdown.fhs, rowCount: rows.length };
}
