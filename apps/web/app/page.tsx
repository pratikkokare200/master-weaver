import { redirect } from 'next/navigation';

import { FLAGSHIP_COLLECTOR_ID } from '@/lib/seed';

/**
 * Landing route.
 *
 * Opens straight onto the flagship collector rather than an index page, because "a judge forms
 * their impression from the empty state" — so the first screen must be populated (doc 05 §8).
 *
 * A server redirect, so there is no client-side flash and the sidebar's active state is correct on
 * first paint.
 */
export default function HomePage() {
  redirect(`/c/${FLAGSHIP_COLLECTOR_ID}`);
}
