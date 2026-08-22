import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * The one accent, used sparingly (doc 05 §1). `primary` is pastel lavender and there should be at
 * most one on screen at a time; everything else is a hairline-bordered secondary or a ghost.
 *
 * The primary button is a pastel *fill* carrying a deep lavender label, not a saturated fill
 * carrying white. White on a genuinely pastel surface is unreadable, and darkening the fill until
 * white works turns the pastel back into the indigo this palette replaced — so the label goes dark
 * instead. The 1px lavender border is what keeps the result a button rather than a soft patch of
 * colour: with shadows gone, the edge is the only thing asserting the shape.
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
