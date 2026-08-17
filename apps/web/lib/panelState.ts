/**
 * The four states every panel must implement (doc 05 §8).
 *
 * Exposed as a `?state=` query param on the collector route so each one can be opened, reviewed and
 * screenshotted without waiting for the matching real condition. The default is `populated`.
 */

export const PANEL_STATES = ['populated', 'empty', 'loading', 'error'] as const;

export type PanelState = (typeof PANEL_STATES)[number];

export function parsePanelState(value: string | string[] | undefined): PanelState {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (PANEL_STATES as readonly string[]).includes(candidate ?? '')
    ? (candidate as PanelState)
    : 'populated';
}
