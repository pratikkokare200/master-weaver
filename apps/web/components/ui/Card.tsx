import { cn } from '@/lib/cn';

/**
 * Card surface: white, hairline border, 8px radius, no shadow — and now no shadow anywhere else
 * either. Every layer in this app is a solid fill plus a 1px border (doc 05 §2.3, tightened by the
 * pastel pass); a card that sits in the page plane gets an edge, never a blur.
 *
 * Padding is 24px. It was 16px while cards were separated by shadow as well as space; once the
 * shadow went, white space became the only separation and had to carry more.
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
    <div className={cn('flex items-center justify-between border-b border-hairline px-6 py-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-section font-semibold text-ink">{children}</h2>;
}
