'use client';

import { useState } from 'react';

import { JsonIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/states/EmptyState';
import { ErrorState } from '@/components/states/ErrorState';
import { CodeSkeleton } from '@/components/states/Skeletons';
import type { PanelState } from '@/lib/panelState';
import type { ProductRow } from '@/lib/seed';

/** Raw run output, exactly as the CLI returned it. */
export function JsonPanel({ state, rows }: { state: PanelState; rows: ProductRow[] }) {
  const [copied, setCopied] = useState(false);

  if (state === 'loading') return <CodeSkeleton lines={14} />;

  if (state === 'error') {
    return (
      <ErrorState
        title="Couldn't load raw output"
        description="The run completed but its stored payload couldn't be read."
        detail="supabase: unexpected end of JSON input"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (state === 'empty' || rows.length === 0) {
    return (
      <EmptyState
        icon={JsonIcon}
        title="No output yet"
        description="Raw JSON appears here after the collector's first run."
        action={{ label: 'Run collector' }}
      />
    );
  }

  const json = JSON.stringify(rows, null, 2);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the text is on screen and selectable regardless.
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-meta text-ink-muted">{rows.length} rows · raw run output</p>
        <Button variant="secondary" onClick={handleCopy} className="text-cell">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto rounded-control border border-hairline bg-plane p-4 font-mono text-cell leading-relaxed text-ink-secondary">
        {json}
      </pre>
    </div>
  );
}
