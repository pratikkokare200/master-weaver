import { CollectorPolicyBlock } from '@/components/collector/CollectorPolicyBlock';
import { FieldHealthTile } from '@/components/collector/FieldHealthTile';
import { HealthBadge } from '@/components/collector/HealthBadge';
import { ExternalIcon } from '@/components/icons';
import { EM_DASH, formatOrDash, formatRelativeTime } from '@/lib/format';
import type { CollectorSummary } from '@/lib/seed';

/**
 * Collector detail header — the summary strip from the doc 05 §3 layout.
 *
 * Left: identity and the field-health headline number. Right: the repair policy card with the
 * health badge **directly beneath it**, as doc 05 §6 requires — "so the current state is read
 * against the policy that produced it". The adjacency is the point: the policy explains why this
 * particular badge is reporting rather than asking.
 */

export interface CollectorHeaderProps {
  collector: CollectorSummary;
  failedFields?: string[];
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd className="text-cell tabular-nums text-ink-secondary">{value}</dd>
    </div>
  );
}

export function CollectorHeader({ collector, failedFields = [] }: CollectorHeaderProps) {
  return (
    <section
      aria-label="Collector summary"
      className="rounded-card border border-hairline bg-surface"
    >
      <div className="flex flex-col gap-8 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-title font-semibold text-ink">{collector.name}</h1>

          <a
            href={collector.targetUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex max-w-full items-center gap-2 text-body text-ink-secondary transition-colors hover:text-accent"
          >
            <span className="truncate">{collector.targetUrl}</span>
            <ExternalIcon size={13} className="shrink-0" />
          </a>

          <p className="mt-3 max-w-2xl text-body text-ink-secondary">{collector.intent}</p>

          <dl className="mt-8 flex flex-wrap items-start gap-x-8 gap-y-6">
            <FieldHealthTile fhs={collector.fhs} failedFields={failedFields} />
            <Meta label="Rows" value={formatOrDash(collector.rowCount)} />
            <Meta
              label="Last run"
              value={collector.lastRunAt ? formatRelativeTime(collector.lastRunAt) : EM_DASH}
            />
            <Meta label="Collector ID" value={collector.collectorId} />
          </dl>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          <CollectorPolicyBlock goldenSet={collector.goldenSet} />
          <HealthBadge state={collector.runState} collectorId={collector.id} />
        </div>
      </div>
    </section>
  );
}
