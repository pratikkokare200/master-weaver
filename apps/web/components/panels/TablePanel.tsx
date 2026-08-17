'use client';

import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { TableSkeleton, type SkeletonColumn } from '@/components/states/Skeletons';
import { TableIcon } from '@/components/icons';
import { cn } from '@/lib/cn';
import { formatOrDash, formatPrice } from '@/lib/format';
import type { PanelState } from '@/lib/panelState';
import type { ProductRow } from '@/lib/seed';

/**
 * WorkspaceTable — doc 05 §6.
 *
 * Sticky header, 36px rows, zebra off, hairline row dividers, `tabular-nums` on numeric columns.
 *
 * Null cells render as `—`, never blank. A blank cell reads as a rendering bug; an em-dash reads as
 * "we know this is missing," which is the entire product thesis.
 *
 * The column widths below are shared with the loading skeleton, so the two cannot drift and the
 * swap from loading to populated moves nothing.
 */

const COLUMNS: SkeletonColumn[] = [
  { width: '30%', fill: '72%' },
  { width: '14%', fill: '48%', align: 'right' },
  { width: '13%', fill: '52%' },
  { width: '15%', fill: '56%' },
  { width: '15%', fill: '60%' },
  { width: '13%', fill: '44%' },
];

const HEADERS = ['Product', 'Price', 'RAM', 'Storage', 'Stock', 'Source'] as const;

function HeaderCell({ label, align }: { label: string; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-9 whitespace-nowrap px-4 text-meta font-medium text-ink-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {label}
    </th>
  );
}

export interface TablePanelProps {
  state: PanelState;
  rows: ProductRow[];
}

export function TablePanel({ state, rows }: TablePanelProps) {
  if (state === 'loading') {
    return <TableSkeleton columns={COLUMNS} rows={8} />;
  }

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't load rows"
        description="The last run finished but its rows couldn't be read back from the database."
        detail="supabase: connection timeout after 5000ms"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (state === 'empty' || rows.length === 0) {
    return (
      <EmptyState
        icon={TableIcon}
        title="No rows yet"
        description="This collector hasn't produced any rows. Run it to populate the table."
        action={{ label: 'Run collector' }}
      />
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          {COLUMNS.map((column, index) => (
            <col key={index} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-hairline">
            {HEADERS.map((header, index) => (
              <HeaderCell
                key={header}
                label={header}
                align={COLUMNS[index]?.align === 'right' ? 'right' : undefined}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.product_page_url} className="border-b border-hairline last:border-b-0">
              <td className="h-9 truncate px-4 text-cell text-ink">{row.product_name}</td>
              <td className="h-9 px-4 text-right text-cell tabular-nums text-ink">
                {row.price ? formatPrice(row.price.value, row.price.currency) : formatOrDash(null)}
              </td>
              <td className="h-9 px-4 text-cell text-ink-secondary">{formatOrDash(row.ram)}</td>
              <td className="h-9 px-4 text-cell text-ink-secondary">{formatOrDash(row.storage)}</td>
              <td className="h-9 px-4 text-cell text-ink-secondary">{formatOrDash(row.stock)}</td>
              <td className="h-9 truncate px-4 text-cell text-ink-muted">{row.product_page_url}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
