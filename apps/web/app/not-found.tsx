import Link from 'next/link';

import { InboxIcon } from '@/components/icons';

/**
 * Not-found route.
 *
 * Plain language and a way out. Doc 05's deep-link contract is explicit that a stale alert is
 * normal rather than a fault, so nothing here scolds the visitor.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-card border border-hairline bg-plane text-ink-muted">
        <InboxIcon size={20} />
      </div>
      <p className="text-section font-semibold text-ink">Collector not found</p>
      <p className="mt-2 max-w-sm text-body text-ink-secondary">
        This collector may have been removed, or the link may be out of date.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-control border border-hairline bg-surface px-3 py-2 text-body font-medium text-ink transition-colors hover:bg-plane"
      >
        Back to collectors
      </Link>
    </div>
  );
}
