/**
 * Waiting, interruptibly.
 *
 * A poll loop that sleeps ten seconds between ticks would otherwise take up to ten seconds to
 * notice a SIGTERM, which on most platforms is most of the shutdown budget spent doing nothing.
 */

/** Sleep, resolving early (and without throwing) if `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    // Do not hold the event loop open on this timer alone: a worker whose loops have all stopped
    // should exit, not linger for the remainder of a poll interval.
    timer.unref?.();

    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }

    signal?.addEventListener('abort', finish, { once: true });
  });
}
