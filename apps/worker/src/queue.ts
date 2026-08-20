/**
 * The job queue, on Postgres.
 *
 * The claim is the only piece of this worker that has to be exactly right under concurrency, so it
 * is one statement:
 *
 *   UPDATE jobs SET state = 'CLAIMED' ... WHERE id = (
 *     SELECT id FROM jobs WHERE state = 'PENDING' ... FOR UPDATE SKIP LOCKED LIMIT 1
 *   )
 *
 * `FOR UPDATE` takes a row lock inside the subquery; `SKIP LOCKED` makes a second worker step over
 * the locked row instead of blocking on it. Two workers polling the same instant therefore claim
 * two different jobs, and neither waits. Doing this as a SELECT then a separate UPDATE would let
 * both read the same id in the gap between the statements, and both would run the scrape.
 *
 * Every function here takes a {@link Queryable} so the tests can run these exact statements against
 * a real Postgres.
 */

import type { Job, JobKind, JobState } from '@weaver/contracts';

import type { Queryable } from './db.js';

/**
 * Claim the next due job for this worker.
 *
 * `scheduled_for <= now()` is what makes the backoff work: a retried job is pushed into the future
 * and is simply not due yet. Ordering by `scheduled_for, id` gives a stable FIFO and matches the
 * partial index on PENDING.
 */
const CLAIM_SQL = `
update jobs as j
   set state      = 'CLAIMED',
       attempts   = j.attempts + 1,
       claimed_at = now(),
       claimed_by = $1
 where j.id = (
         select id
           from jobs
          where state = 'PENDING'
            and scheduled_for <= now()
          order by scheduled_for, id
            for update skip locked
          limit 1
       )
returning j.*`;

export async function claimNextJob(db: Queryable, workerId: string): Promise<Job | null> {
  const { rows } = await db.query<Job>(CLAIM_SQL, [workerId]);
  return rows[0] ?? null;
}

/** Mark a claimed job finished. `claimed_by` is left in place as the record of which worker ran it. */
export async function completeJob(db: Queryable, jobId: string): Promise<void> {
  await db.query(`update jobs set state = 'DONE', error = null where id = $1`, [jobId]);
}

/** Abandon a job permanently. The run row it produced, if any, keeps its own state. */
export async function failJob(db: Queryable, jobId: string, error: string): Promise<void> {
  await db.query(`update jobs set state = 'FAILED', error = $2 where id = $1`, [jobId, error]);
}

/**
 * Return a job to the queue with a delay.
 *
 * The claim is released — `claimed_at`/`claimed_by` are cleared — because a PENDING row carrying a
 * stale claim would confuse the reaper about which worker, if any, still holds it.
 */
export async function retryJob(
  db: Queryable,
  jobId: string,
  error: string,
  delayMs: number,
): Promise<void> {
  await db.query(
    `update jobs
        set state         = 'PENDING',
            error         = $2,
            scheduled_for = now() + make_interval(secs => $3::double precision),
            claimed_at    = null,
            claimed_by    = null
      where id = $1`,
    [jobId, error, delayMs / 1000],
  );
}

/** Exponential backoff on the attempt count, so a flapping target is not hammered. */
export function backoffMs(attempts: number, baseMs: number): number {
  const exponent = Math.max(0, attempts - 1);
  return baseMs * 2 ** Math.min(exponent, 6);
}

/**
 * Recover jobs whose worker died mid-run.
 *
 * Without this a hard kill — an OOM, a platform redeploy in the middle of a scrape — strands the
 * job in CLAIMED forever and the collector silently stops being monitored. A job that has already
 * used its attempts is failed rather than requeued, so a job that reliably kills its worker does
 * not take down every worker in turn.
 */
export interface ReapedJob {
  id: string;
  collector_id: string;
  state: JobState;
  attempts: number;
}

export async function reapStaleClaims(
  db: Queryable,
  claimTimeoutMs: number,
  maxAttempts: number,
): Promise<ReapedJob[]> {
  const { rows } = await db.query<ReapedJob>(
    `update jobs
        set state         = case when attempts >= $2 then 'FAILED' else 'PENDING' end,
            error         = $3,
            claimed_at    = case when attempts >= $2 then claimed_at else null end,
            claimed_by    = case when attempts >= $2 then claimed_by else null end,
            scheduled_for = case when attempts >= $2 then scheduled_for else now() end
      where state = 'CLAIMED'
        and claimed_at < now() - make_interval(secs => $1::double precision)
    returning id, collector_id, state, attempts`,
    [claimTimeoutMs / 1000, maxAttempts, 'claim expired: the worker holding this job stopped responding'],
  );
  return rows;
}

/**
 * Enqueue one `scheduled` job per active collector — the 15-minute price cron.
 *
 * `NOT EXISTS` is what makes this idempotent, and it is doing more than deduplicating a double
 * tick: if the worker falls behind, or is down for two hours, the collector gets *one* catch-up run
 * rather than four queued back to back. A price history with an occasional gap is a smaller problem
 * than a burst of runs that all scrape the same page and bill four times for it.
 */
export interface EnqueuedJob {
  id: string;
  collector_id: string;
}

export async function enqueueScheduledRuns(db: Queryable): Promise<EnqueuedJob[]> {
  const { rows } = await db.query<EnqueuedJob>(
    `insert into jobs (collector_id, kind, state, scheduled_for)
     select c.id, 'scheduled', 'PENDING', now()
       from collectors c
      where c.status = 'ACTIVE'
        and not exists (
              select 1
                from jobs j
               where j.collector_id = c.id
                 and j.kind = 'scheduled'
                 and j.state in ('PENDING', 'CLAIMED')
            )
     returning id, collector_id`,
  );
  return rows;
}

/** Enqueue a single job. Used by tests and by any caller that wants a one-off run. */
export async function enqueueJob(
  db: Queryable,
  collectorId: string,
  kind: JobKind = 'manual',
): Promise<EnqueuedJob> {
  const { rows } = await db.query<EnqueuedJob>(
    `insert into jobs (collector_id, kind, state, scheduled_for)
     values ($1, $2, 'PENDING', now())
     returning id, collector_id`,
    [collectorId, kind],
  );
  const job = rows[0];
  if (!job) throw new Error('enqueueJob inserted no row');
  return job;
}

/** Queue depth by state, for the heartbeat log line. */
export async function queueDepth(db: Queryable): Promise<Record<string, number>> {
  const { rows } = await db.query<{ state: JobState; count: string }>(
    `select state, count(*)::text as count from jobs group by state`,
  );
  const depth: Record<string, number> = {};
  for (const row of rows) depth[row.state] = Number(row.count);
  return depth;
}
