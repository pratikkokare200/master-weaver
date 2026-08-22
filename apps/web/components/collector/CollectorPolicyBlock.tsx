import { FHS_THRESHOLDS } from '@weaver/contracts';

import { HintLabel, InfoTip } from '@/components/ui/Tooltip';
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
 *
 * "Catastrophic" and "Partial" are the two words this card rests on, and neither one explains
 * itself — a reader can see that one repairs automatically and the other asks, without ever
 * learning why the machine trusts itself in the first case and not the second. Each carries a
 * tooltip that says so.
 */

const CATASTROPHIC_TOOLTIP =
  'Almost nothing came back — the page structure changed underneath the collector. There is no ' +
  'partly-working version left to protect, so the repair runs on its own and tells you afterwards.';

const PARTIAL_TOOLTIP =
  'Some fields still returned and some did not. A repair here could as easily make things worse ' +
  'as better, so the collector stops and asks before spending anything.';

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
  /** What this severity band actually means, and why it earns the behaviour beside it. */
  tip: string;
  tipId: string;
  tipSide: 'top' | 'bottom';
}

function PolicyRow({ dotColor, severity, threshold, behaviour, tip, tipId, tipSide }: PolicyRowProps) {
  return (
    <div className="grid grid-cols-[8px_1fr_auto] items-center gap-x-3">
      {/* The dot never carries the meaning alone — it always sits beside its text label (§5.2). */}
      <span
        className="h-2 w-2 rounded-badge"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className="flex flex-wrap items-baseline gap-x-2">
        <HintLabel id={tipId} tip={tip} side={tipSide} align="start" className="text-cell text-ink">
          {severity}
        </HintLabel>
        <span className="text-cell text-ink-muted">{threshold}</span>
      </span>
      <span className="text-cell font-semibold text-ink">{behaviour}</span>
    </div>
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
      <div className="px-6 py-5">
        <h3 className="text-meta font-medium text-ink-muted">Repair policy</h3>

        <div className="mt-4 space-y-3">
          <PolicyRow
            dotColor="var(--status-critical)"
            severity="Catastrophic"
            threshold={`health < ${formatPercent(FHS_THRESHOLDS.DEGRADED)}`}
            behaviour="Automatic"
            tip={CATASTROPHIC_TOOLTIP}
            tipId="policy-tip-catastrophic"
            tipSide="top"
          />
          <PolicyRow
            dotColor="var(--status-warning)"
            severity="Partial"
            threshold={`health ${formatPercentRange(
              FHS_THRESHOLDS.DEGRADED,
              FHS_THRESHOLDS.HEALTHY,
            )}`}
            behaviour="Ask me"
            tip={PARTIAL_TOOLTIP}
            tipId="policy-tip-partial"
            tipSide="bottom"
          />
        </div>

        <p className="mt-4 text-meta text-ink-muted">
          Repairs are always verified before they commit, on both paths.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-hairline px-6 py-3">
        <span className={cn('text-meta', isWeak ? 'text-ink-muted' : 'text-ink-secondary')}>
          {formatGoldenSet(goldenSet.count, goldenSet.shape)}
        </span>
        <InfoTip
          id="policy-tip-golden-set"
          label={isWeak ? WEAK_GOLDEN_SET_TOOLTIP : GOLDEN_SET_TOOLTIP}
          muted={isWeak}
          side="top"
          align="end"
        />
      </div>
    </section>
  );
}
