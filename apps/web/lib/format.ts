/**
 * Display formatting helpers.
 *
 * The one rule that matters here: a null never renders as a blank cell. It renders as an em-dash,
 * because a blank reads as a rendering bug while `—` reads as "we know this is missing" — which is
 * the entire product thesis (doc 05 §6, WorkspaceTable).
 */

/** The placeholder for any absent value. Never render an empty string instead. */
export const EM_DASH = '—';

export function formatOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EM_DASH;
  return String(value);
}

/** Field health as a two-decimal figure, e.g. `0.80`. */
export function formatFhs(fhs: number | null | undefined): string {
  if (fhs === null || fhs === undefined) return EM_DASH;
  return fhs.toFixed(2);
}

/** Field health as a whole percentage, e.g. `80%` — used in the policy card thresholds. */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * A percentage band, with the unit carried once at the end: `60–95%`, not `60%–95%`.
 *
 * Matches the policy card exactly as doc 05 §6 draws it.
 */
export function formatPercentRange(lower: number, upper: number): string {
  return `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`;
}

export function formatPrice(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return EM_DASH;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Relative time for ledger rows and run timestamps, e.g. `4 min ago`. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return EM_DASH;

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/** Absolute clock time for the ledger, e.g. `14:32`. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Golden-set line for the policy card — singular at 1, with the shape appended for listing
 * collectors (doc 05 §6).
 */
export function formatGoldenSet(count: number, shape: 'detail' | 'listing'): string {
  const noun = count === 1 ? 'URL' : 'URLs';
  const suffix = shape === 'listing' ? ' (listing)' : '';
  return `Golden set · ${count} ${noun}${suffix}`;
}
