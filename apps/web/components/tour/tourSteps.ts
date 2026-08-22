import { selectTab } from '@/lib/tabBus';

/**
 * The tour script.
 *
 * Four stops, because four is what a person will actually sit through. Each one answers a question
 * the screen raises but does not answer on its own — what the box at the top does with what you
 * type, what the number means and what happens when it drops, why there are five tabs, and that the
 * chat is a real query engine rather than a summariser.
 *
 * Copy rule: say what the thing *does*, not what it is called. "Data tabs" tells a reader nothing
 * they cannot see; "whatever you are looking at is what the export buttons give you" is the part
 * they would otherwise have to discover.
 *
 * Steps are matched to the DOM by `data-tour` attributes rather than class names or ids, so a
 * restyle cannot silently break the tour and a `data-tour` attribute is an obvious thing not to
 * delete. A step whose target is absent is dropped before the tour starts — see `ProductTour`.
 */

export interface TourStep {
  /** Value of the `data-tour` attribute on the element to spotlight. */
  target: string;
  title: string;
  body: string;
  /**
   * Put the app into the state this step describes, before it is measured.
   *
   * Pointing at the Chat tab while the Table panel is showing would be describing something the
   * viewer cannot see, so the step opens it first.
   */
  prepare?: () => void;
  /** Preferred side. Placement falls back to the other side when there is no room. */
  prefer?: 'top' | 'bottom';
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'command-bar',
    title: 'Describe what to collect',
    body:
      'Say what you want in plain English and give it a URL. That description becomes the ' +
      'collector’s contract — the list of fields every future run is scored against, and ' +
      'the thing a repair has to satisfy before it is allowed to commit.',
    prefer: 'bottom',
  },
  {
    target: 'collector-health',
    title: 'Health, and what happens when it drops',
    body:
      'Field health is the share of contracted fields that came back usable. The policy beside it ' +
      'is the rule that reads that number: below 0.60 the collector repairs itself; between 0.60 ' +
      'and 0.95 it stops and asks you first.',
    prefer: 'bottom',
  },
  {
    target: 'data-tabs',
    title: 'Five views of the same run',
    body:
      'Table is the tidied rows, Chart is price and health on one timeline, JSON is the raw ' +
      'payload exactly as the collector returned it. Whatever you are looking at is what the CSV ' +
      'and XLSX links export — there is no dataset picker to get wrong.',
    prepare: () => selectTab('table'),
    prefer: 'bottom',
  },
  {
    target: 'chat-tab',
    title: 'Ask a question in plain English',
    body:
      'Chat turns your question into SQL, runs it against this collector read-only, and answers ' +
      'from the rows it got back. The query is always shown beneath the answer — including ' +
      'when it was refused — so you can check what was actually asked.',
    prepare: () => selectTab('chat'),
    prefer: 'bottom',
  },
];
