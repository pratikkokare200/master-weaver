import { notFound } from 'next/navigation';

import { CollectorHeader } from '@/components/collector/CollectorHeader';
import { LiveHealth } from '@/components/collector/LiveHealth';
import { ObservationTabs } from '@/components/collector/ObservationTabs';
import { RepairConfirmation } from '@/components/collector/RepairConfirmation';
import { CommandBar } from '@/components/shell/CommandBar';
import { parsePanelState } from '@/lib/panelState';
import {
  getCollector,
  getEpisodes,
  getHealthSeries,
  getLatestRows,
  getLiveStatus,
  getPriceSeries,
  toProductRow,
} from '@/lib/queries.server';
import { readRows } from '@/lib/rows';

/**
 * Collector detail — doc 05 §3's layout, now reading the ledger.
 *
 * Every panel below is fed from Postgres. The components are unchanged from the fixture version,
 * which was the point of matching the view-model types in `queries.server`: a panel that renders
 * identically from seed data and from live rows is one whose empty and error states were designed
 * rather than discovered.
 *
 * `?state=empty|loading|error` still forces a panel state. It is a review affordance rather than
 * product UI (doc 05 §8), so it adds no on-screen control — the four states each need to be
 * inspectable without waiting for the matching real condition, and a state-switcher in the chrome
 * is exactly the kind of addition that stops this reading as finished.
 */

// The ledger changes under the page — a repair lands in under a minute — so a cached render would
// show a state that has already been superseded. The live badge polls on top of this.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CollectorPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  const collector = await getCollector(id);
  if (!collector) notFound();

  // Independent reads, so they overlap rather than queue. The pool caps concurrency at 3, which is
  // exactly this page's fan-out.
  const [latest, episodes, price, health, live] = await Promise.all([
    getLatestRows(id),
    getEpisodes(id),
    getPriceSeries(id),
    getHealthSeries(id),
    getLiveStatus(id),
  ]);

  const panelState = parsePanelState(query['state']);

  // De-duplicate on the READ path. The ledger stores CLI output verbatim, duplication and all
  // (audit finding F1) — every reader is responsible for collapsing it, and this is that boundary.
  const { rows: distinct, duplication } = readRows(latest.rows);
  const productRows = distinct.map(toProductRow);

  const episodeMarks = episodes.map((episode) => ({
    t: episode.triggeredAt,
    restored: episode.finalState === 'RESTORED',
  }));

  // The Discord deep link lands here: /c/<id>?action=repair opens the panel already expanded, so
  // the path from alert to decision is one click (doc 03 §6.3).
  const awaitingOperator = live?.awaitingOperator ?? false;

  return (
    <div className="flex flex-col gap-4">
      <CommandBar defaultUrl={collector.targetUrl} />

      <CollectorHeader collector={collector} failedFields={live?.failedFields ?? []} />

      <LiveHealth collectorId={collector.id} initial={live} />

      {awaitingOperator ? (
        <RepairConfirmation
          collectorId={collector.id}
          collectorName={collector.name}
          fhs={live?.fhs ?? collector.fhs}
          failedFields={live?.failedFields ?? []}
          healthyFields={live?.healthyFields ?? []}
          // The diagnosis the worker actually sent, read back from the most recent attempt — not a
          // reconstruction. An operator asked to authorise a repair should read the repair.
          proposedFix={episodes[0]?.attempts.at(-1)?.diagnosis ?? null}
          defaultOpen={query['action'] === 'repair'}
        />
      ) : null}

      {duplication.has_duplicates ? (
        <p className="px-1 text-meta text-ink-muted">
          Showing {duplication.distinct_count} distinct rows from {duplication.raw_count} returned by
          the collector. The stored run keeps every row exactly as the CLI produced it.
        </p>
      ) : null}

      <ObservationTabs
        collectorId={collector.id}
        state={panelState}
        rows={panelState === 'empty' ? [] : productRows}
        episodes={panelState === 'empty' ? [] : episodes}
        price={panelState === 'empty' ? [] : price}
        health={panelState === 'empty' ? [] : health}
        episodeMarks={episodeMarks}
      />
    </div>
  );
}
