'use client';

import { useEffect, useRef, useState } from 'react';

import type { LiveStatus } from './queries.server';

/**
 * Poll one collector's status, adapting the interval to what is happening.
 *
 * Three intervals rather than one, because the two situations have opposite requirements. A healthy
 * collector changes every fifteen minutes and does not deserve a request every two seconds. A repair
 * moves through six states in under a minute, and polling it slowly means the badge shows "Healing…"
 * as a single frozen frame — the animation the whole demo rests on, reduced to a still.
 *
 * So the fast cadence is earned by `working` being true, and it stops as soon as the run settles.
 *
 * The third case is failure. After a few consecutive errors the interval backs off, because a
 * dashboard whose backend is down should not keep a tight request loop pointed at it; recovering the
 * server is more important than refreshing the dot. `error` is exposed so the UI can say so rather
 * than silently continuing to render a number that has stopped being true.
 */

/** Something is in flight — match the badge to it. */
const FAST_MS = 2_000;
/** Settled. The cron is on a fifteen-minute cycle; this is still far more attentive than that. */
const IDLE_MS = 15_000;
/** After `ERRORS_BEFORE_BACKOFF` consecutive failures. */
const BACKOFF_MS = 60_000;
const ERRORS_BEFORE_BACKOFF = 3;

export interface UseLiveStatus {
  status: LiveStatus | null;
  /** Set once polling has failed repeatedly — the UI should stop implying the value is current. */
  error: string | null;
  /** False until the first response of the session, so the UI can show a skeleton rather than zeros. */
  loaded: boolean;
}

export function useLiveStatus(
  collectorId: string,
  initial: LiveStatus | null = null,
): UseLiveStatus {
  const [status, setStatus] = useState<LiveStatus | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(initial !== null);

  // Refs, not state: these are read by the scheduling loop and must never themselves cause a render.
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function tick(): Promise<void> {
      try {
        const response = await fetch(`/api/collectors/${collectorId}/status`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`status ${response.status}`);

        const body = (await response.json()) as LiveStatus;
        if (cancelled) return;

        failures.current = 0;
        setStatus(body);
        setError(null);
        setLoaded(true);
        schedule(body.working ? FAST_MS : IDLE_MS);
      } catch (cause) {
        // An abort is this effect being cleaned up, not a failure. Counting it would have every
        // navigation look like a backend outage.
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;

        failures.current += 1;
        if (failures.current >= ERRORS_BEFORE_BACKOFF) {
          setError('Live updates are not getting through. The values below may be out of date.');
          schedule(BACKOFF_MS);
        } else {
          // A single failed poll is usually a redeploy or a dropped connection. Saying so on the
          // first one trains people to ignore the message.
          schedule(IDLE_MS);
        }
      }
    }

    function schedule(delay: number): void {
      if (cancelled) return;
      timer.current = setTimeout(() => void tick(), delay);
    }

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [collectorId]);

  return { status, error, loaded };
}
