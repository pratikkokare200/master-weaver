import Link from 'next/link';

import { CommandBar } from '@/components/shell/CommandBar';
import { detectFields } from '@/lib/intentFields';

/**
 * The collector setup form.
 *
 * Where "New collector" lands. The dialog in the rail captures the three inputs and validates them;
 * this page is where they can be read back, edited and run — and it is a real route rather than a
 * second modal, so it can be linked, reloaded and reached directly with an empty form.
 *
 * The split is deliberate. A dialog is the right shape for "tell me three things" and the wrong
 * shape for "here is what you are about to do": the first wants to be dismissible and small, the
 * second wants the room to show the contract and the same Run button every other create surface in
 * the product uses. Putting the review in the dialog would have meant a scrolling modal with a
 * primary action below its own fold.
 *
 * **What the Run button does today is enqueue nothing.** `CommandBar` collapses into its status
 * strip and the worker is not yet wired to a create job — migration 0002's four job kinds all
 * address a collector that already exists. That is stated on the page rather than implied by it,
 * because a setup form that silently does nothing is the single worst thing to hand a reader who
 * has just filled it in.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Query values are untrusted input; take the first string or nothing. */
function one(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' ? candidate : '';
}

export default async function NewCollectorPage({ searchParams }: PageProps) {
  const query = await searchParams;

  const name = one(query['name']).slice(0, 80);
  const url = one(query['url']).slice(0, 2_000);
  const intent = one(query['intent']).slice(0, 500);
  const fields = detectFields(intent);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/"
          className="text-meta text-ink-muted transition-colors hover:text-accent"
        >
          ← Back to collectors
        </Link>
        <h1 className="mt-2 text-title font-semibold text-ink">
          {name === '' ? 'New collector' : name}
        </h1>
        <p className="mt-1 text-body text-ink-secondary">
          {name === ''
            ? 'Describe what to extract and where to find it. The description becomes the contract every run is scored against.'
            : 'Check the description and the address, then run it. Both are still editable.'}
        </p>
      </div>

      {fields.length > 0 ? (
        <section
          aria-label="Detected fields"
          className="rounded-card border border-hairline bg-surface p-6"
        >
          <h2 className="text-section font-semibold text-ink">
            The contract, as it reads right now
          </h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {fields.map((field) => (
              <li
                key={field}
                className="rounded-badge border border-accent-plane-border bg-accent-plane px-2.5 py-1 text-meta text-accent"
              >
                {field}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-meta text-ink-muted">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'} read from your description.
            The real list is inferred when the collector is created and confirmed against the page
            on its first run — every later run is scored against that, and a field that stops coming
            back is what triggers a repair.
          </p>
        </section>
      ) : null}

      <CommandBar defaultUrl={url} defaultIntent={intent} />

      <p className="text-meta text-ink-muted">
        Running this queues the first collection. Provisioning the collector itself still happens on
        the worker, so nothing is charged to your credits from this screen.
      </p>
    </div>
  );
}
