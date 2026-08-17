/**
 * Every magic number in the product, in one place.
 *
 * Doc 01 §3.2: "They are the single most important set of magic numbers in the product; write them
 * in one config object, not scattered through the code." Day 3 tunes these against the Chaos Lab —
 * tuning must mean editing this file and nothing else.
 */

/**
 * Field Health Score bands (doc 01 §3.2).
 *
 * Note the shape of the decision: healing triggers *below HEALTHY*, not below DEGRADED. 0.60 is the
 * severity split that decides who authorises the repair, not whether one happens. (Correction #1 in
 * doc 03 §8 — the demo's own break scores 0.80 and would never have healed under the old reading.)
 */
export const FHS_THRESHOLDS = {
  /** FHS ≥ 0.95 → HEALTHY. Below this, something is wrong and the engine reacts. */
  HEALTHY: 0.95,
  /** 0.60 ≤ FHS < 0.95 → DEGRADED (operator decides). FHS < 0.60 → BROKEN (autonomous). */
  DEGRADED: 0.6,
  /**
   * A proposed fix's canary sample must score ≥ 0.90 to be approved.
   *
   * This is the gate the whole product is built around: far above the band that triggered the
   * heal, and strict enough that a plausible-but-wrong repair is rejected rather than committed.
   * Do NOT raise this for small golden sets — that would make small collectors harder to repair
   * than large ones, which is backwards (doc 01 §3.4).
   */
  CANARY_GATE: 0.9,
} as const;

/**
 * Golden set size is `min(GOLDEN_SET_MAX, available_urls)` — architect decision 4, amended
 * 2026-08-13 from "exactly 3".
 *
 * Collector creation NEVER fails for having too few URLs. A judge pasting one product URL is the
 * likeliest first interaction with the product, and failing that with a validation error is a
 * terrible opening (doc 01 §3.4).
 */
export const GOLDEN_SET_MAX = 3;

/** Circuit breaker — doc 01 §5. Tripping any of these means QUARANTINED + webhook, not a retry. */
export const BREAKER_LIMITS = {
  /** Heal attempts per collector, rolling 24h. */
  HEAL_ATTEMPTS_PER_24H: 3,
  /** Rejections within a single episode. Two refinement attempts, then stop — past that it is
   *  diminishing returns and every attempt costs credits. */
  REJECTIONS_PER_EPISODE: 2,
  /** Run retries before a suspected-transient failure is classified for real (doc 01 §2.2). */
  TRANSIENT_RETRIES: 2,
} as const;

/** Hard input limits enforced by the Bright Data CLI itself — verified against @brightdata/cli 0.3.4. */
export const CLI_INPUT_LIMITS = {
  /** `scraper heal <id> <prompt>` — prompt max 1000 chars. */
  DIAGNOSIS_CHARS: 1000,
  /** `scraper create <url> <description>` — description max 500 chars. */
  INTENT_CHARS: 500,
} as const;

/** FHS weighting — required fields count double (doc 01 §3.2). */
export const FIELD_WEIGHTS = {
  REQUIRED: 2,
  OPTIONAL: 1,
} as const;

/**
 * Golden-set assertion tolerances (doc 01 §3.4). You cannot assert exact values — prices change
 * hourly, and that is the entire point of the product.
 */
export const GOLDEN_TOLERANCES = {
  /**
   * `price` must land within ±35% of the recorded baseline. Catches `0`, `null`, `"$"` and the
   * classic "scraped the shipping cost instead" failure without false-alarming on a real sale.
   */
  PRICE: 0.35,
} as const;

export type FhsBand = 'HEALTHY' | 'DEGRADED' | 'BROKEN';

/** Map a final FHS to its severity band. The band determines who authorises a repair. */
export function classifyFhs(fhs: number): FhsBand {
  if (fhs >= FHS_THRESHOLDS.HEALTHY) return 'HEALTHY';
  if (fhs >= FHS_THRESHOLDS.DEGRADED) return 'DEGRADED';
  return 'BROKEN';
}

/**
 * Whether a band repairs itself unattended.
 *
 * BROKEN (< 0.60) is a catastrophic layout failure the system fixes on its own. DEGRADED
 * (0.60–0.95) halts at PENDING_OPERATOR and waits for a click. There is no per-workspace toggle —
 * the tiering *is* the product statement (architect decision 3).
 */
export function isAutonomousBand(band: FhsBand): boolean {
  return band === 'BROKEN';
}

/** Whether a canary sample's score clears the approval gate. */
export function clearsCanaryGate(canaryFhs: number): boolean {
  return canaryFhs >= FHS_THRESHOLDS.CANARY_GATE;
}
