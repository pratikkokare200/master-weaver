/**
 * Graceful shutdown.
 *
 * The contract with the platform: on SIGTERM, stop claiming new work, let the job already in flight
 * finish, then exit 0. That matters more here than in most services — a job abandoned mid-scrape
 * leaves a `runs` row stuck in RUNNING and a `jobs` row stuck in CLAIMED, and neither is recovered
 * until the stale-claim reaper notices ten minutes later.
 *
 * Two escapes from "finish the current job", because a graceful shutdown that never completes is
 * just a hang: a second signal exits immediately, and a watchdog forces the exit once the grace
 * period expires. The grace default outlasts the CLI's own run timeout plus its kill grace, so in
 * practice the in-flight job always gets to finish on its own.
 */

import type { Logger } from './log.js';

export interface ShutdownDeps {
  log: Logger;
  graceMs: number;
  /** Injectable for tests. Defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Injectable for tests. Defaults to `process.on`. */
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
}

export interface Lifecycle {
  /** Aborts the moment shutdown is requested; passed to every interruptible sleep. */
  readonly signal: AbortSignal;
  readonly stopping: boolean;
  /** Request shutdown. Idempotent; a second call is treated as "stop waiting and go". */
  requestShutdown(reason: string): void;
  /** Stop the watchdog once the loops have drained and exit is imminent. */
  release(): void;
}

export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

export function createLifecycle(deps: ShutdownDeps): Lifecycle {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const onSignal = deps.onSignal ?? ((signal, handler) => void process.on(signal, handler));

  const controller = new AbortController();
  let stopping = false;
  let watchdog: NodeJS.Timeout | undefined;

  function requestShutdown(reason: string): void {
    if (stopping) {
      deps.log.warn('second shutdown signal — exiting now', { reason });
      exit(1);
      return;
    }

    stopping = true;
    deps.log.info('shutdown requested — finishing the current job', {
      reason,
      grace_ms: deps.graceMs,
    });
    controller.abort();

    watchdog = setTimeout(() => {
      deps.log.error('shutdown grace expired — forcing exit', { grace_ms: deps.graceMs });
      exit(1);
    }, deps.graceMs);
    // The watchdog must not itself keep the process alive once everything else has drained.
    watchdog.unref?.();
  }

  for (const signal of SHUTDOWN_SIGNALS) {
    onSignal(signal, () => requestShutdown(signal));
  }

  return {
    signal: controller.signal,
    get stopping(): boolean {
      return stopping;
    },
    requestShutdown,
    release(): void {
      if (watchdog) clearTimeout(watchdog);
    },
  };
}
