'use client';

import { useState } from 'react';

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
 * making things up.
 *
 * Shell only: Day 5 wires the Groq route handler behind it.
 */

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  sql?: string;
}

const SEEDED_TURNS: Turn[] = [
  { role: 'user', text: 'Which products dropped in price since yesterday?' },
  {
    role: 'assistant',
    text: 'Three products are cheaper than their previous run: Titan Studio 17 (−$120), Apex Flow 15 (−$50) and Nova Ultralight 13 (−$30).',
    sql: "SELECT product_name, price\nFROM runs\nWHERE collector_id = $1\n  AND started_at > now() - interval '1 day'\nORDER BY price ASC\nLIMIT 100;",
  },
];

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 rounded-control border border-hairline bg-plane">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-meta text-ink-secondary transition-colors hover:text-ink"
      >
        <span>Generated SQL</span>
        <span className="text-ink-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <pre className="overflow-x-auto border-t border-hairline px-3 py-2 font-mono text-cell text-ink-secondary">
          {sql}
        </pre>
      ) : null}
    </div>
  );
}

export function ChatPanel({ state }: { state: PanelState }) {
  const [draft, setDraft] = useState('');

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

  const turns = state === 'empty' ? [] : SEEDED_TURNS;

  return (
    <div className="flex h-full min-h-[320px] flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <EmptyState
            icon={ChatIcon}
            title="Ask about this data"
            description="Ask a question in plain English. The generated SQL is always shown beneath the answer."
          />
        ) : (
          <ul className="space-y-4">
            {turns.map((turn, index) => (
              <li
                key={index}
                className={cn('flex flex-col', turn.role === 'user' ? 'items-end' : 'items-start')}
              >
                <div
                  className={cn(
                    'max-w-xl rounded-card px-3 py-2 text-body',
                    turn.role === 'user'
                      ? 'bg-accent-plane text-ink'
                      : 'border border-hairline bg-surface text-ink',
                  )}
                >
                  {turn.text}
                  {turn.sql ? <SqlBlock sql={turn.sql} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex items-center gap-3 border-t border-hairline p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setDraft('');
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Ask a question about this collector's data
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this collector's data…"
          className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()} className="min-h-11">
          Ask
        </Button>
      </form>
    </div>
  );
}
