import { notFound } from 'next/navigation';

import { CollectorHeader } from '@/components/collector/CollectorHeader';
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

  return (
    <div className="flex flex-col gap-4">
      <CommandBar defaultUrl={collector.targetUrl} />
      <CollectorHeader collector={collector} failedFields={failedFields} />
      <ObservationTabs
        state={panelState}
        rows={panelState === 'empty' ? [] : SAMPLE_ROWS}
        episodes={panelState === 'empty' ? [] : LEDGER_EPISODES}
      />
    </div>
  );
}
