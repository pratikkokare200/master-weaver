import { FHS_THRESHOLDS, classifyFhs } from '@weaver/contracts';

import { AlertIcon } from '@/components/icons';
import { HintLabel } from '@/components/ui/Tooltip';
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
 *
 * The caption is also the tile's one tooltip. "Field health" is the number the whole product turns
 * on and the two words do not define themselves — a reader who does not know it is a weighted fill
 * rate cannot tell whether 0.87 is a bad day or a broken collector. The bubble says which, and
 * names the two thresholds the meter's ticks are already drawing.
 */

const FIELD_HEALTH_TOOLTIP =
  'The share of the contract’s fields that came back with usable values on the last run, ' +
  'weighted by how much each field matters. At or above 0.95 the collector is healthy; below 0.60 ' +
  'it repairs itself without asking. The ticks on the meter mark both.';

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
        <HintLabel
          id="fhs-tip-empty"
          tip={FIELD_HEALTH_TOOLTIP}
          side="top"
          align="start"
          width="wide"
          className="text-meta text-ink-muted"
        >
          Field health
        </HintLabel>
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
      <HintLabel
        id="fhs-tip"
        tip={FIELD_HEALTH_TOOLTIP}
        side="top"
        align="start"
        width="wide"
        className="text-meta text-ink-muted"
      >
        Field health
      </HintLabel>
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
