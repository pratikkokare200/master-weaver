'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { CompassIcon, PlusIcon, WorkspaceIcon } from '@/components/icons';
import { CreditMeter } from '@/components/shell/CreditMeter';
import { cn } from '@/lib/cn';
import { CREDIT_BALANCE } from '@/lib/seed';
import type { CollectorSummary } from '@/lib/seed';
import type { RunState } from '@weaver/contracts';

/**
 * Left navigation — 240px fixed, page-plane background, hairline right border (doc 05 §3).
 *
 * Labels are plain English throughout. The product is called Master Weaver, but nothing in the UI
 * says "thread", "loom" or "mend": a judge must never translate a label to read the screen
 * (doc 05 §9, doc 03 §1.1).
 */

/**
 * Status dot beside each collector. Uses the doc 05 §5.2 status colors, and is decorative — the
 * collector's real state is spelled out on its detail page, so hue never carries meaning alone here.
 */
function collectorDotColor(state: RunState): string {
  switch (state) {
    case 'HEALTHY':
    case 'RESTORED':
      return 'var(--status-good)';
    case 'DEGRADED':
    case 'PENDING_OPERATOR':
    case 'BROKEN':
    case 'DIAGNOSING':
    case 'HEALING':
    case 'AWAITING_APPROVAL':
    case 'CANARY_VALIDATING':
    case 'APPROVING':
    case 'REJECTING':
      return 'var(--status-warning)';
    case 'QUARANTINED':
      return 'var(--status-critical)';
    default:
      return 'var(--ink-muted)';
  }
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-4 text-meta font-medium tracking-wide text-ink-muted">{children}</p>
  );
}

export interface SidebarData {
  collectors: CollectorSummary[];
  workspaces: { id: string; name: string; collectorIds: string[] }[];
}

export function SidebarContent({
  collectors,
  workspaces,
  onNavigate,
  onStartTour,
}: SidebarData & { onNavigate?: () => void; onStartTour?: () => void }) {
  const pathname = usePathname();

  // Every stop on the tour is on a collector page, so the trigger only appears there. A button that
  // starts a tour with nothing to point at is worse than no button — and the landing route redirects
  // to a collector, so this is visible on every screen a visitor actually lands on.
  const canTour = pathname.startsWith('/c/');

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-control bg-accent text-meta font-semibold text-white">
          MW
        </span>
        <span className="text-body font-semibold text-ink">Master Weaver</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Main">
        <SectionLabel>Workspaces</SectionLabel>
        <ul>
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <span className="flex items-center gap-2 rounded-control px-3 py-2 text-body text-ink-secondary">
                <WorkspaceIcon size={15} className="shrink-0 text-ink-muted" />
                <span className="truncate">{workspace.name}</span>
                <span className="ml-auto text-meta text-ink-muted">
                  {workspace.collectorIds.length}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <SectionLabel>Collectors</SectionLabel>
        <ul className="space-y-1">
          {collectors.map((collector) => {
            const href = `/c/${collector.id}`;
            const isActive = pathname === href;
            return (
              <li key={collector.id}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-control px-3 py-2 text-body transition-colors',
                    isActive
                      ? 'bg-accent-plane font-medium text-accent'
                      : 'text-ink-secondary hover:bg-surface hover:text-ink',
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-badge"
                    style={{ backgroundColor: collectorDotColor(collector.runState) }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{collector.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="mt-2 flex w-full items-center gap-2 rounded-control px-3 py-2 text-body text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
        >
          <PlusIcon size={15} className="shrink-0 text-ink-muted" />
          New collector
        </button>
      </nav>

      {canTour && onStartTour ? (
        <div className="border-t border-hairline p-2">
          <button
            type="button"
            onClick={onStartTour}
            className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-body text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
          >
            <CompassIcon size={15} className="shrink-0 text-ink-muted" />
            Take a tour
          </button>
        </div>
      ) : null}

      <CreditMeter {...CREDIT_BALANCE} />
    </div>
  );
}

/** Static desktop rail. Hidden below the tablet breakpoint, where the drawer takes over. */
export function Sidebar({
  collectors,
  workspaces,
  onStartTour,
}: SidebarData & { onStartTour?: () => void }) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-hairline bg-plane md:block">
      <div className="sticky top-0 h-screen">
        <SidebarContent
          collectors={collectors}
          workspaces={workspaces}
          onStartTour={onStartTour}
        />
      </div>
    </aside>
  );
}
