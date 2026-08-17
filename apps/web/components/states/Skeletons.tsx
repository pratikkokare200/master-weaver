import { cn } from '@/lib/cn';

/**
 * Loading states.
 *
 * Doc 05 §8/§9: skeleton rows matching the final layout, **never a centered spinner**. A spinner
 * occupies no space and then the content lands, which shifts the page; a skeleton reserves the exact
 * geometry the content will occupy, so the transition to populated moves nothing.
 *
 * Every skeleton here is built from the same measurements as the component it stands in for — the
 * table skeleton takes the same column definitions as the real table, so the two cannot drift.
 */

export function SkeletonBar({
  width = '100%',
  height = 8,
  className,
}: {
  width?: string | number;
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('skeleton rounded-control', className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export interface SkeletonColumn {
  /** Matches the real table's column width so the swap to populated shifts nothing. */
  width: string;
  /** Skeleton bar width inside the cell, as a percentage of the column. */
  fill?: string;
  align?: 'left' | 'right';
}

/** Table loading state — sticky header plus 36px rows, mirroring WorkspaceTable (doc 05 §6). */
export function TableSkeleton({
  columns,
  rows = 8,
}: {
  columns: SkeletonColumn[];
  rows?: number;
}) {
  return (
    <div role="status" aria-label="Loading rows" className="w-full overflow-hidden">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {columns.map((column, index) => (
            <col key={index} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((column, index) => (
              <th key={index} className="h-9 px-4 text-left align-middle">
                <SkeletonBar width="60%" height={8} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b border-hairline last:border-b-0">
              {columns.map((column, columnIndex) => (
                <td key={columnIndex} className="h-9 px-4 align-middle">
                  <div className={cn('flex', column.align === 'right' && 'justify-end')}>
                    <SkeletonBar width={column.fill ?? '70%'} height={8} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Chart loading state.
 *
 * Reserves the axis gutter, the plot area and the direct-label rail on the right, because the real
 * chart carries end-of-line labels rather than a legend (doc 05 §5.3).
 */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div role="status" aria-label="Loading chart" className="w-full px-4 py-4">
      <div className="flex gap-3" style={{ height }}>
        {/* y-axis tick gutter */}
        <div className="flex w-10 flex-col justify-between py-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonBar key={index} width="100%" height={7} />
          ))}
        </div>

        {/* plot area — horizontal hairline gridlines only, never vertical (§5.5) */}
        <div className="relative flex-1 border-b border-l border-hairline">
          {[0, 25, 50, 75].map((top) => (
            <div
              key={top}
              className="absolute inset-x-0 border-t border-hairline"
              style={{ top: `${top}%` }}
            />
          ))}
        </div>

        {/* direct end-label rail */}
        <div className="flex w-24 flex-col justify-around py-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonBar key={index} width="85%" height={8} />
          ))}
        </div>
      </div>

      {/* x-axis labels — same column structure as the plot row, so the skeleton and the real
          chart share one alignment rule. */}
      <div className="mt-3 flex gap-3">
        <div className="w-10 shrink-0" aria-hidden="true" />
        <div className="flex flex-1 justify-between">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonBar key={index} width={36} height={7} />
          ))}
        </div>
        <div className="w-24 shrink-0" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Timeline loading state — ledger rows and chat turns share this geometry. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-hairline">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 px-4 py-4">
          <SkeletonBar width={8} height={8} className="mt-1 shrink-0 rounded-badge" />
          <div className="flex-1 space-y-2">
            <SkeletonBar width="42%" height={8} />
            <SkeletonBar width="72%" height={8} />
          </div>
          <SkeletonBar width={56} height={8} className="mt-1 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Code / JSON loading state — monospace line rhythm. */
export function CodeSkeleton({ lines = 12 }: { lines?: number }) {
  const widths = ['38%', '64%', '52%', '71%', '45%', '60%', '33%', '68%', '55%', '41%', '62%', '30%'];
  return (
    <div role="status" aria-label="Loading JSON" className="space-y-2 px-4 py-4">
      {Array.from({ length: lines }).map((_, index) => (
        <SkeletonBar key={index} width={widths[index % widths.length]} height={8} />
      ))}
    </div>
  );
}
