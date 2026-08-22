import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * The one accent, used sparingly (doc 05 §1). `primary` is solid teal and there should be at most
 * one on screen at a time; everything else is a hairline-bordered secondary or a ghost.
 *
 * The primary button is a solid teal fill carrying a white label at 5.5:1 — a genuine fill, not a
 * pastel wash. It uses `--accent-fill` rather than `--accent`, and those are two different values:
 * the fill is the brighter register so the button reads as teal from across a room, and the ink is
 * a step deeper so it can clear AA as *text* on white, on the page plane and on the accent wash.
 * One value cannot be both without either dulling the button or failing a label somewhere.
 *
 * The 1px border is deeper than the fill rather than lighter, and deeper than the hover fill too,
 * so the edge survives both states. On a light plane a saturated block already asserts its own
 * shape — the edge just keeps the corner crisp where the fill meets the page.
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
