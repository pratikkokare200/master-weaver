/**
 * Discord alerts — doc 03 §6.3.
 *
 * **Three events, and only three:** `RESTORED`, `QUARANTINED`, and `PENDING_OPERATOR`.
 *
 * Never on transient failures, and never on the autonomous state transitions in between. That
 * restraint is a design decision rather than an omission: doc 03 calls alert fatigue "a design flaw
 * a judge will notice", and a channel that pings on every `DIAGNOSING → HEALING` is a channel people
 * mute — at which point the one alert that genuinely needed a human gets muted with it.
 *
 * Only one of the three is actionable. `PENDING_OPERATOR` is a request: it carries enough context to
 * decide *without* opening the app, and a deep link for when you choose to. The other two are
 * receipts — something finished, here is what it cost.
 *
 * Delivery is best-effort by construction. A webhook that is slow, rate-limited or misconfigured must
 * never fail an episode: the repair either happened or it did not, and Discord's opinion of that is
 * not part of the transaction. Every failure is logged and swallowed.
 */

import type { Logger } from './log.js';

/** Colours match the design system (doc 05 §2.2) so the embeds read as the same product as the UI. */
const COLOR = {
  /** Success green. */
  RESTORED: 5_763_719,
  /** `--healing` amber. Reserved for attention, never for errors. */
  PENDING_OPERATOR: 16_436_245,
  /** `--status-critical` #d03b3b. Errors are red, never amber. */
  QUARANTINED: 13_646_651,
} as const;

export interface DiscordConfig {
  /** `DISCORD_WEBHOOK_URL`. Null disables notification entirely, which is a valid configuration. */
  webhookUrl: string | null;
  /** Base URL of the Observation Deck, for the `PENDING_OPERATOR` deep link. */
  appBaseUrl: string;
  /** Per-request timeout. A hanging webhook must not hold an episode open. */
  timeoutMs?: number;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface Embed {
  title: string;
  description?: string;
  color: number;
  url?: string;
  fields: EmbedField[];
  timestamp?: string;
}

export interface RestoredAlert {
  collectorName: string;
  fieldsRepaired: string[];
  fhsBefore: number;
  fhsAfter: number | null;
  attempts: number;
  rejections: number;
  creditsSpent: number | null;
  durationMs: number;
}

export interface QuarantinedAlert {
  collectorName: string;
  reason: string;
  attempts: number;
  fhsBefore: number;
  creditsSpent: number | null;
  durationMs: number;
}

export interface PendingOperatorAlert {
  collectorId: string;
  collectorName: string;
  fhsBefore: number;
  fhsNow: number;
  failedFields: string[];
  healthyFields: string[];
  /** First 300 characters of the generated diagnosis, per doc 03 §6.3. */
  proposedFix?: string | null;
}

export interface Notifier {
  restored(alert: RestoredAlert): Promise<void>;
  quarantined(alert: QuarantinedAlert): Promise<void>;
  pendingOperator(alert: PendingOperatorAlert): Promise<void>;
  /** True when a webhook is configured. Useful for a boot-time log line. */
  readonly enabled: boolean;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(0)}s`;
}

function credits(value: number | null): string {
  return value === null ? 'unmeasured' : `${value} credits`;
}

/** A field list, or an em dash. Never an empty string — a blank embed field renders as a bug. */
function listOrDash(values: string[]): string {
  return values.length > 0 ? values.join(', ') : '—';
}

/** Discord truncates silently at 1024 per field value; do it ourselves so the cut is deliberate. */
function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function createNotifier(config: DiscordConfig, log: Logger): Notifier {
  const enabled = Boolean(config.webhookUrl);
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  async function post(embed: Embed, event: string): Promise<void> {
    if (!config.webhookUrl) {
      log.debug('discord alert suppressed — no webhook configured', { event });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ embeds: [{ ...embed, timestamp: new Date().toISOString() }] }),
        signal: controller.signal,
      });

      if (!response.ok) {
        log.warn('discord rejected the alert', { event, status: response.status });
        return;
      }
      log.info('discord alert sent', { event });
    } catch (error) {
      // Swallowed on purpose. See the module comment: the repair already happened.
      log.warn('discord alert could not be delivered', { event, error });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    enabled,

    async restored(alert) {
      const attempts =
        alert.rejections > 0
          ? `${alert.attempts} (${alert.rejections} rejected)`
          : String(alert.attempts);

      await post(
        {
          title: `✅ Pipeline restored — ${alert.collectorName}`,
          color: COLOR.RESTORED,
          fields: [
            { name: 'Fields repaired', value: listOrDash(alert.fieldsRepaired) },
            {
              name: 'Health',
              value: `${alert.fhsBefore.toFixed(2)} → ${alert.fhsAfter?.toFixed(2) ?? '—'}`,
              inline: true,
            },
            { name: 'Attempts', value: attempts, inline: true },
            {
              name: 'Cost',
              value: `${credits(alert.creditsSpent)} · ${seconds(alert.durationMs)}`,
              inline: true,
            },
          ],
        },
        'RESTORED',
      );
    },

    async quarantined(alert) {
      await post(
        {
          title: `🛑 Needs your review — ${alert.collectorName}`,
          description: clamp(alert.reason, 2000),
          color: COLOR.QUARANTINED,
          fields: [
            { name: 'Health when it stopped', value: alert.fhsBefore.toFixed(2), inline: true },
            { name: 'Attempts', value: String(alert.attempts), inline: true },
            {
              name: 'Cost',
              value: `${credits(alert.creditsSpent)} · ${seconds(alert.durationMs)}`,
              inline: true,
            },
          ],
        },
        'QUARANTINED',
      );
    },

    async pendingOperator(alert) {
      // The only actionable alert. Everything needed to decide is in the embed; the link is for
      // when you want to look rather than when you need to.
      const deepLink = `${config.appBaseUrl.replace(/\/$/, '')}/c/${alert.collectorId}?action=repair`;

      const fields: EmbedField[] = [
        {
          name: 'Health',
          value: `${alert.fhsBefore.toFixed(2)} → ${alert.fhsNow.toFixed(2)}`,
          inline: true,
        },
        { name: 'Fields failing', value: listOrDash(alert.failedFields) },
        { name: 'Still healthy', value: listOrDash(alert.healthyFields) },
      ];

      if (alert.proposedFix) {
        fields.push({ name: 'Proposed fix', value: clamp(alert.proposedFix, 300) });
      }

      await post(
        {
          title: '⚠️ Degraded — repair needs your approval',
          description: `${alert.collectorName} · partial breakage detected`,
          color: COLOR.PENDING_OPERATOR,
          url: deepLink,
          fields,
        },
        'PENDING_OPERATOR',
      );
    },
  };
}

/** A notifier that does nothing, for tests and for a worker with no webhook configured. */
export const silentNotifier: Notifier = {
  enabled: false,
  async restored() {},
  async quarantined() {},
  async pendingOperator() {},
};
