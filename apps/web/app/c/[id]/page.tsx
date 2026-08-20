import { notFound } from 'next/navigation';

import { CollectorHeader } from '@/components/collector/CollectorHeader';
import { RepairConfirmation } from '@/components/collector/RepairConfirmation';
import { ObservationTabs } from '@/components/collector/ObservationTabs';
import { CommandBar } from '@/components/shell/CommandBar';
import { parsePanelState } from '@/lib/panelState';
import { LEDGER_EPISODES, SAMPLE_ROWS, getCollector } from '@/lib/seed';

/**
 * Collector detail — the layout from doc 05 §3:
 *
 *   command bar → collector header (policy + badge) → tabbed observation panel.
 *
 * `?state=empty|loading|error` renders the panels in that state. It is a review affordance rather
 * than product UI, so it adds no on-screen control: the four states each need to be inspectable
 * without waiting for the matching real condition (doc 05 §8), but a state-switcher widget in the
 * chrome would be exactly the kind of addition that stops this reading as finished.
 */

/**
 * A representative diagnosis, for the confirmation panel until the run's own is read back.
 *
 * Shaped exactly like the real thing — `@weaver/healing`'s `buildDiagnosis` produced this text from
 * the demo break — so the panel's layout is being designed against the string it will actually have
 * to render, not a placeholder that happens to be shorter.
 */
const SAMPLE_DIAGNOSIS = `The scraper stopped extracting 1 field(s) after a site layout change.

BROKEN: price: was 100% filled, now 30%. Previously returned 1299, now returns nothing.

STILL WORKING: product_name, ram, storage, in_stock

Please update the extraction logic for the broken field(s) only. Do not change the fields that still work.`;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CollectorPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;

  const collector = getCollector(id);
  if (!collector) notFound();

  const panelState = parsePanelState(query['state']);

  // Failing fields come from the run's field scores once the scorer is wired; the degraded seed
  // carries the one the demo break produces.
  const failedFields = collector.runState === 'PENDING_OPERATOR' ? ['price'] : [];

  // The Discord deep link lands here: /c/<id>?action=repair opens the panel already expanded, so
  // the path from alert to decision is one click (doc 03 6.3).
  const awaitingOperator = collector.runState === 'PENDING_OPERATOR';
  const openRepair = query['action'] === 'repair';

  return (
    <div className="flex flex-col gap-4">
      <CommandBar defaultUrl={collector.targetUrl} />
      <CollectorHeader collector={collector} failedFields={failedFields} />
      {awaitingOperator ? (
        <RepairConfirmation
          collectorId={collector.id}
          collectorName={collector.name}
          fhs={collector.fhs}
          failedFields={failedFields}
          healthyFields={['product_name', 'ram', 'storage', 'in_stock']}
          proposedFix={SAMPLE_DIAGNOSIS}
          defaultOpen={openRepair}
        />
      ) : null}
      <ObservationTabs
        state={panelState}
        rows={panelState === 'empty' ? [] : SAMPLE_ROWS}
        episodes={panelState === 'empty' ? [] : LEDGER_EPISODES}
      />
    </div>
  );
}
