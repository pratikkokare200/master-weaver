import { AlertIcon, RetryIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface ErrorStateProps {
  /** What failed, in plain language — not an exception class name. */
  title: string;
  /** One or two lines of detail the reader can act on. */
  description: string;
  /** Optional technical detail, rendered in mono and visually subordinate. */
  detail?: string;
  onRetry?: () => void;
  className?: string;
}

/**
 * The error state — what failed in plain language, plus a retry (doc 05 §8).
 *
 * The icon is not decorative: status never rides on hue alone (§5.2), so the critical color always
 * ships alongside an icon and a text label.
 *
 * Note this uses the critical status color, never amber. Amber belongs to the healing state and
 * nothing else — an amber error would make the healing badge stop reading as an event.
 */
export function ErrorState({ title, description, detail, onRetry, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-card border border-hairline bg-status-critical-plane text-status-critical">
        <AlertIcon size={20} />
      </div>
      <p className="text-section font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-md text-body text-ink-secondary">{description}</p>
      {detail ? (
        <p className="mt-3 max-w-md truncate rounded-control border border-hairline bg-plane px-3 py-2 font-mono text-meta text-ink-muted">
          {detail}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" className="mt-6 min-h-11" onClick={onRetry}>
          <RetryIcon size={14} />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
