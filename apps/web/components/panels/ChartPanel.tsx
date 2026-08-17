'use client';

import { ChartIcon } from '@/components/icons';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { ChartSkeleton } from '@/components/states/Skeletons';
import type { PanelState } from '@/lib/panelState';

/**
 * Chart panel.
 *
 * **Scope note:** the plotted series land on Day 3 with Recharts (doc 02 timeline). What this file
 * provides today is the exact frame they drop into — axis gutter, horizontal-only hairline
 * gridlines, and the right-hand rail reserved for direct end-of-line labels — so adding the series
 * later shifts nothing.
 *
 * Two doc 05 §5 rules are already baked into the geometry and must survive Day 3:
 *   - **Never a dual-axis chart** (§5.4). Price and field health are different measures at
 *     different scales: they get two stacked charts sharing an x-axis. That also demos better —
 *     the health collapse and the price column emptying line up vertically at the same timestamp.
 *   - **Direct end labels, not a legend** (§5.3). Three of the five light-mode series colors sit
 *     below 3:1 against white, which is only legal with relief; the label rail is that relief.
 */

function ChartFrame() {
  return (
    <div className="px-4 py-4">
      <div className="flex gap-3" style={{ height: 280 }}>
        <div className="flex w-10 flex-col justify-between py-1 text-right text-meta tabular-nums text-ink-muted">
          <span>2400</span>
          <span>1800</span>
          <span>1200</span>
          <span>600</span>
          <span>0</span>
        </div>

        {/* Horizontal gridlines only — never vertical, never dark (§5.5). */}
        <div className="relative flex-1 border-b border-l border-hairline">
          {[0, 25, 50, 75].map((top) => (
            <div
              key={top}
              className="absolute inset-x-0 border-t border-hairline"
              style={{ top: `${top}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="max-w-xs rounded-control border border-hairline bg-plane px-3 py-2 text-center text-meta text-ink-muted">
              Price history renders here once run history exists.
            </p>
          </div>
        </div>

        {/* Reserved rail for direct end-of-line labels. */}
        <div className="w-24 shrink-0" aria-hidden="true" />
      </div>

      {/* Mirrors the plot row's own columns rather than re-deriving the offset with padding, so
          the axis labels stay aligned if the gutter or label rail ever changes width. */}
      <div className="mt-3 flex gap-3">
        <div className="w-10 shrink-0" aria-hidden="true" />
        <div className="flex flex-1 justify-between text-meta tabular-nums text-ink-muted">
          <span>08:00</span>
          <span>10:00</span>
          <span>12:00</span>
          <span>14:00</span>
          <span>16:00</span>
        </div>
        <div className="w-24 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
}

export function ChartPanel({ state }: { state: PanelState }) {
  if (state === 'loading') return <ChartSkeleton />;

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't load run history"
        description="Price history needs at least two completed runs. The history query failed."
        detail="supabase: relation 'runs' query timed out"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (state === 'empty') {
    return (
      <EmptyState
        icon={ChartIcon}
        title="Not enough history"
        description="A price chart needs at least two completed runs. Run this collector again to start the series."
        action={{ label: 'Run collector' }}
      />
    );
  }

  return <ChartFrame />;
}
