'use client';

import { HealthBadge } from '@/components/collector/HealthBadge';
import { HintLabel } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import type { LiveStatus } from '@/lib/queries.server';
import { useLiveStatus } from '@/lib/useLiveStatus';

/**
 * The live health monitor — the badge that follows a repair while it happens.
 *
 * This is the surface doc 04 Beat 5 is about. A repair takes 30 to 60 seconds and passes through
 * six run states, and a dashboard that shows `BROKEN` and then `RESTORED` with nothing in between
 * asks you to take the middle on faith. Watching `Diagnosing… → Healing… → Verifying fix…` land in
 * sequence is the difference between a claim and a demonstration.
 *
 * Seeded from the server render, so there is no flash of empty state before the first poll: the
 * value is already correct on paint, and polling only keeps it that way.
 *
 * **It never invents a state.** `runs.run_state` is written by the worker as it walks the frozen
 * transition table; this reads that column and nothing else. No optimistic transitions, no
 * client-side guess at what should come next — a badge that predicts the next state will eventually
 * predict a repair that failed.
 */

/**
 * Four decimal places is not false precision here: the scorer's own thresholds are 0.95 and 0.60,
 * and a collector sitting at 0.9499 is on the other side of a decision from one at 0.9501. The
 * tooltip says which decision, because the number alone does not.
 */
const HEALTH_TOOLTIP =
  'Field health on the most recent run: the share of contracted fields that came back usable, ' +
  'weighted by importance. At or above 0.95 this collector is healthy, below 0.60 it repairs ' +
  'itself, and in between it stops and asks you first.';

export interface LiveHealthProps {
  collectorId: string;
  initial: LiveStatus | null;
}

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return 'never';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function LiveHealth({ collectorId, initial }: LiveHealthProps) {
  const { status, error, loaded } = useLiveStatus(collectorId, initial);
  const current = status ?? initial;

  if (!current) return null;

  return (
    <section
      aria-label="Live collector health"
      className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-6"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <HealthBadge state={current.runState} collectorId={collectorId} />

        <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div>
            <dt>
              <HintLabel
                id="live-health-tip"
                tip={HEALTH_TOOLTIP}
                side="bottom"
                align="start"
                width="wide"
                className="text-meta text-ink-muted"
              >
                Health
              </HintLabel>
            </dt>
            <dd className="text-stat tabular-nums text-ink">
              {current.fhs === null ? '—' : current.fhs.toFixed(4)}
            </dd>
          </div>
          <div>
            <dt className="text-meta text-ink-muted">Rows</dt>
            <dd className="text-stat tabular-nums text-ink">{current.rowCount ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-meta text-ink-muted">Last run</dt>
            <dd className="text-body text-ink-secondary">{relative(current.lastRunAt)}</dd>
          </div>
        </dl>

        {/* Only while something is genuinely in flight. A permanent "live" dot is decoration; one
            that appears exactly when work starts is information. */}
        {current.working ? (
          <span className="ml-auto flex items-center gap-2 text-meta text-healing-ink">
            <span
              aria-hidden
              className="h-2 w-2 animate-pulse rounded-badge bg-healing motion-reduce:animate-none"
            />
            working
          </span>
        ) : null}
      </div>

      {current.failedFields.length > 0 ? (
        <p className="text-meta text-ink-muted">
          Failing:{' '}
          <span className="text-status-critical">{current.failedFields.join(', ')}</span>
          {current.healthyFields.length > 0 ? (
            <>
              {' · still working: '}
              <span className="text-ink-secondary">{current.healthyFields.join(', ')}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {/* Said plainly rather than hidden. A dashboard that has stopped updating while still
          displaying numbers is worse than one that admits it. */}
      {error ? (
        <p role="status" className={cn('text-meta', 'text-status-critical')}>
          {error}
        </p>
      ) : null}

      {!loaded ? <p className="text-meta text-ink-muted">Connecting…</p> : null}
    </section>
  );
}
