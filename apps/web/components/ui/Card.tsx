import { cn } from '@/lib/cn';

/**
 * Card surface: white, hairline border, 8px radius, no shadow.
 *
 * Shadows belong only to genuinely floating layers — dropdown, modal, tooltip (doc 05 §2.3).
 * A card that sits in the page plane gets a border, not a shadow.
 */
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-card border border-hairline bg-surface', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between border-b border-hairline px-4 py-3', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-section font-semibold text-ink">{children}</h2>;
}
