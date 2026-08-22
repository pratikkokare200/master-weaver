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

/**
 * The tour launcher.
 *
 * It sits at the top of the nav, above the workspace list, because the previous placement — last
 * in the rail, under the collectors, in the same muted grey as every inert label around it —
 * was findable only by someone already looking for it. Nothing else in this sidebar carries a
 * fill or a border, so a washed chip with a real edge is unambiguous without being loud.
 *
 * It is deliberately *not* the solid `primary` treatment. Doc 05 §1 allows one primary on screen
 * and the Run button in the command bar is it; two teal blocks competing would make "what do
 * I do here" ambiguous, which is the exact failure the one-accent rule prevents. The chip is the
 * accent's quiet register: accent ink on an accent wash, at 9.0:1.
 *
 * `pulse` is owned by `AppShell` so the rail and the mobile drawer never disagree, and it is
 * session state rather than persisted — every fresh load of the demo gets the cue, and a stale
 * localStorage flag can never be the reason it fails to appear on stage.
 */
function TourChip({ onStartTour, pulse }: { onStartTour: () => void; pulse: boolean }) {
  return (
    <div className="px-1 pb-1 pt-2">
      <button
        type="button"
        onClick={onStartTour}
        className={cn(
          'flex w-full items-center gap-2 rounded-control border px-3 py-2',
          'text-body font-medium text-accent transition-colors',
          'border-accent-plane-border bg-accent-plane hover:bg-accent-plane-strong',
          pulse && 'tour-pulse',
        )}
      >
        <CompassIcon size={15} className="shrink-0 text-accent" />
        Take a tour
        {/* The §4 dot: pulsing opacity belongs to a dot and never to the label beside it. It
            carries no meaning the text does not, so it is hidden from assistive tech. Its
            animation is driven by `.tour-pulse` on the parent, so the two stop together. */}
        <span className="tour-dot ml-auto h-2 w-2 shrink-0 rounded-badge bg-accent" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SidebarContent({
  collectors,
  workspaces,
  onNavigate,
  onStartTour,
  onNewCollector,
  pulseTour = false,
}: SidebarData & {
  onNavigate?: () => void;
  onStartTour?: () => void;
  onNewCollector?: () => void;
  pulseTour?: boolean;
}) {
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
        {canTour && onStartTour ? (
          <TourChip onStartTour={onStartTour} pulse={pulseTour} />
        ) : null}

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

        {/* Opens the create dialog rather than navigating. The three things a collector needs are
            a short form, and a reader who decides against it halfway through should get their page
            back rather than have to find their way home from a route they did not want. */}
        <button
          type="button"
          onClick={onNewCollector}
          className="group mt-2 flex w-full items-center gap-2 rounded-control px-3 py-2 text-body text-ink-secondary transition-colors hover:bg-surface hover:text-ink"
        >
          <PlusIcon size={15} className="shrink-0 text-ink-muted transition-colors group-hover:text-accent" />
          New collector
        </button>
      </nav>

      <CreditMeter {...CREDIT_BALANCE} />
    </div>
  );
}

/** Static desktop rail. Hidden below the tablet breakpoint, where the drawer takes over. */
export function Sidebar({
  collectors,
  workspaces,
  onStartTour,
  onNewCollector,
  pulseTour = false,
}: SidebarData & {
  onStartTour?: () => void;
  onNewCollector?: () => void;
  pulseTour?: boolean;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-hairline bg-plane md:block">
      <div className="sticky top-0 h-screen">
        <SidebarContent
          collectors={collectors}
          workspaces={workspaces}
          onStartTour={onStartTour}
          onNewCollector={onNewCollector}
          pulseTour={pulseTour}
        />
      </div>
    </aside>
  );
}
