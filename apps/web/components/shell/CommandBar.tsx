'use client';

import { useRef, useState } from 'react';

import { RunIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';

/**
 * Command bar — doc 05 §6.
 *
 * Full width, card surface, hairline border. A 2-row auto-growing textarea for the intent, a URL
 * field, and the single lavender Run button.
 *
 * "On submit it collapses into a status strip — the input does not sit there empty while a job
 * runs." An empty form beside a running job reads as though nothing happened; the strip states what
 * was asked for and that it is in flight.
 *
 * No toasts anywhere in this product: the badge is the status surface, and a toast would compete
 * with it (doc 05 §9).
 */

const MAX_TEXTAREA_HEIGHT = 120;

export interface CommandBarProps {
  /** Prefills the URL field on a collector page. */
  defaultUrl?: string;
}

export function CommandBar({ defaultUrl = '' }: CommandBarProps) {
  const [intent, setIntent] = useState('');
  const [url, setUrl] = useState(defaultUrl);
  const [submitted, setSubmitted] = useState<{ intent: string; url: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canRun = intent.trim().length > 0 && url.trim().length > 0;

  function autoGrow(element: HTMLTextAreaElement) {
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canRun) return;
    // Placeholder: Day 2 enqueues a job here and the worker takes over.
    setSubmitted({ intent: intent.trim(), url: url.trim() });
  }

  function handleReset() {
    setSubmitted(null);
    setIntent('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  if (submitted) {
    return (
      <section
        aria-label="Request status"
        className="flex items-center gap-4 rounded-card border border-hairline bg-surface px-6 py-4"
      >
        {/* Lavender, pulsing — the "working" signal. Apricot would misread as a healing event. */}
        <span className="dot-pulse h-2 w-2 shrink-0 rounded-badge bg-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body text-ink">{submitted.intent}</p>
          <p className="truncate text-meta text-ink-muted">{submitted.url}</p>
        </div>
        <Button variant="secondary" onClick={handleReset} className="shrink-0">
          New request
        </Button>
      </section>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Create a collector"
      className="rounded-card border border-hairline bg-surface p-6"
    >
      <label htmlFor="intent" className="sr-only">
        What should this collector extract?
      </label>
      <textarea
        id="intent"
        ref={textareaRef}
        rows={2}
        value={intent}
        onChange={(event) => {
          setIntent(event.target.value);
          autoGrow(event.target);
        }}
        placeholder="Describe what to extract — for example, product name, price and stock from this catalog."
        className="w-full resize-none rounded-control border border-hairline bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted"
      />

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="url" className="sr-only">
          Target URL
        </label>
        <input
          id="url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/products"
          className="min-h-11 flex-1 rounded-control border border-hairline bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted"
        />
        <Button type="submit" variant="primary" disabled={!canRun} className="min-h-11 sm:w-28">
          <RunIcon size={14} />
          Run
        </Button>
      </div>
    </form>
  );
}
