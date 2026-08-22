import Link from 'next/link';

import {
  HEALTH_HEADLINE_LABEL,
  type HealthHeadline,
  RUN_STATE_LABEL,
  type RunState,
  headlineFor,
} from '@weaver/contracts';

import { cn } from '@/lib/cn';

/**
 * HealthBadge — doc 05 §4. The component the demo lives on.
 *
 * All 17 internal states (doc 01 §2.1) collapse to six visual buckets, with the precise state
 * rendered underneath: judges read the headline, and the sub-caption proves there is a real state
 * machine underneath rather than three hardcoded screens.
 *
 * One bucket carries two labels — see HEADLINE_OVERRIDES below.
 *
 * Presentational for now — it takes a `state` prop and renders it. Day 3 wires this to Supabase
 * Realtime; the geometry below is already fixed so that swap changes nothing on screen.
 *
 * The requirements that matter, all from §4:
 *   - Every state renders at identical height. The sub-caption line is always present, so a
 *     transition never reflows the header. Shift here would land on the exact shot the demo video
 *     is built around (doc 04 Beat 5).
 *   - Transitions cross-fade over 200ms. No slide, no bounce.
 *   - The pulse is opacity 1 → 0.55 → 1 over 1.6s, on the dot only — never the text.
 *   - **Healing pulses, degraded does not.** Same hue, opposite meaning: motion says "working",
 *     stillness plus a button says "waiting on you". A viewer reads the difference in under a
 *     second without reading the words.
 *   - `prefers-reduced-motion` drops the pulse and keeps the color (handled in globals.css).
 */

interface HeadlineStyle {
  /** Tailwind classes for the badge container. */
  container: string;
  /** Dot color token. */
  dot: string;
  /** Whether the dot pulses. Only the two "in flight" headlines do. */
  pulse: boolean;
}

const HEADLINE_STYLES: Record<HealthHeadline, HeadlineStyle> = {
  IDLE: {
    container: 'bg-surface text-ink-secondary',
    dot: 'var(--ink-muted)',
    pulse: false,
  },
  SCRAPING: {
    container: 'bg-surface text-ink',
    dot: 'var(--accent)',
    pulse: true,
  },
  HEALING: {
    container: 'bg-healing-plane text-healing-ink',
    dot: 'var(--healing)',
    pulse: true,
  },
  DEGRADED: {
    // Same apricot as healing, deliberately static — this one is waiting on a human.
    container: 'bg-healing-plane text-healing-ink',
    dot: 'var(--healing)',
    pulse: false,
  },
  RESTORED: {
    container: 'bg-success-plane text-success-ink',
    dot: 'var(--success)',
    pulse: false,
  },
  QUARANTINED: {
    container: 'bg-status-critical-plane text-status-critical',
    dot: 'var(--status-critical)',
    pulse: false,
  },
};

/**
 * Per-state headline overrides.
 *
 * Doc 05 §4 collapses HEALTHY and RESTORED into one headline bucket, which makes a collector that
 * has never broken announce "✅ Pipeline Restored" — it claims a repair that never happened, on the
 * landing screen, which is the first thing a judge sees.
 *
 * Doc 01 §2.1 — the primary spec for the state list — already distinguishes them: HEALTHY is
 * "✅ Healthy" and RESTORED is "✅ Pipeline Restored". So the six buckets stay exactly as they are
 * for *visual treatment* (both remain pastel-mint success styling), and only the label is resolved
 * per state.
 *
 * The strings come from `RUN_STATE_LABEL` in `@weaver/contracts` rather than being retyped here,
 * for the same reason the policy card reads its thresholds from the engine: a label that drifts
 * from the state machine is worse than no label.
 */
const HEADLINE_OVERRIDES: Partial<Record<RunState, string>> = {
  HEALTHY: RUN_STATE_LABEL.HEALTHY,
  RESTORED: RUN_STATE_LABEL.RESTORED,
};

function headlineLabelFor(state: RunState, headline: HealthHeadline): string {
  return HEADLINE_OVERRIDES[state] ?? HEALTH_HEADLINE_LABEL[headline];
}

export interface HealthBadgeProps {
  state: RunState;
  /** Enables the Repair action on the degraded headline. */
  collectorId?: string;
  className?: string;
}

export function HealthBadge({ state, collectorId, className }: HealthBadgeProps) {
  const headline = headlineFor(state);
  const style = HEADLINE_STYLES[headline];

  // The degraded label is the only badge that carries an action (§4). It links to the deep-link
  // contract route so the Discord alert and this button land on the same confirmation.
  const showRepair = headline === 'DEGRADED' && Boolean(collectorId);

  return (
    <div
      className={cn(
        'badge-crossfade flex min-h-14 items-center gap-3 rounded-card border border-hairline px-4 py-3',
        style.container,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        className={cn('h-2 w-2 shrink-0 rounded-badge', style.pulse && 'dot-pulse')}
        style={{ backgroundColor: style.dot }}
        aria-hidden="true"
      />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium">{headlineLabelFor(state, headline)}</span>
        {/* Always rendered, so the badge height never changes between states. */}
        <span className="truncate text-meta tracking-wide text-current opacity-70">{state}</span>
      </span>

      {showRepair ? (
        <Link
          href={`/c/${collectorId}?action=repair`}
          className="shrink-0 rounded-control border border-healing-ink/25 bg-surface px-3 py-2 text-cell font-medium text-healing-ink transition-colors hover:bg-healing-plane"
        >
          Repair
        </Link>
      ) : null}
    </div>
  );
}
