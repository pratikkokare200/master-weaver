import { notFound, redirect } from 'next/navigation';

import { listCollectors } from '@/lib/queries.server';

/**
 * Landing route.
 *
 * Opens straight onto a collector rather than an index page, because "a judge forms their impression
 * from the empty state" — so the first screen must be populated (doc 05 §8).
 *
 * The target is resolved from the ledger instead of a hardcoded id. The fixture version redirected
 * to a slug that no longer exists now that collectors carry database uuids, and a landing route that
 * 404s is the worst possible first screen.
 *
 * A server redirect, so there is no client-side flash and the sidebar's active state is correct on
 * first paint.
 */

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const collectors = await listCollectors();

  // Prefer one that has actually run: an ACTIVE collector with history shows the product, while a
  // paused placeholder shows an empty frame. Falls back to the first if none have run yet.
  const target = collectors.find((c) => c.lastRunAt !== null) ?? collectors[0];
  if (!target) notFound();

  redirect(`/c/${target.id}`);
}
