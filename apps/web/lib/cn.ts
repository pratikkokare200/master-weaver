/**
 * Minimal class-name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge` — this app has a fixed token set and no runtime class
 * conflicts to resolve, so two dependencies would buy nothing.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
