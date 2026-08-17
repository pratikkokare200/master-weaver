'use client';

import { useState } from 'react';

import { LedgerIcon } from '@/components/icons';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { ListSkeleton } from '@/components/states/Skeletons';
import { cn } from '@/lib/cn';
import { formatClock, formatFhs, formatRelativeTime } from '@/lib/format';
import type { PanelState } from '@/lib/panelState';
import type { LedgerAttempt, LedgerEpisode } from '@/lib/seed';

/**
 * HealingLedger — doc 05 §6. Vertical timeline, newest first.
 *
 * Collapsed row: timestamp · trigger reason · `FHS 0.80 → 0.97` · attempt count · cost · outcome.
 * Expanded: the exact diagnosis the machine wrote, plus the canary score that justified each
 * approve/reject decision.
 *
 * **Rejected attempts are never hidden.** They render with a rose left border and a struck-through
 * outcome, because an episode that reads "attempt 1 rejected, attempt 2 approved" is the strongest
 * evidence in the product — a system that rejects its own bad fix is more convincing than one that
 * always succeeds first try (doc 04 Beat 5e).
 */

const OUTCOME_STYLES: Record<LedgerEpisode['finalState'], string> = {
  RESTORED: 'bg-success-plane text-success-ink',
  QUARANTINED: 'bg-status-critical-plane text-status-critical',
  DISMISSED: 'bg-plane text-ink-muted',
};

const OUTCOME_LABELS: Record<LedgerEpisode['finalState'], string> = {
  RESTORED: 'Restored',
  QUARANTINED: 'Needs review',
  DISMISSED: 'Dismissed',
};

function OutcomePill({ state }: { state: LedgerEpisode['finalState'] }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-badge px-2 py-1 text-meta font-medium',
        OUTCOME_STYLES[state],
      )}
    >
      {OUTCOME_LABELS[state]}
    </span>
  );
}

function AttemptRow({ attempt }: { attempt: LedgerAttempt }) {
  const rejected = attempt.decision === 'REJECTED';

  return (
    <li
      className={cn(
        'border-l pl-3',
        rejected ? 'border-status-critical' : 'border-hairline',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-cell font-medium text-ink">Attempt {attempt.attemptNo}</span>
        <span className="text-meta tabular-nums text-ink-secondary">
          canary {formatFhs(attempt.canaryFhs)}
        </span>
        <span
          className={cn(
            'text-meta font-medium',
            rejected ? 'text-status-critical line-through' : 'text-success-ink',
          )}
        >
          {rejected ? 'Rejected' : 'Approved'}
        </span>
      </div>

      <p className="mt-1 rounded-control border border-hairline bg-plane px-3 py-2 font-mono text-meta leading-relaxed text-ink-secondary">
        {attempt.diagnosis}
      </p>

      {attempt.rejectionReason ? (
        <p className="mt-1 text-meta text-ink-muted">{attempt.rejectionReason}</p>
      ) : null}
    </li>
  );
}

function EpisodeRow({ episode }: { episode: LedgerEpisode }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-plane"
      >
        <span className="text-meta tabular-nums text-ink-muted" title={formatRelativeTime(episode.triggeredAt)}>
          {formatClock(episode.triggeredAt)}
        </span>

        <span className="text-cell text-ink">
          {episode.triggerReason === 'BROKEN' ? 'Catastrophic break' : 'Partial break'}
        </span>

        <span className="text-cell tabular-nums text-ink-secondary">
          {formatFhs(episode.fhsBefore)} → {formatFhs(episode.fhsAfter)}
        </span>

        <span className="text-meta text-ink-muted">
          {episode.attempts.length} {episode.attempts.length === 1 ? 'attempt' : 'attempts'}
        </span>

        <span className="text-meta tabular-nums text-ink-muted">
          {episode.creditsSpent} credits · {Math.round(episode.durationMs / 1000)}s
        </span>

        <span className="ml-auto flex items-center gap-2">
          <span className="text-meta text-ink-muted">
            {episode.authorisedBy === 'AUTONOMOUS' ? 'Automatic' : 'Approved by you'}
          </span>
          <OutcomePill state={episode.finalState} />
        </span>
      </button>

      {open ? (
        <ul className="space-y-3 px-4 pb-4">
          {episode.attempts.map((attempt) => (
            <AttemptRow key={attempt.attemptNo} attempt={attempt} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function LedgerPanel({ state, episodes }: { state: PanelState; episodes: LedgerEpisode[] }) {
  if (state === 'loading') return <ListSkeleton rows={4} />;

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't load the repair history"
        description="Past repairs are recorded but the timeline couldn't be read."
        detail="supabase: relation 'healing_episodes' query failed"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (state === 'empty' || episodes.length === 0) {
    return (
      <EmptyState
        icon={LedgerIcon}
        title="No repairs yet"
        description="Every repair this collector makes is recorded here — the diagnosis, the score that justified it, and what it cost."
      />
    );
  }

  return (
    <ul>
      {episodes.map((episode) => (
        <EpisodeRow key={episode.id} episode={episode} />
      ))}
    </ul>
  );
}
