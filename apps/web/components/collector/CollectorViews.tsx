'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_VIEW, isViewId, type ViewId } from '@/components/collector/views';
import { onSelectTab } from '@/lib/tabBus';

/**
 * Which view the dashboard is showing, held above both the switcher and the panel.
 *
 * The switcher is now pinned to the top of the page and the panel sits down where the data is, so
 * the two are no longer parent and child and cannot share `useState` the way `ObservationTabs` did.
 * Everything between them — the collector header, the health card, the repair prompt — is a server
 * component, so lifting the state into the page was not an option either.
 *
 * A context provider around the whole page column is the small answer. The page stays a server
 * component and passes its server-rendered children straight through; React still wires the context
 * up on the client, because what matters is where the elements end up in the tree, not where they
 * were created.
 *
 * Two refs ride along with the state. `panelRef` is what a click scrolls to, and `barRef` is how far
 * down it has to stop — a sticky bar covers the top of the viewport, so scrolling the panel to
 * `top: 0` would slide its first rows underneath the very control that was just pressed.
 */

interface CollectorViewValue {
  active: ViewId;
  /** Select a view because the reader asked for it. Brings the panel into view if it is off screen. */
  showView: (id: ViewId) => void;
  panelRef: React.RefObject<HTMLElement | null>;
  barRef: React.RefObject<HTMLDivElement | null>;
}

const CollectorViewContext = createContext<CollectorViewValue | null>(null);

export function useCollectorView(): CollectorViewValue {
  const value = useContext(CollectorViewContext);
  if (!value) {
    throw new Error('useCollectorView must be used inside <CollectorViews>');
  }
  return value;
}

/** Breathing room between the sticky switcher and the panel it scrolls to. */
const SCROLL_GAP = 12;

/**
 * How much of the panel has to be on screen before a switch counts as already visible.
 *
 * "Any part of it is in the viewport" was the first version and it was useless: on a 1000px window
 * the panel's top edge peeks in at the bottom of the page, which satisfies that test while showing
 * a reader nothing but a border. Pressing Chat and watching a hairline appear reads as a dead
 * button. A panel is worth scrolling to unless a real amount of it — or all of it, for a short
 * one — is already there.
 */
const ENOUGH_VISIBLE = 320;

export function CollectorViews({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ViewId>(DEFAULT_VIEW);
  const panelRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  /**
   * The product tour opens the view it is about to describe.
   *
   * Deliberately `setActive` and not `showView`: the tour does its own scrolling, one frame later,
   * to frame the target and its popover together. Two smooth scrolls racing each other lands
   * wherever the second one happens to finish, which is how a tour ends up describing something
   * half off the screen.
   *
   * Guarded against unknown ids so a bad dispatch cannot leave this in a state with no panel.
   */
  useEffect(() => onSelectTab((id) => { if (isViewId(id)) setActive(id); }), []);

  const showView = useCallback((id: ViewId) => {
    setActive(id);

    const panel = panelRef.current;
    if (!panel) return;

    // Only when the panel is not already usefully on screen. Scrolling a panel that is in front of
    // the reader moves the page under them for no reason, which reads as a glitch rather than help.
    const rect = panel.getBoundingClientRect();
    const ceiling = (barRef.current?.offsetHeight ?? 0) + SCROLL_GAP;
    const onScreen = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, ceiling);
    if (onScreen >= Math.min(rect.height, ENOUGH_VISIBLE)) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: Math.max(0, rect.top + window.scrollY - ceiling),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, []);

  const value = useMemo<CollectorViewValue>(
    () => ({ active, showView, panelRef, barRef }),
    [active, showView],
  );

  return (
    <CollectorViewContext.Provider value={value}>
      <div className="flex flex-col gap-6">{children}</div>
    </CollectorViewContext.Provider>
  );
}
