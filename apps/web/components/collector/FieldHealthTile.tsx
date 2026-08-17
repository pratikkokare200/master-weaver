import { FHS_THRESHOLDS, classifyFhs } from '@weaver/contracts';

import { AlertIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { EM_DASH, formatFhs } from '@/lib/format';

/**
 * Field health stat tile — doc 05 §5.6.
 *
 * "A single current value is a headline number, not a chart." So: a muted label, the value at
 * 28px/600 colored by status band, a 4px meter track, and an icon-plus-label status line.
 *
 * The meter carries hairline ticks at the two decision points, read from `FHS_THRESHOLDS` rather
 * than retyped. That single detail is what converts a decorative gauge into an explanation of the
 * system's logic — a judge can see *where* the value sits relative to the thresholds that decide
 * whether the system repairs itself or asks.
 *
 * Status never rides on hue alone, so the caption always pairs an icon with a word.
 */

const BAND_COLOR = {
  HEALTHY: 'var(--status-good)',
  DEGRADED: 'var(--status-warning)',
  BROKEN: 'var(--status-critical)',
} as const;

const BAND_LABEL = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  BROKEN: 'Broken',
} as const;

export interface FieldHealthTileProps {
  fhs: number | null;
  /** Fields below their minimum fill rate, summarised beside the band label. */
  failedFields?: string[];
  className?: string;
}

export function FieldHealthTile({ fhs, failedFields = [], className }: FieldHealthTileProps) {
  if (fhs === null) {
    return (
      <div className={cn('min-w-44', className)}>
        <p className="text-meta text-ink-muted">Field health</p>
        <p className="mt-1 text-stat font-semibold leading-none text-ink-muted">{EM_DASH}</p>
        <div className="mt-3 h-1 w-full rounded-badge bg-hairline" />
        <p className="mt-2 text-meta text-ink-muted">No runs yet</p>
      </div>
    );
  }

  const band = classifyFhs(fhs);
  const color = BAND_COLOR[band];
  const ratio = Math.max(0, Math.min(1, fhs));

  return (
    <div className={cn('min-w-44', className)}>
      <p className="text-meta text-ink-muted">Field health</p>
      <p className="mt-1 text-stat font-semibold leading-none" style={{ color }}>
        {formatFhs(fhs)}
      </p>

      <div className="relative mt-3 h-1 w-full overflow-hidden rounded-badge bg-hairline">
        <div
          className="h-full rounded-badge"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
        {/* Decision-point ticks — 0.60 and 0.95, straight from the engine constants. */}
        {[FHS_THRESHOLDS.DEGRADED, FHS_THRESHOLDS.HEALTHY].map((threshold) => (
          <span
            key={threshold}
            className="absolute top-0 h-full w-px bg-surface"
            style={{ left: `${threshold * 100}%` }}
            aria-hidden="true"
          />
        ))}
      </div>

      <p className="mt-2 flex items-center gap-2 text-meta text-ink-secondary">
        {band !== 'HEALTHY' ? (
          <AlertIcon size={12} className="shrink-0" style={{ color }} />
        ) : null}
        <span>
          {BAND_LABEL[band]}
          {failedFields.length > 0 ? ` · ${failedFields.join(', ')}` : ''}
        </span>
      </p>
    </div>
  );
}
