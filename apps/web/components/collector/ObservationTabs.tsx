'use client';

import { useRef, useState } from 'react';

import { ChartIcon, ChatIcon, JsonIcon, LedgerIcon, TableIcon } from '@/components/icons';
import type { IconProps } from '@/components/icons';
import { ChartPanel } from '@/components/panels/ChartPanel';
import { ChatPanel } from '@/components/panels/ChatPanel';
import { JsonPanel } from '@/components/panels/JsonPanel';
import { LedgerPanel } from '@/components/panels/LedgerPanel';
import { TablePanel } from '@/components/panels/TablePanel';
import { cn } from '@/lib/cn';
import type { PanelState } from '@/lib/panelState';
import type { LedgerEpisode, ProductRow } from '@/lib/seed';

/**
 * The observation panel — doc 05 §3.
 *
 * Tabs, not resizable panels: panels cost half a day, are fiddly to record, and add nothing to
 * "finished and readable".
 *
 * The panel body carries a fixed minimum height so switching tabs — or a panel moving between
 * loading, empty and populated — never resizes the page. Layout shift is the single most visible
 * polish failure, and it is what the "finished" criterion actually measures (doc 05 §8).
 */

const TABS = [
  { id: 'table', label: 'Table', icon: TableIcon },
  { id: 'chart', label: 'Chart', icon: ChartIcon },
  { id: 'json', label: 'JSON', icon: JsonIcon },
  { id: 'chat', label: 'Chat', icon: ChatIcon },
  { id: 'ledger', label: 'Ledger', icon: LedgerIcon },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: (props: IconProps) => React.ReactElement }>;

type TabId = (typeof TABS)[number]['id'];

export interface ObservationTabsProps {
  state: PanelState;
  rows: ProductRow[];
  episodes: LedgerEpisode[];
}

export function ObservationTabs({ state, rows, episodes }: ObservationTabsProps) {
  const [active, setActive] = useState<TabId>('table');
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Arrow-key navigation, as the tablist pattern requires. */
  function handleKeyDown(event: React.KeyboardEvent) {
    const index = TABS.findIndex((tab) => tab.id === active);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    if (!nextTab) return;
    setActive(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  }

  return (
    <section className="rounded-card border border-hairline bg-surface">
      <div
        role="tablist"
        aria-label="Collector views"
        onKeyDown={handleKeyDown}
        className="flex items-center gap-1 overflow-x-auto border-b border-hairline px-2"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-2 border-b px-3 text-body transition-colors',
                // The active marker is a 1px border, never 2px — borders are hairlines here too.
                isActive
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-ink-secondary hover:text-ink',
              )}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-[420px]">
        {TABS.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            hidden={tab.id !== active}
          >
            {tab.id === active ? (
              <>
                {tab.id === 'table' && <TablePanel state={state} rows={rows} />}
                {tab.id === 'chart' && <ChartPanel state={state} />}
                {tab.id === 'json' && <JsonPanel state={state} rows={rows} />}
                {tab.id === 'chat' && <ChatPanel state={state} />}
                {tab.id === 'ledger' && <LedgerPanel state={state} episodes={episodes} />}
              </>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
