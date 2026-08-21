import { DownloadIcon } from '@/components/icons';

/**
 * Export what you are looking at.
 *
 * The control lives in the tab strip and follows the active tab: the table and JSON views export
 * the rows, the chart exports the run history, the ledger exports the healing episodes. One rule,
 * no dataset picker — a menu offering three datasets from a page already showing one of them makes
 * the reader choose something they have already chosen.
 *
 * Two plain links rather than a button that fetches and synthesises a download. The response is an
 * attachment, so the browser handles it natively: progress, cancel, retry, and a URL that can be
 * pasted into a terminal. Nothing here needs to be a client component.
 */

export type ExportDataset = 'rows' | 'runs' | 'episodes';

const DESCRIPTION: Record<ExportDataset, string> = {
  rows: 'the latest rows',
  runs: 'the run history',
  episodes: 'the healing ledger',
};

export interface ExportMenuProps {
  collectorId: string;
  dataset: ExportDataset;
}

export function ExportMenu({ collectorId, dataset }: ExportMenuProps) {
  const href = (format: 'csv' | 'xlsx') =>
    `/api/collectors/${collectorId}/export?dataset=${dataset}&format=${format}`;

  const link =
    'inline-flex min-h-8 items-center rounded-control px-2 text-meta text-ink-secondary ' +
    'transition-colors hover:bg-plane hover:text-ink focus-visible:outline focus-visible:outline-2 ' +
    'focus-visible:outline-offset-2 focus-visible:outline-accent';

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
      <DownloadIcon size={14} className="text-ink-muted" />
      {/* The dataset is named in the accessible label, not on screen: on screen the active tab
          already says it, but a screen reader meeting this control out of context would hear
          "CSV" twice on a page with more than one export. */}
      <a className={link} href={href('csv')} download aria-label={`Download ${DESCRIPTION[dataset]} as CSV`}>
        CSV
      </a>
      <span className="text-ink-muted" aria-hidden>
        ·
      </span>
      <a className={link} href={href('xlsx')} download aria-label={`Download ${DESCRIPTION[dataset]} as Excel`}>
        XLSX
      </a>
    </div>
  );
}
