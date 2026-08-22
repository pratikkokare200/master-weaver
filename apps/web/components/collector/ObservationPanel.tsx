'use client';

import { useCollectorView } from '@/components/collector/CollectorViews';
import { VIEWS } from '@/components/collector/views';
import { ChartPanel } from '@/components/panels/ChartPanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { JsonPanel } from '@/components/panels/JsonPanel';
import { LedgerPanel } from '@/components/panels/LedgerPanel';
import { TablePanel } from '@/components/panels/TablePanel';
import type { HealthPoint, PricePoint } from '@/lib/queries.server';
import type { PanelState } from '@/lib/panelState';
import type { LedgerEpisode, ProductRow } from '@/lib/seed';

/**
 * The observation panel — doc 05 §3, now with its tabs lifted to the top of the page.
 *
 * What is left is the body: a card that renders whichever view `ViewSwitcher` has selected. It
 * carries no header of its own. The switcher already says what you are looking at, and a card that
 * repeats it would be a caption for a control three hundred pixels above it.
 *
 * The card holds a fixed minimum height so switching views — or a panel moving between loading,
 * empty and populated — never resizes the page. That floor went from 420px to 560px with the chat
 * rewrite: `ChatPanel` is now a fixed-height conversation with its own scroll region, and a panel
 * that is taller than its neighbours reintroduces exactly the layout shift the floor exists to
 * prevent. Every other view simply has more room than it needs, which costs nothing.
 *
 * Layout shift is the single most visible polish failure, and it is what the "finished" criterion
 * actually measures (doc 05 §8).
 */

export interface ObservationPanelProps {
  /** Needed only to address the ask endpoint; the other panels read nothing. */
  collectorId: string;
  state: PanelState;
  rows: ProductRow[];
  episodes: LedgerEpisode[];
  /** Chart series, read from the ledger. Empty renders the panel's own "not enough history" state. */
  price?: PricePoint[];
  health?: HealthPoint[];
  episodeMarks?: { t: string; restored: boolean }[];
}

export function ObservationPanel({
  collectorId,
  state,
  rows,
  episodes,
  price = [],
  health = [],
  episodeMarks = [],
}: ObservationPanelProps) {
  const { active, panelRef } = useCollectorView();

  return (
    <section ref={panelRef} className="min-h-[560px] rounded-card border border-hairline bg-surface">
      {VIEWS.map((view) => (
        <div
          key={view.id}
          role="tabpanel"
          id={`panel-${view.id}`}
          /* The tab this panel belongs to lives in the sticky bar at the top of the page, which is
             a different subtree entirely. `aria-labelledby` is resolved by id against the whole
             document, so the association survives the split — it is the reason the two components
             read their ids from the same `VIEWS` list rather than each spelling them out. */
          aria-labelledby={`tab-${view.id}`}
          hidden={view.id !== active}
        >
          {view.id === active ? (
            <>
              {view.id === 'table' && <TablePanel state={state} rows={rows} />}
              {view.id === 'chart' && (
                <ChartPanel state={state} price={price} health={health} episodeMarks={episodeMarks} />
              )}
              {view.id === 'json' && <JsonPanel state={state} rows={rows} />}
              {view.id === 'chat' && <ChatPanel state={state} collectorId={collectorId} />}
              {view.id === 'ledger' && <LedgerPanel state={state} episodes={episodes} />}
            </>
          ) : null}
        </div>
      ))}
    </section>
  );
}
