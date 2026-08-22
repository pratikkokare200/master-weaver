import { InfoIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * Tooltips — the explanatory layer.
 *
 * This product asks a reader to trust numbers they have never seen before: a field-health score,
 * a repair policy that fires automatically below one threshold and asks below another, five panels
 * that each show a different slice of the same run. Every one of those is obvious once explained
 * and opaque until it is. A tooltip is the cheapest place to explain it, because it costs nothing
 * until someone asks.
 *
 * Three deliberate constraints:
 *
 * **CSS-only.** No state, no portal, no positioning library. Reveal is `:hover` plus
 * `:focus-within` on the trigger's `group`, which means these work unchanged inside server
 * components — `FieldHealthTile` and `CollectorPolicyBlock` never had to become client components
 * to get them. The cost is that a bubble cannot escape a clipping ancestor, so any container that
 * hosts one must not scroll; see the note on the tab strip in `ObservationTabs`.
 *
 * **Flat.** Dark slate fill, no shadow, no blur. On a page this pale a white bubble with a
 * hairline is invisible without a drop shadow, and the drop shadow is exactly what the design is
 * getting rid of. Inverting separates the layer with contrast instead.
 *
 * **Announced once.** The bubble is `aria-hidden` and the description reaches assistive tech
 * through the trigger's own `aria-describedby` (or `aria-label`, for the bare info icon). Marking
 * the bubble `role="tooltip"` *as well* is the common mistake — the text then gets read twice, once
 * as the description and once as the element.
 *
 * Ids are passed in rather than generated with `useId` for the same reason: `useId` is a hook, a
 * hook forces a client boundary, and every call site here already has a stable id to hand.
 */

type Side = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';

const SIDE: Record<Side, string> = {
  top: 'bottom-full mb-2',
  bottom: 'top-full mt-2',
};

const ALIGN: Record<Align, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
};

/** The arrow sits on the opposite edge from the side the bubble opens toward. */
const ARROW_SIDE: Record<Side, string> = {
  top: '-bottom-1',
  bottom: '-top-1',
};

const ARROW_ALIGN: Record<Align, string> = {
  start: 'left-4',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-4',
};

export interface TooltipBubbleProps {
  /** Referenced by the trigger's `aria-describedby`. */
  id: string;
  children: React.ReactNode;
  side?: Side;
  align?: Align;
  /** Widen for a two-sentence explanation; the default holds about twelve words a line. */
  width?: 'default' | 'wide';
}

/**
 * The bubble on its own, for triggers that are already the `group` — a tab button, say, which
 * cannot be wrapped because a tablist may contain tabs and nothing else.
 *
 * The host element needs `group relative` and must not clip its overflow.
 */
export function TooltipBubble({
  id,
  children,
  side = 'top',
  align = 'center',
  width = 'default',
}: TooltipBubbleProps) {
  return (
    <span
      id={id}
      aria-hidden="true"
      className={cn(
        'tooltip-bubble pointer-events-none absolute z-20 block',
        'rounded-control border border-tooltip-plane bg-tooltip-plane px-3 py-2',
        'text-left text-meta font-normal leading-relaxed text-tooltip-ink',
        width === 'wide' ? 'w-72' : 'w-56',
        SIDE[side],
        ALIGN[align],
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className={cn('absolute h-2 w-2 rotate-45 bg-tooltip-plane', ARROW_SIDE[side], ARROW_ALIGN[align])}
      />
    </span>
  );
}

export interface TooltipProps extends Omit<TooltipBubbleProps, 'children'> {
  /** The explanation. One or two plain sentences — a tooltip is not a manual page. */
  label: React.ReactNode;
  /** The trigger. It should carry `aria-describedby={id}` so the text is announced on focus. */
  children: React.ReactNode;
  className?: string;
}

/** Wraps an existing trigger. The caller keeps ownership of the trigger's own markup. */
export function Tooltip({ id, label, children, side, align, width, className }: TooltipProps) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <TooltipBubble id={id} side={side} align={align} width={width}>
        {label}
      </TooltipBubble>
    </span>
  );
}

export interface HintLabelProps extends Omit<TooltipBubbleProps, 'children'> {
  /** What is on screen — a stat caption, a legend row, a column name. */
  children: React.ReactNode;
  /** What it means. */
  tip: React.ReactNode;
  className?: string;
}

/**
 * A label that explains itself on hover.
 *
 * The affordance is a dotted underline, which is the one convention for "there is more here" that
 * does not look like a link and does not need a second icon beside every caption. `cursor-help`
 * confirms it before the bubble arrives.
 *
 * `tabIndex={0}` because a mouse-only hint is a hint half the audience cannot reach. The element is
 * not a control — nothing happens when it is activated — so it stays a `span` with a description
 * rather than pretending to be a button.
 */
export function HintLabel({ children, tip, id, side = 'top', align = 'start', width, className }: HintLabelProps) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={id}
        className={cn(
          'cursor-help underline decoration-dotted decoration-from-font underline-offset-4',
          'transition-colors hover:text-ink-secondary',
          className,
        )}
      >
        {children}
      </span>
      <TooltipBubble id={id} side={side} align={align} width={width}>
        {tip}
      </TooltipBubble>
    </span>
  );
}

export interface InfoTipProps extends Omit<TooltipBubbleProps, 'children'> {
  /** Read out on focus and shown in the bubble. */
  label: string;
  /** Muted when the thing it annotates is itself low-confidence rather than wrong. */
  muted?: boolean;
}

/**
 * A bare info icon with a tooltip, for places with no label to underline.
 *
 * Informational only — focusable so the tooltip is reachable by keyboard, but not an action. The
 * text arrives via `aria-label` on the trigger rather than `aria-describedby`, because an icon with
 * no accessible name of its own would otherwise announce as nothing at all.
 */
export function InfoTip({ label, muted = false, id, side = 'top', align = 'end', width }: InfoTipProps) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        role="note"
        aria-label={label}
        className={cn(
          'inline-flex h-4 w-4 cursor-help items-center justify-center rounded-badge transition-colors',
          muted ? 'text-ink-muted hover:text-ink-secondary' : 'text-ink-secondary hover:text-ink',
        )}
      >
        <InfoIcon size={14} />
      </span>
      <TooltipBubble id={id} side={side} align={align} width={width}>
        {label}
      </TooltipBubble>
    </span>
  );
}
