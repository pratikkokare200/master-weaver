import { FHS_THRESHOLDS } from '@weaver/contracts';

import { InfoIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { formatGoldenSet, formatPercent, formatPercentRange } from '@/lib/format';
import type { GoldenSetInfo } from '@/lib/seed';

/**
 * CollectorPolicyBlock — doc 05 §6.
 *
 * States the two hardcoded autonomy rules in plain language, so a judge can read *why* one break
 * healed itself and another stopped and asked, before observing either.
 *
 * Read-only by design. No toggle, no switch, no disabled-looking control: "a disabled-looking
 * control invites a click and then disappoints; a statement doesn't." There is no configurability
 * to imply — see ADR-005 for why the toggle was deferred rather than shipped.
 *
 * Thresholds come from `FHS_THRESHOLDS` in `@weaver/contracts`, the same constant the engine
 * branches on. They are never retyped here: a policy card that drifts from actual behaviour is
 * worse than no card.
 */

const WEAK_GOLDEN_SET_TOOLTIP =
  'Repairs are verified against one reference page. Add more URLs to strengthen verification.';

const GOLDEN_SET_TOOLTIP =
  'Reference pages captured at last-known-good. A repair must reproduce them before the collector is marked restored.';

interface PolicyRowProps {
  /** Status color from doc 05 §5.2 — never a chart series color. */
  dotColor: string;
  severity: string;
  threshold: string;
  behaviour: string;
}

function PolicyRow({ dotColor, severity, threshold, behaviour }: PolicyRowProps) {
  return (
    <div className="grid grid-cols-[8px_1fr_auto] items-center gap-x-3">
      {/* The dot never carries the meaning alone — it always sits beside its text label (§5.2). */}
      <span
        className="h-2 w-2 rounded-badge"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-cell text-ink">{severity}</span>
        <span className="text-cell text-ink-muted">{threshold}</span>
      </span>
      <span className="text-cell font-semibold text-ink">{behaviour}</span>
    </div>
  );
}

/** Informational only — focusable so the tooltip is reachable by keyboard, but not an action. */
function InfoTip({ label, muted }: { label: string; muted: boolean }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="note"
        aria-label={label}
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-badge',
          muted ? 'text-ink-muted' : 'text-ink-secondary',
        )}
      >
        <InfoIcon size={14} />
      </span>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-56 rounded-control',
          'border border-hairline bg-raised px-3 py-2 text-meta text-ink-secondary',
          'opacity-0 shadow-floating transition-opacity duration-200',
          'group-hover:opacity-100 group-focus-within:opacity-100',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export interface CollectorPolicyBlockProps {
  goldenSet: GoldenSetInfo;
  className?: string;
}

export function CollectorPolicyBlock({ goldenSet, className }: CollectorPolicyBlockProps) {
  // A golden set of 1 is a weaker regression test. Show that honestly in muted ink — it is lower
  // confidence, not an error, so it must not take a warning colour (doc 05 §6).
  const isWeak = goldenSet.count === 1;

  return (
    <section
      aria-label="Repair policy"
      className={cn('rounded-card border border-hairline bg-surface', className)}
    >
      <div className="px-4 pt-3 pb-4">
        <h3 className="text-meta font-medium text-ink-muted">Repair policy</h3>

        <div className="mt-3 space-y-2">
          <PolicyRow
            dotColor="var(--status-critical)"
            severity="Catastrophic"
            threshold={`health < ${formatPercent(FHS_THRESHOLDS.DEGRADED)}`}
            behaviour="Automatic"
          />
          <PolicyRow
            dotColor="var(--status-warning)"
            severity="Partial"
            threshold={`health ${formatPercentRange(
              FHS_THRESHOLDS.DEGRADED,
              FHS_THRESHOLDS.HEALTHY,
            )}`}
            behaviour="Ask me"
          />
        </div>

        <p className="mt-3 text-meta text-ink-muted">
          Repairs are always verified before they commit, on both paths.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2">
        <span className={cn('text-meta', isWeak ? 'text-ink-muted' : 'text-ink-secondary')}>
          {formatGoldenSet(goldenSet.count, goldenSet.shape)}
        </span>
        <InfoTip label={isWeak ? WEAK_GOLDEN_SET_TOOLTIP : GOLDEN_SET_TOOLTIP} muted={isWeak} />
      </div>
    </section>
  );
}
