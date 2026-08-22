/**
 * A one-event bus for "show me that tab".
 *
 * The product tour needs to put the observation panel on `Chat` before it can point at it, and the
 * tour lives in the app shell while the tab state lives inside `ObservationTabs`, several levels
 * down a server-rendered tree. The alternatives were both worse than a custom event: lifting the
 * active tab into the page would make a server component hold client state, and threading a ref
 * down through `CollectorPage` would put tour plumbing in the signature of a component that has
 * nothing to do with the tour.
 *
 * Deliberately not a general-purpose event bus. One event, one payload, two functions — if a second
 * caller ever needs this, that is the moment to reconsider, not now.
 */

export const SELECT_TAB_EVENT = 'weaver:select-tab';

/** Ask the observation panel to switch tabs. No-ops during SSR. */
export function selectTab(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(SELECT_TAB_EVENT, { detail: id }));
}

/** Subscribe. Returns the unsubscribe function, shaped for a `useEffect` return. */
export function onSelectTab(handler: (id: string) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<string>).detail);
  window.addEventListener(SELECT_TAB_EVENT, listener);
  return () => window.removeEventListener(SELECT_TAB_EVENT, listener);
}
