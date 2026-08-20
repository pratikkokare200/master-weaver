/**
 * The circuit breaker — doc 01 §9.
 *
 * "An autonomous heal loop is a runaway-spend machine. These rails are not optional."
 *
 * Every rail is checked here, in one pure function, against counts the caller has already read from
 * the ledger. Nothing in this file does I/O: a breaker that needs a database to answer "may I heal?"
 * cannot be exhaustively tested, and this is the last component in the system that should be
 * difficult to test.
 *
 * The rails are asymmetric on purpose. Refusing to heal costs a webhook and a human's attention.
 * Healing when we should not costs credits, mutates a working collector in place, and — because
 * `heal` preserves the collector id and exposes no version history (doc 01 §8) — cannot be undone.
 * So every ambiguous case here resolves to "stop".
 */

import { BREAKER_LIMITS } from '@weaver/contracts';

/** Which rail refused. Written to `healing_episodes` so the ledger says *why* it stopped. */
export const BREAKER_RAILS = [
  'KILL_SWITCH',
  'HEAL_ATTEMPTS_24H',
  'EPISODE_REJECTIONS',
  'EPISODE_CREDITS',
  'ACCOUNT_CREDIT_FLOOR',
] as const;
export type BreakerRail = (typeof BREAKER_RAILS)[number];

/** Tunable ceilings. Defaults come from `@weaver/contracts`, so tuning stays a one-file edit. */
export interface BreakerLimits {
  /** Heal attempts per collector in a rolling 24 hours. */
  healAttemptsPer24h: number;
  /** Rejections within one episode before it is abandoned. */
  rejectionsPerEpisode: number;
  /** Soft cap on credits for a single episode. `null` disables the rail. */
  creditsPerEpisode: number | null;
  /** Halt all autonomous healing below this account balance. `null` disables the rail. */
  accountCreditFloor: number | null;
}

export const DEFAULT_BREAKER_LIMITS: BreakerLimits = {
  healAttemptsPer24h: BREAKER_LIMITS.HEAL_ATTEMPTS_PER_24H,
  rejectionsPerEpisode: BREAKER_LIMITS.REJECTIONS_PER_EPISODE,
  // Deliberately null until a heal has been measured. A guessed ceiling either never fires or fires
  // on the first real repair, and both are worse than an honest "not yet measured".
  creditsPerEpisode: null,
  /**
   * 10 credits. The account carried 55 on 2026-08-20, and a floor exists so an autonomous loop
   * cannot spend the last of it unattended overnight. Runs still execute below the floor — only
   * healing stops, because a scraper that cannot repair itself is still worth the data it collects.
   */
  accountCreditFloor: 10,
};

/** What the breaker needs to know. Every number is read from the ledger or the budget by the caller. */
export interface BreakerInput {
  /** `HEALING_DISABLED` or equivalent env flag. The worker still runs scrapes; it just will not heal. */
  killSwitchEnabled?: boolean;
  /** Heal attempts already made against THIS collector in the last 24 hours. */
  healAttemptsLast24h: number;
  /** Rejections already recorded in the CURRENT episode. 0 when opening a new one. */
  rejectionsThisEpisode?: number;
  /** Credits already spent in the current episode. */
  creditsSpentThisEpisode?: number;
  /** Account balance from `brightdata budget`. `null` when it could not be read. */
  accountBalance?: number | null;
}

export type BreakerVerdict =
  | { allowed: true }
  | { allowed: false; rail: BreakerRail; reason: string };

/**
 * May we make a heal call right now?
 *
 * Checked before EVERY heal, not once per episode: a refinement attempt after a rejection is another
 * heal, costs credits again, and must clear the same rails the first one did.
 *
 * Rails are evaluated cheapest-and-most-absolute first, so the reason written to the ledger is the
 * most fundamental one rather than whichever happened to be tested first.
 */
export function checkBreaker(
  input: BreakerInput,
  limits: BreakerLimits = DEFAULT_BREAKER_LIMITS,
): BreakerVerdict {
  if (input.killSwitchEnabled === true) {
    return {
      allowed: false,
      rail: 'KILL_SWITCH',
      reason: 'healing is disabled by the global kill switch; runs still execute',
    };
  }

  // Read before the count rails: an account that cannot pay fails every attempt anyway, and burning
  // a collector's 24h attempt budget discovering that is exactly the waste the breaker exists to stop.
  if (limits.accountCreditFloor !== null && input.accountBalance !== null && input.accountBalance !== undefined) {
    if (input.accountBalance < limits.accountCreditFloor) {
      return {
        allowed: false,
        rail: 'ACCOUNT_CREDIT_FLOOR',
        reason:
          `account balance ${input.accountBalance} is below the ${limits.accountCreditFloor}-credit ` +
          'floor for autonomous healing',
      };
    }
  }

  if (input.healAttemptsLast24h >= limits.healAttemptsPer24h) {
    return {
      allowed: false,
      rail: 'HEAL_ATTEMPTS_24H',
      reason:
        `this collector has already been healed ${input.healAttemptsLast24h} times in 24 hours ` +
        `(limit ${limits.healAttemptsPer24h})`,
    };
  }

  const rejections = input.rejectionsThisEpisode ?? 0;
  if (rejections >= limits.rejectionsPerEpisode) {
    return {
      allowed: false,
      rail: 'EPISODE_REJECTIONS',
      reason:
        `${rejections} proposed fixes have already been rejected in this episode ` +
        `(limit ${limits.rejectionsPerEpisode}); further attempts are diminishing returns`,
    };
  }

  const spent = input.creditsSpentThisEpisode ?? 0;
  if (limits.creditsPerEpisode !== null && spent >= limits.creditsPerEpisode) {
    return {
      allowed: false,
      rail: 'EPISODE_CREDITS',
      reason: `this episode has spent ${spent} credits (soft cap ${limits.creditsPerEpisode})`,
    };
  }

  return { allowed: true };
}

/**
 * Backoff before retrying a suspected-transient failure — doc 01 §4.3: "2 transient retries at 1m
 * and 5m."
 *
 * `attempt` is 1-based and counts the retry, not the original run. Anything past the configured
 * budget returns the last delay rather than throwing; the caller's own attempt ceiling is what stops
 * the loop, and a breaker that throws inside an error path is a breaker that makes outages worse.
 */
export const TRANSIENT_BACKOFF_MS: readonly number[] = [60_000, 300_000];

export function transientBackoffMs(attempt: number): number {
  const index = Math.max(1, Math.floor(attempt)) - 1;
  return TRANSIENT_BACKOFF_MS[Math.min(index, TRANSIENT_BACKOFF_MS.length - 1)] ?? 60_000;
}

/** Whether another transient retry is permitted (doc 01 §9: 2 per run). */
export function mayRetryTransient(
  attemptsSoFar: number,
  limit: number = BREAKER_LIMITS.TRANSIENT_RETRIES,
): boolean {
  return attemptsSoFar < limit;
}
