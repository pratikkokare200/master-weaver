import { Button } from '@/components/ui/Button';
import type { IconProps } from '@/components/icons';
import { InboxIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  /** What isn't here yet, in three or four words. */
  title: string;
  /** One line explaining why, in plain language. */
  description: string;
  /** The action that fixes it. Doc 05 §8 requires empty states to name it. */
  action?: { label: string; onClick?: () => void };
  icon?: (props: IconProps) => React.ReactElement;
  className?: string;
}

/**
 * The empty state — icon, one line of explanation, and the action that fixes it (doc 05 §8).
 *
 * "A judge forms their impression from the empty state, because that's what a fresh workspace
 * shows." It fills the panel's reserved height rather than collapsing it, so switching between
 * empty and populated causes no layout shift.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = InboxIcon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-card border border-hairline bg-plane text-ink-muted">
        <Icon size={20} />
      </div>
      <p className="text-section font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-sm text-body text-ink-secondary">{description}</p>
      {action ? (
        <Button variant="secondary" className="mt-6 min-h-11" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
