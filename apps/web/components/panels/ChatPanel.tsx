'use client';

import { useRef, useState } from 'react';

import { ChatIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { ListSkeleton } from '@/components/states/Skeletons';
import { cn } from '@/lib/cn';
import type { PanelState } from '@/lib/panelState';

/**
 * SQLChat — doc 05 §6. Messages above, input below.
 *
 * "The generated SQL renders in a collapsed mono block beneath each answer, expandable, with a copy
 * button. **Never hide it.**" Showing the query is what separates this from a chatbot that might be
 * making things up — and it is also what lets someone spot a query that answered a subtly different
 * question from the one they asked.
 *
 * A refused or failed query still shows its SQL. That is the case where seeing it matters most:
 * "the generated query was refused" with the statement underneath is diagnosable, and the same
 * message without it is not.
 */

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  sql?: string | null;
  columns?: string[];
  rows?: Record<string, unknown>[];
  truncated?: boolean;
  failed?: boolean;
}

const SUGGESTIONS = [
  'How many times has this collector broken?',
  'What is the median price of the products it found?',
  'Show every healing attempt and whether it was approved',
] as const;

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-2 rounded-control border border-hairline bg-plane">
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between px-3 py-2 text-meta text-ink-secondary transition-colors hover:text-ink"
        >
          <span>Generated SQL</span>
          <span className="text-ink-muted">{open ? 'Hide' : 'Show'}</span>
        </button>
        <button
          type="button"
          className="px-3 py-2 text-meta text-ink-muted transition-colors hover:text-ink"
          onClick={() => {
            void navigator.clipboard?.writeText(sql).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1_500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open ? (
        <pre className="overflow-x-auto border-t border-hairline px-3 py-2 font-mono text-cell text-ink-secondary">
          {sql}
        </pre>
      ) : null}
    </div>
  );
}

/** The rows behind the answer, so the sentence can be checked against what it was written from. */
function ResultTable({
  columns,
  rows,
  truncated,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
}) {
  if (rows.length === 0 || columns.length === 0) return null;
  const shown = rows.slice(0, 10);

  return (
    <div className="mt-2 overflow-x-auto rounded-control border border-hairline">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hairline bg-plane">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="whitespace-nowrap px-3 py-1.5 text-left text-meta font-medium text-ink-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index} className="border-b border-hairline last:border-b-0">
              {columns.map((column) => {
                const value = row[column];
                return (
                  <td
                    key={column}
                    className="whitespace-nowrap px-3 py-1.5 text-cell tabular-nums text-ink"
                  >
                    {/* An em dash for null, never a blank cell — the same rule the data table
                        follows, for the same reason: blank reads as a rendering bug. */}
                    {value === null || value === undefined
                      ? '—'
                      : typeof value === 'object'
                        ? JSON.stringify(value)
                        : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length || truncated ? (
        <p className="border-t border-hairline px-3 py-1.5 text-meta text-ink-muted">
          Showing {shown.length} of {rows.length}
          {truncated ? '+' : ''} rows.
        </p>
      ) : null}
    </div>
  );
}

export function ChatPanel({ state, collectorId }: { state: PanelState; collectorId?: string }) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string) {
    const asked = question.trim();
    if (asked === '' || pending || !collectorId) return;

    setTurns((previous) => [...previous, { role: 'user', text: asked }]);
    setDraft('');
    setPending(true);

    try {
      const response = await fetch(`/api/collectors/${collectorId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: asked }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        error?: string;
        sql?: string | null;
        columns?: string[];
        rows?: Record<string, unknown>[];
        truncated?: boolean;
      };

      setTurns((previous) => [
        ...previous,
        response.ok
          ? {
              role: 'assistant',
              text: payload.answer ?? '',
              sql: payload.sql ?? null,
              columns: payload.columns ?? [],
              rows: payload.rows ?? [],
              truncated: payload.truncated ?? false,
            }
          : {
              role: 'assistant',
              text: payload.error ?? 'The question could not be answered.',
              // The refused or failed query, when there was one. This is the case where seeing it
              // matters most.
              sql: payload.sql ?? null,
              failed: true,
            },
      ]);
    } catch {
      setTurns((previous) => [
        ...previous,
        {
          role: 'assistant',
          text: 'The query service could not be reached. Nothing was run against the database.',
          failed: true,
        },
      ]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  if (state === 'loading') return <ListSkeleton rows={3} />;

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't reach the query service"
        description="Your question wasn't answered. Nothing was run against the database."
        detail="groq: 503 service unavailable"
        onRetry={() => window.location.reload()}
      />
    );
  }

  const visible = state === 'empty' ? [] : turns;

  return (
    <div className="flex h-full min-h-[320px] flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4">
            <EmptyState
              icon={ChatIcon}
              title="Ask about this data"
              description="Ask a question in plain English. The generated SQL is always shown beneath the answer."
            />
            {/* Three real questions this ledger can answer. An empty prompt box is a request to
                guess what the system knows about; these say it. */}
            <ul className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => void ask(suggestion)}
                    disabled={pending || !collectorId}
                    className="rounded-badge border border-hairline px-3 py-1.5 text-meta text-ink-secondary transition-colors hover:bg-plane hover:text-ink disabled:opacity-50"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-4">
            {visible.map((turn, index) => (
              <li
                key={index}
                className={cn('flex flex-col', turn.role === 'user' ? 'items-end' : 'items-start')}
              >
                <div
                  className={cn(
                    'max-w-2xl rounded-card px-3 py-2 text-body',
                    turn.role === 'user'
                      ? 'bg-accent-plane text-ink'
                      : turn.failed
                        ? 'border border-hairline bg-surface text-status-critical'
                        : 'border border-hairline bg-surface text-ink',
                  )}
                >
                  {turn.text}
                  {turn.sql ? <SqlBlock sql={turn.sql} /> : null}
                  {turn.columns && turn.rows ? (
                    <ResultTable
                      columns={turn.columns}
                      rows={turn.rows}
                      truncated={turn.truncated ?? false}
                    />
                  ) : null}
                </div>
              </li>
            ))}
            {pending ? (
              <li className="flex items-start">
                <div className="rounded-card border border-hairline bg-surface px-3 py-2 text-body text-ink-muted">
                  Writing the query…
                </div>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <form
        className="flex items-center gap-3 border-t border-hairline p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask a question about this collector&apos;s data
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this collector's data…"
          className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!draft.trim() || pending || !collectorId}
          className="min-h-11"
        >
          {pending ? 'Asking…' : 'Ask'}
        </Button>
      </form>
    </div>
  );
}
