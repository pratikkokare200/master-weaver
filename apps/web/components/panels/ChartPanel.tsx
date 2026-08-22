'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartIcon } from '@/components/icons';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { ChartSkeleton } from '@/components/states/Skeletons';
import type { HealthPoint, PricePoint } from '@/lib/queries.server';
import type { PanelState } from '@/lib/panelState';

/**
 * Chart panel — median price and field health, stacked on a shared x-axis.
 *
 * Four doc 05 §5 rules are structural here rather than stylistic, and each is load-bearing:
 *
 *   - **Never a dual-axis chart** (§5.4). Price is in dollars and health is a ratio in [0,1];
 *     putting them on one pair of axes invents a relationship between two scales that have none.
 *     Two charts sharing an x-axis says the true thing instead — and demos better, because the
 *     health collapse and the price series ending line up vertically at the same timestamp.
 *   - **Direct end labels, not a legend** (§5.3). Three of the five light-mode series colours sit
 *     below 3:1 against white, which is only permissible with relief. The right-hand rail is that
 *     relief, and it also removes the legend's colour-matching step entirely.
 *   - **Horizontal gridlines only** (§5.5). Vertical rules imply the x-samples are evenly spaced.
 *     They are not — a repair produces several runs a minute apart inside a 15-minute cadence.
 *   - **Status colours are never a series** (§5.2). Mint/apricot/rose mean a health band; a line that
 *     borrows them competes with the badge for the same meaning. The lines are accent-coloured, and
 *     the health thresholds appear as reference lines, which is what those colours are for.
 *
 * The apricot episode markers are the one exception, and they are on-message rather than in tension
 * with it: apricot is reserved for the healing state, and that is precisely what they mark.
 */

const AXIS = 'var(--ink-muted)';
const GRID = 'var(--hairline)';
const SERIES = 'var(--accent)';

/** FHS bands from `@weaver/contracts` — the same numbers the scorer classifies against. */
const HEALTHY_LINE = 0.95;
const BROKEN_LINE = 0.6;

export interface ChartPanelProps {
  state: PanelState;
  price: PricePoint[];
  health: HealthPoint[];
  /** ISO timestamps of healing episodes, marked on the health chart. */
  episodeMarks?: { t: string; restored: boolean }[];
  onRetry?: () => void;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Shared tooltip.
 *
 * Recharts' default renders a white box with no border, which disappears against `--surface`. This
 * one inverts to the tooltip tokens instead — dark slate, 1px border, no shadow — so the chart's
 * callout and the app's tooltips are visibly the same object.
 */
function ChartTooltip({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string | number;
  format: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.value;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;

  return (
    <div className="rounded-control border border-tooltip-plane bg-tooltip-plane px-3 py-2">
      <p className="text-meta text-tooltip-ink opacity-70">
        {typeof label === 'string' ? hhmm(label) : label}
      </p>
      <p className="text-cell tabular-nums text-tooltip-ink">{format(value)}</p>
    </div>
  );
}

function Stack({
  price,
  health,
  episodeMarks = [],
}: {
  price: PricePoint[];
  health: HealthPoint[];
  episodeMarks?: { t: string; restored: boolean }[];
}) {
  const latestPrice = price.at(-1);
  const latestHealth = health.at(-1);

  // Only mark episodes that land on a point the health chart actually plots — a ReferenceDot at an
  // x-value absent from the data is silently dropped by Recharts, which would make a missing marker
  // indistinguishable from an episode that never happened.
  const plotted = new Set(health.map((point) => point.t));
  const marks = episodeMarks.filter((mark) => plotted.has(mark.t));

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <section aria-label="Median product price">
        <div className="flex items-baseline justify-between">
          <h3 className="text-meta uppercase tracking-wide text-ink-muted">Median price</h3>
          {latestPrice ? (
            <p className="text-meta text-ink-muted">
              across {latestPrice.products} product{latestPrice.products === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>

        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={price} margin={{ top: 12, right: 76, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={hhmm}
                stroke={GRID}
                tick={{ fill: AXIS, fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                stroke={GRID}
                tick={{ fill: AXIS, fontSize: 11 }}
                width={52}
                tickFormatter={money}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<ChartTooltip format={money} />} />
              <Line
                type="monotone"
                dataKey="median"
                stroke={SERIES}
                strokeWidth={2}
                // A gap is the honest rendering of a run that produced no priced rows. Joining
                // across it would draw a straight line through a period we have no data for.
                connectNulls={false}
                dot={false}
                // The endpoint is emphasised because it is the value being reported; the rest of
                // the line is context for it.
                activeDot={{ r: 4 }}
                isAnimationActive={false}
                label={undefined}
              />
              {latestPrice ? (
                <ReferenceDot
                  x={latestPrice.t}
                  y={latestPrice.median}
                  r={4}
                  fill={SERIES}
                  stroke="none"
                  label={{
                    value: money(latestPrice.median),
                    position: 'right',
                    fill: 'var(--ink)',
                    fontSize: 12,
                  }}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section aria-label="Field health score">
        <h3 className="text-meta uppercase tracking-wide text-ink-muted">Field health</h3>

        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={health} margin={{ top: 12, right: 76, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={hhmm}
                stroke={GRID}
                tick={{ fill: AXIS, fontSize: 11 }}
                minTickGap={40}
              />
              <YAxis
                stroke={GRID}
                tick={{ fill: AXIS, fontSize: 11 }}
                width={52}
                domain={[0, 1]}
                ticks={[0, BROKEN_LINE, HEALTHY_LINE, 1]}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <Tooltip content={<ChartTooltip format={(v) => v.toFixed(4)} />} />

              {/* The bands, as reference lines rather than series colours (§5.2). */}
              <ReferenceLine
                y={HEALTHY_LINE}
                stroke="var(--status-good)"
                strokeDasharray="3 3"
                label={{ value: 'healthy', position: 'insideTopRight', fill: AXIS, fontSize: 10 }}
              />
              <ReferenceLine
                y={BROKEN_LINE}
                stroke="var(--status-critical)"
                strokeDasharray="3 3"
                label={{ value: 'broken', position: 'insideBottomRight', fill: AXIS, fontSize: 10 }}
              />

              <Line
                type="monotone"
                dataKey="fhs"
                stroke={SERIES}
                strokeWidth={2}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />

              {/* Healing episodes. Apricot is reserved for exactly this. */}
              {marks.map((mark) => (
                <ReferenceLine
                  key={mark.t}
                  x={mark.t}
                  stroke="var(--healing)"
                  strokeDasharray="2 2"
                />
              ))}

              {latestHealth && latestHealth.fhs !== null ? (
                <ReferenceDot
                  x={latestHealth.t}
                  y={latestHealth.fhs}
                  r={4}
                  fill={SERIES}
                  stroke="none"
                  label={{
                    value: latestHealth.fhs.toFixed(2),
                    position: 'right',
                    fill: 'var(--ink)',
                    fontSize: 12,
                  }}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {marks.length > 0 ? (
          <p className="mt-1 text-meta text-ink-muted">
            <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-badge bg-healing" />
            {marks.length} healing episode{marks.length === 1 ? '' : 's'} in this window
          </p>
        ) : null}
      </section>
    </div>
  );
}

export function ChartPanel({ state, price, health, episodeMarks, onRetry }: ChartPanelProps) {
  if (state === 'loading') return <ChartSkeleton />;

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't load run history"
        description="The run history query did not come back. The collector itself is unaffected."
        onRetry={onRetry ?? (() => window.location.reload())}
      />
    );
  }

  // A single point is not a series. Two runs is the honest minimum for a line, and saying so beats
  // rendering one dot in an empty frame and letting someone wonder what broke.
  if (state === 'empty' || health.length < 2) {
    return (
      <EmptyState
        icon={ChartIcon}
        title="Not enough history"
        description="A chart needs at least two completed runs. This collector is on a 15-minute cadence, so the series fills in shortly."
      />
    );
  }

  return <Stack price={price} health={health} episodeMarks={episodeMarks} />;
}
