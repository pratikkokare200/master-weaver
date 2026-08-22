'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { TOUR_STEPS, type TourStep } from '@/components/tour/tourSteps';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

/**
 * The product tour.
 *
 * Built rather than installed. driver.js and react-joyride both ship their own visual language —
 * rounded popovers, drop shadows, a glow around the cutout — and matching this design system would
 * have meant overriding almost all of it, which is more code than the 200 lines below plus a
 * dependency whose next release can restyle the demo. The repo already makes this argument about
 * `clsx` in `lib/cn.ts`; it applies with more force to something that paints over the whole screen.
 *
 * How it is put together:
 *
 * **The scrim is one SVG with a masked cutout**, not four rectangles butted together. The mask gives
 * the spotlight a real 8px corner radius matching `--radius-card`, where four rects would leave
 * square corners against rounded cards. It stays flat — a hard-edged cut and a 1px accent stroke,
 * no glow, no blur. Translucency is the one thing a scrim is *for*, so it is the single place this
 * design keeps it, and it uses the same ink-at-low-alpha as the existing mobile drawer scrim.
 *
 * **The spotlight tracks on `requestAnimationFrame`** rather than on scroll and resize listeners.
 * The target moves for reasons no listener catches — a smooth `scrollIntoView` in flight, a panel
 * changing height as its tab switches, the live badge re-rendering underneath. Measuring every
 * frame and setting state only when the rect actually changes is both simpler and more correct than
 * enumerating the events that could have moved it.
 *
 * **Scrolling frames the target and its popover as one unit**, rather than centring the target and
 * hoping. Centring the target alone splits the leftover space in two and can leave neither half big
 * enough — that is what ran the popover off the bottom of the screen on the collector summary card,
 * which is 368px tall beside a 338px popover. Centring the *pair* keeps them together and keeps the
 * popover attached to what it is describing; only when the pair genuinely cannot fit does the target
 * pin to the top and take whatever is left.
 *
 * The popover is then clamped into the viewport regardless, as a last resort, and drops its arrow
 * when the clamp moves it — an arrow that no longer touches what it points at is worse than none.
 *
 * The scrim intentionally swallows clicks, including inside the cutout. A tour that lets you click
 * the thing it is describing is a tour you can leave in an inconsistent state halfway through.
 */

/** Breathing room between the target's own edge and the cut. */
const SPOTLIGHT_PAD = 8;
/** Distance from the cut to the popover. */
const POPOVER_GAP = 12;
const POPOVER_WIDTH = 340;
/** Keeps the popover off the viewport edge. */
const VIEWPORT_MARGIN = 16;
/** Used only before the popover has been measured once. */
const ASSUMED_POPOVER_HEIGHT = 240;
/**
 * Where a target sits when it and its popover cannot both fit on screen: hard against the standard
 * viewport margin, which buys the popover every pixel there is. The collector summary card needs
 * most of them — it is 368px tall next to a 338px popover.
 */
const PINNED_TARGET_OFFSET = VIEWPORT_MARGIN;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function findTarget(step: TourStep | undefined): HTMLElement | null {
  if (!step) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

export interface ProductTourProps {
  onClose: () => void;
}

export function ProductTour({ onClose }: ProductTourProps) {
  // Steps whose target is not on this page are dropped once, at mount, so the counter reads "2 of
  // 3" rather than "2 of 4" with one stop that silently does nothing.
  const steps = useMemo(() => TOUR_STEPS.filter((step) => findTarget(step) !== null), []);

  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [popoverHeight, setPopoverHeight] = useState(ASSUMED_POPOVER_HEIGHT);

  const popoverRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Mirrors `popoverHeight` for the scroll effect, which needs the current height but must not
  // re-run — and therefore re-scroll — every time it changes.
  const popoverHeightRef = useRef(ASSUMED_POPOVER_HEIGHT);

  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  // Nothing to show: a tour with no reachable targets closes rather than presenting an empty frame.
  useEffect(() => {
    if (steps.length === 0) close();
  }, [steps.length, close]);

  // Remember where focus came from, and put it back on the way out. A tour that drops focus at the
  // top of the document makes a keyboard user re-traverse the page they just had explained to them.
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    return () => returnFocusRef.current?.focus?.();
  }, []);

  // Put the app into the state this step describes, then bring the target into view.
  useEffect(() => {
    if (!step) return;
    step.prepare?.();

    // One frame, so a panel mounted by `prepare` exists before we scroll to it.
    const raf = requestAnimationFrame(() => {
      const element = findTarget(step);
      if (!element) return;

      // Scrolled by hand rather than with `scrollIntoView`, which can only frame the target and has
      // no way to reserve room for the popover that has to sit beside it.
      const rect = element.getBoundingClientRect();
      const documentTop = rect.top + window.scrollY;

      // The spotlight plus everything the popover needs underneath it.
      const belowTarget = SPOTLIGHT_PAD + POPOVER_GAP + popoverHeightRef.current + VIEWPORT_MARGIN;
      const pairHeight = rect.height + belowTarget;
      const headroom = SPOTLIGHT_PAD + VIEWPORT_MARGIN;

      const viewportTop =
        pairHeight + headroom <= window.innerHeight
          ? Math.max(headroom, (window.innerHeight - pairHeight) / 2)
          : PINNED_TARGET_OFFSET;

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({
        top: Math.max(0, documentTop - viewportTop),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // Track the target every frame; commit state only when it has actually moved.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let previous = '';

    const tick = () => {
      const element = findTarget(step);
      if (element) {
        const rect = element.getBoundingClientRect();
        const next: Box = {
          x: Math.round(rect.left - SPOTLIGHT_PAD),
          y: Math.round(rect.top - SPOTLIGHT_PAD),
          w: Math.round(rect.width + SPOTLIGHT_PAD * 2),
          h: Math.round(rect.height + SPOTLIGHT_PAD * 2),
        };
        const key = `${next.x}|${next.y}|${next.w}|${next.h}`;
        if (key !== previous) {
          previous = key;
          setBox(next);
        }
      } else if (previous !== 'gone') {
        previous = 'gone';
        setBox(null);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // The popover's own height, needed to choose a side and to frame the scroll.
  useLayoutEffect(() => {
    const height = popoverRef.current?.offsetHeight;
    if (!height) return;
    popoverHeightRef.current = height;
    if (height !== popoverHeight) setPopoverHeight(height);
  }, [index, box, popoverHeight]);

  // Focus the popover when the step changes, so Tab starts inside it and a screen reader reads the
  // new step rather than staying on the button that was pressed.
  useEffect(() => {
    popoverRef.current?.focus();
  }, [index]);

  const goNext = useCallback(() => {
    setIndex((current) => (current >= steps.length - 1 ? current : current + 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setIndex((current) => (current <= 0 ? current : current - 1));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isLast) close();
        else goNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, goBack, goNext, isLast]);

  /**
   * Minimal focus trap. The scrim blocks the pointer but not the Tab key, and focus landing on a
   * button behind a modal overlay is the classic way this pattern goes wrong.
   */
  function handleTrap(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const focusable = popoverRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!step) return null;

  // ---- Placement -------------------------------------------------------------------------------
  const viewportW = typeof window === 'undefined' ? 0 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 0 : window.innerHeight;

  const roomBelow = box ? viewportH - (box.y + box.h) - POPOVER_GAP - VIEWPORT_MARGIN : 0;
  const roomAbove = box ? box.y - POPOVER_GAP - VIEWPORT_MARGIN : 0;

  // Prefer the requested side; fall back to the other if it fits; if neither fits, take whichever
  // has more room and let the clamp below keep the popover on screen.
  let side: 'top' | 'bottom' = step.prefer ?? 'bottom';
  if (box) {
    const fitsBelow = roomBelow >= popoverHeight;
    const fitsAbove = roomAbove >= popoverHeight;
    if (side === 'bottom' && !fitsBelow) side = fitsAbove || roomAbove > roomBelow ? 'top' : 'bottom';
    else if (side === 'top' && !fitsAbove) side = fitsBelow || roomBelow > roomAbove ? 'bottom' : 'top';
  }

  const centeredLeft = box
    ? box.x + box.w / 2 - POPOVER_WIDTH / 2
    : viewportW / 2 - POPOVER_WIDTH / 2;
  const left = Math.round(
    Math.min(
      Math.max(centeredLeft, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportW - POPOVER_WIDTH - VIEWPORT_MARGIN),
    ),
  );

  const preferredTop = box
    ? side === 'bottom'
      ? box.y + box.h + POPOVER_GAP
      : box.y - POPOVER_GAP - popoverHeight
    : viewportH / 2 - popoverHeight / 2;

  // The last word on placement: whatever the maths above wanted, the popover stays on screen.
  const lowestTop = Math.max(VIEWPORT_MARGIN, viewportH - popoverHeight - VIEWPORT_MARGIN);
  const top = Math.round(Math.min(Math.max(preferredTop, VIEWPORT_MARGIN), lowestTop));
  const wasClamped = Math.abs(top - preferredTop) > 1;

  const positionStyle: React.CSSProperties = { top, left };

  // Arrow sits under the target's centre, clamped so it never runs off the popover's own corner.
  // Dropped entirely when the popover had to be moved, since it would point at nothing.
  const arrowLeft =
    box && !wasClamped
      ? Math.round(Math.min(Math.max(box.x + box.w / 2 - left, 20), POPOVER_WIDTH - 20))
      : null;

  const titleId = 'weaver-tour-title';
  const bodyId = 'weaver-tour-body';

  return (
    <div className="fixed inset-0 z-50">
      {/* Scrim and spotlight. `aria-hidden` because everything it conveys is also in the popover,
          and a screen reader has no use for a masked rectangle. */}
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <mask id="weaver-tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="#ffffff" />
            {box ? (
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="8" fill="#000000" />
            ) : null}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          style={{ fill: 'var(--scrim)' }}
          mask="url(#weaver-tour-mask)"
        />
        {box ? (
          <rect
            x={box.x + 0.5}
            y={box.y + 0.5}
            width={Math.max(0, box.w - 1)}
            height={Math.max(0, box.h - 1)}
            rx="8"
            fill="none"
            style={{ stroke: 'var(--accent)' }}
            strokeWidth="1"
          />
        ) : null}
      </svg>

      <div
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={handleTrap}
        style={{ ...positionStyle, width: POPOVER_WIDTH }}
        className="absolute rounded-card border border-hairline bg-surface p-6 focus:outline-none"
      >
        {/* Same arrow geometry as the tooltips: a rotated square carrying two of the card's own
            border edges, so the hairline reads as continuous around the corner. */}
        {arrowLeft !== null ? (
          <span
            aria-hidden="true"
            style={{ left: arrowLeft }}
            className={cn(
              'absolute -ml-1 h-2 w-2 rotate-45 bg-surface',
              side === 'bottom' ? '-top-1 border-l border-t' : '-bottom-1 border-r border-b',
            )}
          />
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <p className="text-meta tabular-nums text-ink-muted">
            {index + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={close}
            className="rounded-control px-2 py-1 text-meta text-ink-muted transition-colors hover:text-ink"
          >
            Skip tour
          </button>
        </div>

        {/* Same 4px meter geometry as the credit meter and the health tile (§5.6). */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-badge bg-hairline">
          <div
            className="h-full rounded-badge bg-accent"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>

        <h2 id={titleId} className="mt-4 text-section font-semibold text-ink">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-2 text-body leading-relaxed text-ink-secondary">
          {step.body}
        </p>

        <div className="mt-6 flex items-center justify-end gap-2">
          {!isFirst ? (
            <Button variant="secondary" onClick={goBack}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" onClick={isLast ? close : goNext}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
