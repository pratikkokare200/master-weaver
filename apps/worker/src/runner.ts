/**
 * Executing one claimed job: run the scraper, score the result, write the ledger row.
 *
 * The sequence is deliberately the one doc 01 section 2.2 draws:
 *
 *   RUNNING --> VALIDATING --> HEALTHY | DEGRADED | BROKEN
 *   RUNNING --> TRANSIENT_RETRY                       (the CLI call itself failed)
 *
 * and then DISPATCHES on the band it landed in:
 *
 *   HEALTHY  -> refresh the golden baseline, and only here (doc 01 section 3.4)
 *   BROKEN   -> open a healing episode autonomously
 *   DEGRADED -> PENDING_OPERATOR. Notify, and wait for a human. Never heal unattended.
 *
 * The DEGRADED branch is the one to read twice. Architect decision 3 makes severity the
 * authorisation signal, and there is no toggle: a partial break halts here and the repair does not
 * begin until an operator asks for it. The code path to heal it exists and is deliberately not
 * reachable from this function.
 */

import type { BrightDataClient } from '@weaver/brightdata';
import { classifyFhs, type FieldScore, type RunState } from '@weaver/contracts';
import { buildDiagnosis, buildEvidence, decideAfterDegraded, decideAfterValidation } from '@weaver/healing';
import { captureBaseline, scoreFhs } from '@weaver/validation';

import { silentNotifier, type Notifier } from './discord.js';
import { runHealingEpisode } from './episode.js';
import { lastHealthyRows, upsertBaseline } from './episodes.js';

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
  /**
   * The doc 01 section 9 kill switch. False makes the worker refuse to heal while still running and
   * scoring every scrape -- a scraper that cannot repair itself is still worth the data it collects.
   */
  healingEnabled?: boolean;
  /** Discord. Fires on PENDING_OPERATOR here; the episode owns RESTORED and QUARANTINED. */
  notify?: Notifier;
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

  // A repair is an operator's click, not a scrape. It runs against the rows already sitting on the
  // run that is awaiting approval.
  if (job.kind === 'repair') return executeRepairJob(deps, collector, contract);

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

  const validation = decideAfterValidation(breakdown.fhs);
  runLog.info('run scored', { ...summary, band, decision: validation.reason });

  // ── HEALTHY ────────────────────────────────────────────────────────────────────────────────
  if (band === 'HEALTHY') {
    // The ONLY place a baseline is refreshed. Never from a degraded run and never post-heal until
    // the episode reaches RESTORED, or the quality bar ratchets itself down to meet the breakage
    // (doc 01 section 3.4).
    await refreshBaseline(deps, { collectorId: collector.id, contract, rows, log: runLog });
    return { kind: 'scored', runId: run.id, state: band, fhs: breakdown.fhs, rowCount: rows.length };
  }

  // ── DEGRADED: halt and ask ─────────────────────────────────────────────────────────────────
  if (band === 'DEGRADED') {
    const halt = decideAfterDegraded();
    await transitionRun(db, run.id, 'DEGRADED', 'PENDING_OPERATOR');
    runLog.warn('degraded — waiting for an operator', {
      ...summary,
      reason: halt.reason,
      failed_fields: breakdown.failed_fields,
    });

    // Build the diagnosis WITHOUT sending it, so the alert can show what would be proposed. An
    // operator asked to authorise a repair should be able to see the repair. No page context here:
    // that needs a CLI call, and spending one before anybody has agreed to a repair is backwards —
    // it is also the first thing the character budget drops, so its absence changes little.
    const evidence = buildEvidence({
      after: breakdown,
      before: null,
      contract,
      goodRow: null,
      badRow: (rows[0] ?? null) as Record<string, unknown> | null,
      pageMarkdown: null,
    });

    // "Was 0.95, now 0.80" only means something if the first number is real. Read it from the last
    // healthy run rather than assuming a perfect 1.0 — a collector that has always run at 0.97 did
    // not fall from 1.0, and an alert that says it did is inventing the severity.
    const lastGood = await lastHealthyRows(db, collector.id);

    await (deps.notify ?? silentNotifier).pendingOperator({
      collectorId: collector.id,
      collectorName: collector.name,
      fhsBefore: lastGood?.fhs ?? breakdown.fhs,
      fhsNow: breakdown.fhs,
      failedFields: breakdown.failed_fields,
      healthyFields: evidence.healthyFields,
      proposedFix: buildDiagnosis(evidence),
    });

    return {
      kind: 'scored',
      runId: run.id,
      state: 'PENDING_OPERATOR',
      fhs: breakdown.fhs,
      rowCount: rows.length,
    };
  }

  // ── BROKEN: repair autonomously ────────────────────────────────────────────────────────────
  if (deps.healingEnabled === false) {
    runLog.warn('broken, but healing is disabled by the kill switch', summary);
    return { kind: 'scored', runId: run.id, state: band, fhs: breakdown.fhs, rowCount: rows.length };
  }

  runLog.warn('broken — opening an autonomous healing episode', {
    ...summary,
    failed_fields: breakdown.failed_fields,
  });

  try {
    const outcome = await runHealingEpisode(
      { db, brightdata: deps.brightdata, log: runLog, killSwitchEnabled: false, notify: deps.notify },
      { collector, contract, trigger: 'BROKEN', breakdown, badRows: rows },
    );
    runLog.info('healing episode finished', {
      episode_id: outcome.episodeId,
      final_state: outcome.finalState,
      attempts: outcome.attempts,
      credits_spent: outcome.creditsSpent,
      duration_ms: outcome.durationMs,
    });
  } catch (error) {
    // A crashed episode must not fail the job: the run itself succeeded and is already recorded,
    // and re-running the scrape would not fix whatever broke inside the repair loop.
    runLog.error('healing episode crashed', { error });
  }

  return { kind: 'scored', runId: run.id, state: band, fhs: breakdown.fhs, rowCount: rows.length };
}

/**
 * Capture or refresh the golden baseline after a healthy run.
 *
 * Best-effort: a baseline that could not be written is a weaker regression test next time, not a
 * reason to fail a run that genuinely succeeded.
 */
async function refreshBaseline(
  deps: RunnerDeps,
  input: {
    collectorId: string;
    contract: import('@weaver/contracts').CollectorContract;
    rows: unknown[];
    log: Logger;
  },
): Promise<void> {
  const url = input.contract.golden_set[0];
  if (!url) return;

  try {
    const baseline = captureBaseline(input.rows, input.contract);
    if (!baseline) return;

    await upsertBaseline(deps.db, {
      collectorId: input.collectorId,
      url,
      baseline,
      shape: input.contract.golden_set_shape,
    });
  } catch (error) {
    input.log.warn('could not refresh the golden baseline', { error });
  }
}

/**
 * Execute an operator-authorised repair — the other half of doc 01 section 2.2's
 * `PENDING_OPERATOR --> DIAGNOSING`.
 *
 * Deliberately does NOT scrape. The rows are already on the run awaiting approval, and re-scraping
 * would spend credits to re-derive a break we have already measured -- with a real chance of
 * measuring something slightly different and then repairing the wrong thing. The operator approved
 * a specific, visible break; this repairs that one.
 *
 * The score is recomputed from the stored rows rather than read back from `fhs`, so the evidence the
 * diagnosis is built from and the number that justified the prompt cannot drift apart.
 */
async function executeRepairJob(
  deps: RunnerDeps,
  collector: Awaited<ReturnType<typeof getCollector>> & object,
  contract: import('@weaver/contracts').CollectorContract,
): Promise<JobOutcome> {
  const { db, log } = deps;

  const pending = await pendingOperatorRun(db, collector.id);
  if (!pending) {
    // Not an error worth retrying: either another worker took it, or the operator clicked twice.
    return {
      kind: 'permanent',
      error: `collector ${collector.collector_id} has no run awaiting operator approval`,
    };
  }

  const rows = Array.isArray(pending.rows) ? pending.rows : [];
  const breakdown = scoreFhs(rows, contract);

  const repairLog = log.child({ run_id: pending.id, collector_id: collector.collector_id });
  repairLog.info('operator authorised a repair', {
    fhs: breakdown.fhs,
    failed_fields: breakdown.failed_fields,
  });

  if (deps.healingEnabled === false) {
    return { kind: 'permanent', error: 'healing is disabled by the kill switch' };
  }

  try {
    const outcome = await runHealingEpisode(
      { db, brightdata: deps.brightdata, log: repairLog, killSwitchEnabled: false, notify: deps.notify },
      {
        collector,
        contract,
        trigger: 'DEGRADED',
        breakdown,
        badRows: rows,
        runId: pending.id,
        operatorPromptedAt: pending.finished_at ?? null,
        operatorActedAt: new Date(),
      },
    );

    repairLog.info('operator repair finished', {
      episode_id: outcome.episodeId,
      final_state: outcome.finalState,
      attempts: outcome.attempts,
      credits_spent: outcome.creditsSpent,
      duration_ms: outcome.durationMs,
    });

    return {
      kind: 'scored',
      runId: pending.id,
      state: outcome.finalState === 'RESTORED' ? 'RESTORED' : 'QUARANTINED',
      fhs: outcome.fhsAfter ?? breakdown.fhs,
      rowCount: rows.length,
    };
  } catch (error) {
    repairLog.error('operator repair crashed', { error });
    return { kind: 'permanent', error: `the repair episode crashed: ${String(error)}` };
  }
}

/** The run a collector is currently holding at PENDING_OPERATOR, if any. */
async function pendingOperatorRun(
  db: Queryable,
  collectorId: string,
): Promise<{ id: string; rows: unknown[]; finished_at: Date | null } | null> {
  const { rows } = await db.query<{ id: string; rows: unknown[]; finished_at: Date | null }>(
    `select id, "rows", finished_at
       from runs
      where collector_id = $1 and run_state = 'PENDING_OPERATOR'
      order by started_at desc
      limit 1`,
    [collectorId],
  );
  return rows[0] ?? null;
}
