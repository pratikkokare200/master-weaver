'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * The repair confirmation — where a `PENDING_OPERATOR` break gets its answer.
 *
 * This is the surface the Discord deep link opens: `/c/<id>?action=repair` lands on the collector
 * with this panel already expanded, the diagnosis rendered and the apricot badge in view, so the path
 * from alert to decision is one click (doc 03 §6.3).
 *
 * Two things it deliberately does:
 *
 * **It shows the actual proposed fix.** An operator asked to authorise a repair should be able to
 * read the repair. The diagnosis is the same string that will be sent to `scraper heal` — not a
 * summary of it — because the point of asking a human is that the human can disagree.
 *
 * **It names what is still working.** The decision is not "is this scraper broken", it is "is this
 * worth spending a repair on". Fourteen healthy fields and one broken one is a different judgement
 * from the reverse, and the panel should not make someone go and look that up.
 *
 * Dismissing is a real option, not a cancel button: the break is accepted, the collector carries on,
 * and the next scheduled run will prompt again if it is still degraded.
 */

export interface RepairConfirmationProps {
  collectorId: string;
  collectorName: string;
  fhs: number | null;
  failedFields: string[];
  healthyFields: string[];
  /** The exact diagnosis that will be sent. Rendered verbatim, never summarised. */
  proposedFix?: string | null;
  /** Open on load — set by the `?action=repair` deep link. */
  defaultOpen?: boolean;
}

type Status = 'idle' | 'submitting' | 'queued' | 'dismissed' | 'error';

export function RepairConfirmation({
  collectorId,
  collectorName,
  fhs,
  failedFields,
  healthyFields,
  proposedFix,
  defaultOpen = false,
}: RepairConfirmationProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(action: 'repair' | 'dismiss') {
    setStatus('submitting');
    setMessage(null);

    try {
      const response = await fetch(`/api/collectors/${collectorId}/repair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const body: { error?: string; alreadyQueued?: boolean } = await response.json();

      if (!response.ok) {
        setStatus('error');
        setMessage(body.error ?? 'The request did not go through. Try again.');
        return;
      }

      if (action === 'dismiss') {
        setStatus('dismissed');
        setMessage('Dismissed. The next scheduled run will check again.');
        return;
      }

      setStatus('queued');
      setMessage(
        body.alreadyQueued
          ? 'Already queued — a repair is on its way.'
          : 'Repair queued. Watch the badge; this takes about a minute.',
      );
    } catch {
      setStatus('error');
      setMessage('Could not reach the server. Check your connection and try again.');
    }
  }

  const busy = status === 'submitting';
  const settled = status === 'queued' || status === 'dismissed';

  return (
    <section
      aria-label="Repair approval"
      className="rounded-card border border-hairline bg-surface"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-2 w-2 rounded-badge bg-healing" />
          <span className="text-section font-medium text-ink">
            This repair needs your approval
          </span>
        </span>
        <span className="text-meta text-ink-muted">{open ? 'Hide' : 'Review'}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-6 border-t border-hairline px-6 py-6">
          <dl className="grid gap-6 sm:grid-cols-3">
            <div>
              <dt className="text-meta text-ink-muted">Health</dt>
              <dd className="text-stat tabular-nums text-ink">{fhs === null ? '—' : fhs.toFixed(2)}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-meta text-ink-muted">Fields failing</dt>
              <dd className="text-body text-ink">
                {failedFields.length > 0 ? failedFields.join(', ') : '—'}
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-meta text-ink-muted">Still healthy</p>
            <p className="text-body text-ink-secondary">
              {healthyFields.length > 0 ? healthyFields.join(', ') : '—'}
            </p>
          </div>

          {proposedFix ? (
            <div className="flex flex-col gap-2">
              <p className="text-meta text-ink-muted">
                What will be sent to the healer — this exact text
              </p>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-control border border-hairline bg-plane p-3 text-cell text-ink-secondary">
                {proposedFix}
              </pre>
            </div>
          ) : null}

          <p className="text-meta text-ink-muted">
            The proposed fix is scored against this collector&rsquo;s contract before anything is
            committed. Anything below 0.90 is rejected automatically.
          </p>

          {message ? (
            <p
              role="status"
              className={cn(
                'text-body',
                status === 'error' ? 'text-status-critical' : 'text-ink-secondary',
              )}
            >
              {message}
            </p>
          ) : null}

          {!settled ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void submit('repair')} disabled={busy}>
                {busy ? 'Queueing…' : 'Approve repair'}
              </Button>
              <Button variant="secondary" onClick={() => void submit('dismiss')} disabled={busy}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
