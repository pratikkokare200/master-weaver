/**
 * The 15-minute price cron.
 *
 * Enqueues one `scheduled` job per ACTIVE collector, which the poll loop then claims like any
 * other. The cron never scrapes anything itself — keeping it to a single INSERT means a slow run
 * cannot delay the next tick, and it is why the interval stays honest as the collector count grows.
 *
 * Doc 03 section 8 lists a gap-free five-day price history as demo-critical, so the first tick is
 * aligned to the wall clock rather than to process start: ticks land on :00 and :30 whether the
 * worker booted at 14:03 or 14:29, and a restart does not shift the whole series.
 */

import type { Queryable } from './db.js';
import type { Logger } from './log.js';
import { enqueueScheduledRuns } from './queue.js';

/**
 * Milliseconds until the next tick aligned to the epoch.
 *
 * With a 15-minute interval that is the next :00, :15, :30 or :45. Returns a full interval rather than 0 when
 * already exactly on a boundary, so a boot at exactly :30 does not fire twice.
 */
export function msUntilNextBoundary(nowMs: number, intervalMs: number): number {
  const past = nowMs % intervalMs;
  return past === 0 ? intervalMs : intervalMs - past;
}

export interface CronDeps {
  db: Queryable;
  log: Logger;
  intervalMs: number;
  /** Fire immediately at boot rather than waiting for the next aligned tick. */
  runOnBoot: boolean;
  now?: () => number;
}

export interface CronHandle {
  stop(): void;
  /** Run one tick now. Exposed for tests and for a manual kick. */
  tick(): Promise<number>;
}

export function startCron(deps: CronDeps): CronHandle {
  const now = deps.now ?? Date.now;
  let timer: NodeJS.Timeout | undefined;
  let interval: NodeJS.Timeout | undefined;
  let stopped = false;

  async function tick(): Promise<number> {
    try {
      const enqueued = await enqueueScheduledRuns(deps.db);
      if (enqueued.length > 0) {
        deps.log.info('cron enqueued scheduled runs', {
          count: enqueued.length,
          collector_ids: enqueued.map((job) => job.collector_id),
        });
      } else {
        deps.log.debug('cron tick enqueued nothing', {
          reason: 'no ACTIVE collectors, or each already has a scheduled job outstanding',
        });
      }
      return enqueued.length;
    } catch (error) {
      // A failed tick must not kill the loop: the next one is thirty minutes away and the queue is
      // still being drained by the poller in the meantime.
      deps.log.error('cron tick failed', { error });
      return 0;
    }
  }

  function beginInterval(): void {
    if (stopped) return;
    void tick();
    interval = setInterval(() => void tick(), deps.intervalMs);
    interval.unref?.();
  }

  if (deps.runOnBoot) {
    beginInterval();
  } else {
    const delay = msUntilNextBoundary(now(), deps.intervalMs);
    deps.log.info('cron scheduled', {
      interval_ms: deps.intervalMs,
      first_tick_in_ms: delay,
      first_tick_at: new Date(now() + delay).toISOString(),
    });
    timer = setTimeout(beginInterval, delay);
    timer.unref?.();
  }

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    },
    tick,
  };
}
