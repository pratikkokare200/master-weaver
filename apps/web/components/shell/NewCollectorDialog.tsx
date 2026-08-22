'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { detectFields } from '@/lib/intentFields';

/**
 * Create a collector.
 *
 * What this does and does not do, plainly, because the honest version is short:
 *
 * It captures and validates the three things a collector is made of — a name, a target URL, and the
 * plain-English description that becomes its contract — and hands them to `/new`, the setup page
 * where the Run button lives. It does **not** write a row or provision anything on Bright Data.
 * Standing a real collector up means a `scraper create` call from the worker, and there is no job
 * kind for that yet (migration 0002 declares four, all of which address a collector that already
 * exists). Inventing a row here would put a collector in the rail that can never run, which is a
 * worse kind of broken than a button that does not do anything: it looks finished.
 *
 * So the boundary is drawn where the product's boundary actually is. Everything up to the handoff
 * is real — the validation is the real constraint (`intent_prompt` is capped at 500 characters by
 * the `collectors` table itself), the URL check is the one the worker would apply, and the field
 * list is the reader's first look at the contract they are writing.
 *
 * Two fields carry live feedback rather than a validation message on submit. Errors appear on blur
 * and on the first submit attempt, never on the first keystroke — telling someone their URL is
 * invalid while they are three characters into typing it is technically true and entirely useless.
 */

interface Field {
  value: string;
  touched: boolean;
}

const EMPTY: Field = { value: '', touched: false };

/** Matches the `intent_prompt` check constraint in migration 0001. */
const MAX_INTENT = 500;
const MAX_NAME = 80;

function urlProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'A target URL is required.';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'That is not a URL. It needs to start with https://.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Only http and https addresses can be collected from.';
  }
  return null;
}

function nameProblem(value: string): string | null {
  if (value.trim() === '') return 'Give the collector a name you will recognise in the rail.';
  return null;
}

function intentProblem(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return 'Describe what to extract — this becomes the contract.';
  if (trimmed.length < 8) return 'A few more words: name the fields you want back.';
  return null;
}

export function NewCollectorDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  const [name, setName] = useState<Field>(EMPTY);
  const [url, setUrl] = useState<Field>(EMPTY);
  const [intent, setIntent] = useState<Field>(EMPTY);
  const [attempted, setAttempted] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  const problems = {
    name: nameProblem(name.value),
    url: urlProblem(url.value),
    intent: intentProblem(intent.value),
  };
  const valid = !problems.name && !problems.url && !problems.intent;

  const fields = useMemo(() => detectFields(intent.value), [intent.value]);

  function show(key: keyof typeof problems, field: Field): string | null {
    return (field.touched || attempted) && problems[key] ? problems[key] : null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!valid || handingOff) return;

    // `handingOff` rather than a spinner that resolves: the navigation is the completion, and the
    // button should be unpressable for the frame between the two.
    setHandingOff(true);

    const query = new URLSearchParams({
      name: name.value.trim(),
      url: url.value.trim(),
      intent: intent.value.trim(),
    });
    router.push(`/new?${query.toString()}`);
    onClose();
  }

  const inputClass =
    'min-h-11 w-full rounded-control border bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted';

  return (
    <Modal
      title="Create a collector"
      description="Three things: what to call it, where to look, and what to bring back."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-collector"
            variant="primary"
            className="min-h-11"
            disabled={handingOff}
          >
            {handingOff ? 'Opening setup…' : 'Continue'}
          </Button>
        </>
      }
    >
      {/* The form is here and its submit button is in the modal's footer, joined by `form=`. The
          alternative is a footer inside the form, which would put the dialog's own chrome inside
          the thing it wraps. */}
      <form id="new-collector" onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="collector-name" className="block text-body font-medium text-ink">
            Name
          </label>
          <input
            id="collector-name"
            value={name.value}
            maxLength={MAX_NAME}
            aria-invalid={show('name', name) ? true : undefined}
            aria-describedby={show('name', name) ? 'collector-name-problem' : undefined}
            onChange={(event) => setName({ value: event.target.value, touched: name.touched })}
            onBlur={() => setName((field) => ({ ...field, touched: true }))}
            placeholder="Laptop catalog"
            className={cn(
              'mt-1.5',
              inputClass,
              show('name', name) ? 'border-status-critical' : 'border-hairline',
            )}
          />
          {show('name', name) ? (
            <p id="collector-name-problem" className="mt-1.5 text-meta text-status-critical">
              {problems.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="collector-url" className="block text-body font-medium text-ink">
            Target URL
          </label>
          <input
            id="collector-url"
            type="url"
            inputMode="url"
            value={url.value}
            aria-invalid={show('url', url) ? true : undefined}
            aria-describedby={show('url', url) ? 'collector-url-problem' : undefined}
            onChange={(event) => setUrl({ value: event.target.value, touched: url.touched })}
            onBlur={() => setUrl((field) => ({ ...field, touched: true }))}
            placeholder="https://example.com/products"
            className={cn(
              'mt-1.5',
              inputClass,
              show('url', url) ? 'border-status-critical' : 'border-hairline',
            )}
          />
          {show('url', url) ? (
            <p id="collector-url-problem" className="mt-1.5 text-meta text-status-critical">
              {problems.url}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="collector-intent" className="block text-body font-medium text-ink">
            What should it extract?
          </label>
          <textarea
            id="collector-intent"
            rows={3}
            value={intent.value}
            maxLength={MAX_INTENT}
            aria-invalid={show('intent', intent) ? true : undefined}
            aria-describedby={
              show('intent', intent) ? 'collector-intent-problem' : 'collector-intent-hint'
            }
            onChange={(event) => setIntent({ value: event.target.value, touched: intent.touched })}
            onBlur={() => setIntent((field) => ({ ...field, touched: true }))}
            placeholder="Product name, price, RAM, storage and stock from each listing."
            className={cn(
              'mt-1.5 w-full resize-none rounded-control border bg-surface px-3 py-2 text-body text-ink placeholder:text-ink-muted',
              show('intent', intent) ? 'border-status-critical' : 'border-hairline',
            )}
          />
          {show('intent', intent) ? (
            <p id="collector-intent-problem" className="mt-1.5 text-meta text-status-critical">
              {problems.intent}
            </p>
          ) : (
            <p id="collector-intent-hint" className="mt-1.5 text-meta text-ink-muted">
              This sentence becomes the contract every future run is scored against.
              {intent.value.length > MAX_INTENT - 100
                ? ` ${intent.value.length} / ${MAX_INTENT} characters.`
                : null}
            </p>
          )}
        </div>

        {/* The contract, forming as they type. Labelled "detected" everywhere it appears — the real
            field list is inferred by the model at creation and can differ from this reading of the
            punctuation. Hidden entirely until there is something to show, rather than sitting there
            as an empty box captioned "no fields yet". */}
        {fields.length > 0 ? (
          <div className="rounded-control border border-hairline bg-plane px-4 py-3">
            <p className="text-meta font-medium text-ink-secondary">
              Fields detected — {fields.length} {fields.length === 1 ? 'field' : 'fields'}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {fields.map((field) => (
                <li
                  key={field}
                  className="rounded-badge border border-accent-plane-border bg-accent-plane px-2.5 py-1 text-meta text-accent"
                >
                  {field}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-meta text-ink-muted">
              Confirmed against the page on the first run — this is a reading of your sentence, not
              the contract itself.
            </p>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
