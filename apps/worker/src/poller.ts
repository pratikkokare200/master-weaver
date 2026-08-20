/**
 * The poll loop.
 *
 * Claim a job, run it, record what happened, repeat. The loop only checks whether it is stopping
 * *between* jobs, which is exactly what "finish the current job, then exit" means — there is no
 * cancellation path through a running scrape, by design.
 */

import type { BrightDataClient } from '@weaver/brightdata';

import type { Queryable } from './db.js';
import type { Logger } from './log.js';
import {
  backoffMs,
  claimNextJob,
  completeJob,
  failJob,
  reapStaleClaims,
  retryJob,
} from './queue.js';
import { executeJob } from './runner.js';
import type { Lifecycle } from './shutdown.js';
import { sleep } from './time.js';

export interface PollerDeps {
  db: Queryable;
  brightdata: BrightDataClient;
  log: Logger;
  lifecycle: Lifecycle;
  workerId: string;
  pollIntervalMs: number;
  claimTimeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
  rowHistoryWindow: number;
  /** Doc 01 section 9 kill switch. False: runs still execute, repairs do not. */
  healingEnabled?: boolean;
}

/** Claim and process exactly one job. Returns false when the queue had nothing due. */
export async function pollOnce(deps: PollerDeps): Promise<boolean> {
  const job = await claimNextJob(deps.db, deps.workerId);
  if (!job) return false;

  const jobLog = deps.log.child({ job_id: job.id, attempt: job.attempts });
  jobLog.info('job claimed', { kind: job.kind, collector_id: job.collector_id });

  try {
    const outcome = await executeJob(
      {
        db: deps.db,
        brightdata: deps.brightdata,
        log: jobLog,
        rowHistoryWindow: deps.rowHistoryWindow,
        healingEnabled: deps.healingEnabled,
      },
      job,
    );

    switch (outcome.kind) {
      case 'scored':
        await completeJob(deps.db, job.id);
        jobLog.info('job done', { run_state: outcome.state, fhs: outcome.fhs });
        break;

      case 'permanent':
        await failJob(deps.db, job.id, outcome.error);
        jobLog.error('job failed permanently', { error: outcome.error });
        break;

      case 'transient':
        await rescheduleOrAbandon(deps, job, jobLog, outcome.error);
        break;
    }
  } catch (error) {
    // An unexpected throw — a dropped connection mid-write, a bug — must not leave the job CLAIMED
    // forever. Treat it as transient: it gets the same attempt budget as a failed CLI call.
    const message = error instanceof Error ? error.message : String(error);
    jobLog.error('job threw', { error });
    await rescheduleOrAbandon(deps, job, jobLog, message).catch((writeError: unknown) => {
      // If even the bookkeeping write fails the database is unreachable, and the stale-claim reaper
      // will recover this job once it comes back.
      jobLog.error('could not record job failure', { error: writeError });
    });
  }

  return true;
}

async function rescheduleOrAbandon(
  deps: PollerDeps,
  job: { id: string; attempts: number },
  jobLog: Logger,
  error: string,
): Promise<void> {
  if (job.attempts >= deps.maxAttempts) {
    await failJob(deps.db, job.id, `${error} (gave up after ${job.attempts} attempts)`);
    jobLog.error('job abandoned — attempts exhausted', { error, attempts: job.attempts });
    return;
  }

  const delay = backoffMs(job.attempts, deps.retryBackoffMs);
  await retryJob(deps.db, job.id, error, delay);
  jobLog.warn('job requeued', { error, retry_in_ms: delay });
}

/**
 * Run until shutdown is requested.
 *
 * Jobs are drained back to back with no sleep in between: the interval is how long to wait when the
 * queue is *empty*, not a rate limit on work. A backlog of ten collectors should not take a hundred
 * seconds to start.
 */
export async function runPollLoop(deps: PollerDeps): Promise<void> {
  deps.log.info('poll loop started', {
    worker_id: deps.workerId,
    poll_interval_ms: deps.pollIntervalMs,
  });

  while (!deps.lifecycle.stopping) {
    let didWork = false;
    try {
      await reapClaims(deps);
      didWork = await pollOnce(deps);
    } catch (error) {
      // Almost always the database being briefly unreachable. Back off one interval and retry
      // rather than crashing the process and losing the cron with it.
      deps.log.error('poll tick failed', { error });
    }

    if (!didWork && !deps.lifecycle.stopping) {
      await sleep(deps.pollIntervalMs, deps.lifecycle.signal);
    }
  }

  deps.log.info('poll loop stopped');
}

async function reapClaims(deps: PollerDeps): Promise<void> {
  const reaped = await reapStaleClaims(deps.db, deps.claimTimeoutMs, deps.maxAttempts);
  if (reaped.length === 0) return;

  deps.log.warn('recovered stale claims', {
    count: reaped.length,
    requeued: reaped.filter((job) => job.state === 'PENDING').length,
    failed: reaped.filter((job) => job.state === 'FAILED').length,
  });
}
