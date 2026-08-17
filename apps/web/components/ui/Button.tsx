import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/**
 * The one accent, used sparingly (doc 05 §1). `primary` is indigo and there should be at most one
 * on screen at a time; everything else is a hairline-bordered secondary or a ghost.
 *
 * Minimum touch target is 36px tall in dense contexts and 44px for standalone actions (§8).
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-hairline hover:bg-plane',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-plane hover:text-ink',
};

export function Button({ variant = 'secondary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control px-3 py-2',
        'text-body font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
