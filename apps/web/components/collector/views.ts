import type { ExportDataset } from '@/components/collector/ExportMenu';
import { ChartIcon, ChatIcon, JsonIcon, LedgerIcon, TableIcon } from '@/components/icons';
import type { IconProps } from '@/components/icons';

/**
 * The five views of a collector run, and the one place they are declared.
 *
 * These used to live inside `ObservationTabs`, which owned the strip and the panel together. The
 * strip has since moved to the top of the page as the dashboard's primary view switcher, and the
 * panel stayed where the data is — so the definition had to come out of both and sit somewhere
 * neither one owns. `ViewSwitcher` renders the buttons from this list and `ObservationPanel`
 * renders the bodies from the same list, which is what keeps a tab from ever pointing at a panel
 * that is not there.
 *
 * Five one-word labels are five guesses about what is behind each one. `Ledger` in particular reads
 * as an accounting feature until you open it, and `JSON` and `Table` sound like the same thing shown
 * twice — so each carries a tooltip naming what it holds and how it differs from its neighbours.
 */
export const VIEWS = [
  {
    id: 'table',
    label: 'Table',
    icon: TableIcon,
    tip: 'Rows from the latest run, tidied into columns. A value that never came back shows as an em dash, never as a blank cell.',
    tipAlign: 'start',
  },
  {
    id: 'chart',
    label: 'Chart',
    icon: ChartIcon,
    tip: 'Price and field health on one shared timeline, so a collapse in one lines up with the other. Dashed marks are repairs.',
    tipAlign: 'start',
  },
  {
    id: 'json',
    label: 'JSON',
    icon: JsonIcon,
    tip: 'The raw payload exactly as the collector returned it — the table’s rows, before any tidying.',
    tipAlign: 'center',
  },
  {
    id: 'chat',
    label: 'Chat',
    icon: ChatIcon,
    tip: 'Ask about this collector in plain English. The SQL behind each answer is always shown beneath it.',
    tipAlign: 'end',
  },
  {
    id: 'ledger',
    label: 'Ledger',
    icon: LedgerIcon,
    tip: 'Every repair attempted here: the diagnosis, the score that approved or rejected it, and what it cost.',
    tipAlign: 'end',
  },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: (props: IconProps) => React.ReactElement;
  tip: string;
  /* Anchored per view rather than always centred: a centred bubble on the leftmost button hangs off
     the strip, and on the rightmost it hangs off the viewport. Anchoring outward-in keeps every
     bubble inside the strip at any width. */
  tipAlign: 'start' | 'center' | 'end';
}>;

export type ViewId = (typeof VIEWS)[number]['id'];

export const DEFAULT_VIEW: ViewId = 'table';

export function isViewId(value: string): value is ViewId {
  return VIEWS.some((view) => view.id === value);
}

/**
 * Which dataset each view exports — "export what you are looking at".
 *
 * `chat` maps to nothing, so the control disappears there. A conversation has no rows, and a
 * disabled download button would only raise the question of what it would have contained.
 */
export const EXPORTS: Record<ViewId, ExportDataset | null> = {
  table: 'rows',
  chart: 'runs',
  json: 'rows',
  chat: null,
  ledger: 'episodes',
};
