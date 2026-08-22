'use client';

import { useRef } from 'react';

import { useCollectorView } from '@/components/collector/CollectorViews';
import { ExportMenu } from '@/components/collector/ExportMenu';
import { EXPORTS, VIEWS, type ViewId } from '@/components/collector/views';
import { TooltipBubble } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

/**
 * The dashboard's primary view switcher — top of the page, centred, and pinned there.
 *
 * It used to be a row of underlined tabs on the observation card, halfway down the page and below
 * the fold on a laptop. That put the control that decides *what you are looking at* in the middle
 * of the thing it decides about, and it only existed while you were already looking at the panel.
 * Moving it to the top and making it sticky inverts that: the switcher is the one piece of chrome
 * that is always on screen, and everything below it is the answer to it.
 *
 * **Centred with a grid, not with `justify-center`.** The export links sit on the right, and a flex
 * row centring three items would push the buttons off-centre by exactly half the width of the
 * export control — the sort of misalignment nobody names but everybody sees. `1fr auto 1fr` centres
 * the middle cell against the *page*, whatever the cells beside it happen to weigh.
 *
 * **The strip is a segmented control rather than the old underline.** An underline reads as "these
 * are sections of the card below"; a segmented control reads as "pick one", which is what this now
 * is. Both radii are the 6px control radius — the design system allows four radii and this borrows
 * none of them for a fifth.
 *
 * It wraps rather than scrolls on narrow screens. `overflow-x-auto` computes `overflow-y` to `auto`
 * as well, which would clip every button's tooltip at the strip's own edge — and five one-word
 * labels wrap perfectly well.
 */
export function ViewSwitcher({ collectorId }: { collectorId: string }) {
  const { active, showView, barRef } = useCollectorView();
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Arrow-key navigation, as the tablist pattern requires. */
  function handleKeyDown(event: React.KeyboardEvent) {
    const index = VIEWS.findIndex((view) => view.id === active);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % VIEWS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + VIEWS.length) % VIEWS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = VIEWS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextView = VIEWS[nextIndex];
    if (!nextView) return;
    showView(nextView.id);
    buttonRefs.current[nextView.id]?.focus();
  }

  const exportDataset = EXPORTS[active];

  return (
    <div
      ref={barRef}
      data-tour="data-tabs"
      /* Bled out to the column's edges and re-padded, so the solid plane behind it covers the full
         width as the page scrolls under it. A sticky bar that only covers its own content lets the
         page show through the gutters, which looks like a rendering fault rather than a design. */
      className={cn(
        'sticky top-0 z-30 -mx-4 border-b border-hairline bg-plane px-4 py-3 md:-mx-8 md:px-8',
        'flex flex-col items-center gap-3',
        'md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-4',
      )}
    >
      {/* The left cell exists to balance the right one. Deliberately empty: the collector's name is
          on the card below and repeating it here would make the switcher a second header. */}
      <div className="hidden md:block" aria-hidden="true" />

      <div
        role="tablist"
        aria-label="Collector views"
        onKeyDown={handleKeyDown}
        className={cn(
          'flex min-w-0 flex-wrap items-center justify-center gap-1',
          'rounded-control border border-hairline bg-surface p-1',
        )}
      >
        {VIEWS.map((view) => {
          const isActive = view.id === active;
          const Icon = view.icon;
          return (
            <button
              key={view.id}
              ref={(element) => {
                buttonRefs.current[view.id] = element;
              }}
              role="tab"
              id={`tab-${view.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${view.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => showView(view.id as ViewId)}
              aria-describedby={`tip-${view.id}`}
              data-tour={view.id === 'chat' ? 'chat-tab' : undefined}
              className={cn(
                'group relative inline-flex min-h-9 shrink-0 items-center gap-2 rounded-control px-3',
                'text-body transition-colors',
                isActive
                  ? 'bg-accent-plane font-medium text-accent'
                  : 'text-ink-secondary hover:bg-plane hover:text-ink',
              )}
            >
              <Icon size={15} />
              {view.label}
              {/* Inside the button rather than wrapped around it: a tablist may contain tabs and
                  nothing else, so there is nowhere outside to hang a wrapper. */}
              <TooltipBubble id={`tip-${view.id}`} side="bottom" align={view.tipAlign}>
                {view.tip}
              </TooltipBubble>
            </button>
          );
        })}
      </div>

      {/* Outside the tablist. A tablist may contain tabs and nothing else — a link inside it is
          announced as a tab that does not behave like one, and it lands in the middle of arrow-key
          navigation. The cell keeps its width whether or not the active view exports anything, so
          the buttons do not shift sideways when you land on Chat. */}
      <div className="flex min-h-8 items-center justify-center md:justify-end">
        {exportDataset ? <ExportMenu collectorId={collectorId} dataset={exportDataset} /> : null}
      </div>
    </div>
  );
}
