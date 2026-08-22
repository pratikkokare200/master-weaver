import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * The one accent, used sparingly (doc 05 §1). `primary` is solid charcoal and there should be at
 * most one on screen at a time; everything else is a hairline-bordered secondary or a ghost.
 *
 * The primary button is a solid charcoal fill carrying a white label — the one place this palette
 * does not use its pastel-wash/readable-ink split. The split exists because a saturated mid-tone
 * cannot be both a soft fill and a legible background for text; charcoal has no such conflict, so
 * white sits on it at 11.6:1. The pastel cerulean this replaced topped out at 7.0:1 with the
 * darkest label it could carry, so going solid is a contrast gain, not a stylistic trade.
 *
 * The 1px border is a shade deeper than the fill rather than lighter. On a light plane a dark
 * block already asserts its own shape, so the edge is no longer doing the work it did for a
 * pastel — it just keeps the corner crisp where the fill meets the page.
 *
 * Minimum touch target is 36px tall in dense contexts and 44px for standalone actions (§8).
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-fill text-accent-ink border border-accent-border hover:bg-accent-fill-hover',
  secondary: 'bg-surface text-ink border border-hairline hover:bg-plane',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-plane hover:text-ink',
};

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control px-4 py-2',
        'text-body font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
