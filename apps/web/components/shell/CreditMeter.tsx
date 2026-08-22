import { cn } from '@/lib/cn';

/**
 * CreditMeter — sidebar footer (doc 05 §6). Balance, a thin meter, and today's spend.
 *
 * Placeholder: the numbers are seeded. Day 4 wires this to `brightdata budget`, which the adapter
 * already exposes — the props below are the shape that call returns.
 *
 * Turns apricot below 20% remaining, per §6. That is an attention signal, which is the one use the
 * healing hue is licensed for outside the healing state itself.
 */

const LOW_BALANCE_RATIO = 0.2;

export interface CreditMeterProps {
  remaining: number;
  total: number;
  spentToday: number;
}

export function CreditMeter({ remaining, total, spentToday }: CreditMeterProps) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const isLow = ratio < LOW_BALANCE_RATIO;

  return (
    <div className="border-t border-hairline px-4 py-4">
      <div className="flex items-baseline justify-between">
        <span className="text-meta text-ink-muted">Credits</span>
        <span className={cn('text-cell font-semibold', isLow ? 'text-healing-ink' : 'text-ink')}>
          {remaining.toLocaleString('en-US')}
        </span>
      </div>

      {/* 4px track, rounded ends — same meter geometry as the FHS stat tile (§5.6). */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-badge bg-hairline">
        <div
          className={cn('h-full rounded-badge', isLow ? 'bg-healing' : 'bg-accent')}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>

      <p className="mt-2 text-meta text-ink-muted">
        {spentToday.toLocaleString('en-US')} spent today
      </p>
    </div>
  );
}
