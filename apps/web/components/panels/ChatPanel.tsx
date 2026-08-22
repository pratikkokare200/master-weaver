'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChatIcon, SendIcon, SparkIcon, TrashIcon } from '@/components/icons';
import { ErrorState } from '@/components/states/ErrorState';
import { ListSkeleton } from '@/components/states/Skeletons';
import { cn } from '@/lib/cn';
import type { PanelState } from '@/lib/panelState';

/**
 * SQLChat — doc 05 §6, rebuilt as a conversation rather than a form with a transcript above it.
 *
 * The shape is the one every reader already knows from a modern assistant: a scroll region that
 * holds the history, an input welded to the bottom of the view, and nothing else competing for the
 * space. Three things follow from that and are worth stating, because each replaced something
 * simpler that did not work:
 *
 * **The panel owns a fixed height, and only the history scrolls.** Previously the whole panel grew
 * with the conversation and the composer sat at the bottom of a page that got longer with every
 * answer — so the input a reader was about to type into walked further away the more they used it.
 * A fixed 560px column with `flex-1 overflow-y-auto` on the history is what pins it.
 *
 * **The history sticks to the bottom as it grows.** Answers arrive after a wait, and an answer that
 * lands below the fold reads as nothing having happened. `useLayoutEffect` rather than `useEffect`,
 * so the jump happens in the same frame the message paints instead of one frame after it.
 *
 * **The two roles are shaped differently, not just aligned differently.** A question is short and
 * gets a bubble; an answer carries a SQL block and often a result table, and wrapping that in a
 * bubble makes a nested box of boxes. So the answer sits open on the surface behind a small mark,
 * which is also what leaves the SQL block room to be readable.
 *
 * The one rule inherited unchanged from §6: "The generated SQL renders in a collapsed mono block
 * beneath each answer, expandable, with a copy button. **Never hide it.**" Showing the query is
 * what separates this from a chatbot that might be making things up, and it is what lets someone
 * spot a query that answered a subtly different question from the one they asked. A refused or
 * failed query still shows its SQL — that is the case where seeing it matters most.
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

/** Matches the `intent_prompt` column's own limit, so the box cannot accept what the API will not. */
const MAX_QUESTION = 500;
/** Past this the composer scrolls instead of growing — four or five lines of question is plenty. */
const MAX_COMPOSER_HEIGHT = 132;

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-3 rounded-control border border-hairline bg-plane">
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
    <div className="mt-3 overflow-x-auto rounded-control border border-hairline">
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

/** The mark beside an answer. Accent wash, accent ink — the quiet register, never the solid fill. */
function AssistantMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent-plane text-accent"
    >
      <SparkIcon size={15} />
    </span>
  );
}

function TurnRow({ turn }: { turn: Turn }) {
  if (turn.role === 'user') {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] rounded-card bg-accent-plane px-4 py-2.5 text-body text-ink">
          {turn.text}
        </div>
      </li>
    );
  }

  return (
    <li className="flex gap-3">
      <AssistantMark />
      <div className="min-w-0 flex-1">
        <p className={cn('text-body', turn.failed ? 'text-status-critical' : 'text-ink')}>
          {turn.text}
        </p>
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
  );
}

export function ChatPanel({ state, collectorId }: { state: PanelState; collectorId?: string }) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const disabled = pending || !collectorId;

  // Pin the history to the bottom whenever it grows. `scrollTop`, not `scrollIntoView` — the latter
  // scrolls the nearest scrollable ancestor too, which here is the page, so asking a question would
  // yank the whole dashboard about.
  useLayoutEffect(() => {
    const element = historyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns, pending]);

  function resize(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }

  // The composer shrinks back after a send, and grows to fit a suggestion dropped into it.
  useEffect(() => {
    if (inputRef.current) resize(inputRef.current);
  }, [draft]);

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
  const started = visible.length > 0;

  return (
    <div className="flex h-[560px] flex-col">
      {/* A thin header, present only once there is something to reset. On an empty conversation it
          would be a bar of chrome above an invitation, which is the opposite of inviting. */}
      {started ? (
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-6 py-3">
          <p className="text-meta text-ink-muted">
            Answers are written from rows this collector actually returned.
          </p>
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              setDraft('');
              inputRef.current?.focus();
            }}
            disabled={pending}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-control px-2 text-meta text-ink-secondary transition-colors hover:bg-plane hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon size={14} />
            New conversation
          </button>
        </div>
      ) : null}

      {/* The history. `flex-1` plus `overflow-y-auto` is the whole trick: this is the only part of
          the panel that ever scrolls, and it is measured against a parent of known height. */}
      <div ref={historyRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {started ? (
            <ul className="flex flex-col gap-6">
              {visible.map((turn, index) => (
                <TurnRow key={index} turn={turn} />
              ))}
              {pending ? (
                <li className="flex items-center gap-3" aria-live="polite">
                  <AssistantMark />
                  <span className="flex items-center gap-2 text-body text-ink-muted">
                    Writing the query
                    <span className="flex items-center gap-1" aria-hidden="true">
                      <span className="typing-dot h-1.5 w-1.5 rounded-badge bg-ink-muted" />
                      <span className="typing-dot h-1.5 w-1.5 rounded-badge bg-ink-muted" />
                      <span className="typing-dot h-1.5 w-1.5 rounded-badge bg-ink-muted" />
                    </span>
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            /* The opening screen. Centred in the scroll region rather than pinned to the top, so
               the panel does not read as a conversation that has already been cleared. */
            <div className="flex flex-col items-center gap-6 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-card border border-hairline bg-plane text-ink-muted">
                <ChatIcon size={20} />
              </span>
              <div>
                <p className="text-section font-semibold text-ink">Ask about this data</p>
                <p className="mx-auto mt-2 max-w-sm text-body text-ink-secondary">
                  Your question becomes SQL, runs against this collector read-only, and the query is
                  shown beneath every answer.
                </p>
              </div>
              {/* Three real questions this ledger can answer. An empty prompt box is a request to
                  guess what the system knows about; these say it. */}
              <ul className="flex w-full max-w-lg flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => void ask(suggestion)}
                      disabled={disabled}
                      className={cn(
                        'w-full rounded-control border border-hairline bg-surface px-4 py-2.5',
                        'text-left text-body text-ink-secondary transition-colors',
                        'hover:border-accent-plane-border hover:bg-accent-plane hover:text-accent',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* The composer. `shrink-0` inside the fixed-height column is what anchors it: it keeps its
          own height no matter how long the conversation above it gets. */}
      <div className="shrink-0 border-t border-hairline bg-surface px-6 py-4">
        <form
          className="mx-auto w-full max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Ask a question about this collector&apos;s data
          </label>
          {/* The border lives on the wrapper, not the textarea, so the send button sits *inside*
              the field the way a modern composer does. `focus-within` moves the ring out to the
              wrapper with it — without that, focus would ring a control the reader cannot see. */}
          <div
            className={cn(
              'flex items-end gap-2 rounded-card border border-hairline bg-plane p-2',
              'transition-colors focus-within:border-accent',
            )}
          >
            <textarea
              id="chat-input"
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={MAX_QUESTION}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter breaks the line — the convention this input is borrowing
                // its whole shape from. `isComposing` guards an IME: mid-composition Enter commits
                // a candidate character and must not also send the message.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void ask(draft);
                }
              }}
              placeholder="Ask about this collector's data…"
              className={cn(
                'min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5',
                'text-body text-ink placeholder:text-ink-muted',
                'focus-visible:outline-none disabled:cursor-not-allowed',
              )}
            />
            <button
              type="submit"
              aria-label="Send question"
              disabled={!draft.trim() || disabled}
              className={cn(
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control',
                'border border-accent-border bg-accent-fill text-accent-ink transition-colors',
                'hover:bg-accent-fill-hover',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <SendIcon size={16} />
            </button>
          </div>
          <p className="mt-2 flex items-center justify-between text-meta text-ink-muted">
            <span>Enter to send · Shift + Enter for a new line</span>
            {/* Only near the ceiling. A counter that is always on screen is a warning that never
                stops warning, and this limit is not one an ordinary question comes close to. */}
            <span className={cn(draft.length > MAX_QUESTION - 100 ? 'visible' : 'invisible')}>
              {draft.length} / {MAX_QUESTION}
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}
