/**
 * Database row types — the ledger.
 *
 * Schema: doc 03 §4, doc 01 §10. Field names are `snake_case` to match the Postgres columns exactly,
 * so a Supabase row can be assigned to these types without a mapping layer.
 *
 * Ledger integrity rule (doc 03 §4): every state transition writes its row *before* the next CLI
 * call is made, so an episode interrupted by a crash is still auditable up to the point of failure.
 */

import type { CollectorContract, GoldenSetShape, ScrapedRow } from './contract.js';
import type { FieldScore } from './fhs.js';
import type { RunState } from './states.js';

/** ISO-8601 timestamp string, as returned by Supabase (`timestamptz`). */
export type Iso8601 = string;

/** Anything storable in a JSONB column. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// ---------------------------------------------------------------------------------------------
// collectors
// ---------------------------------------------------------------------------------------------

/**
 * ASSUMPTION — not enumerated in doc 01/03. Lifecycle of the collector itself, distinct from the
 * run state of its latest run. Confirm before the Day 2 freeze.
 */
export const COLLECTOR_STATUSES = ['CREATING', 'ACTIVE', 'PAUSED', 'QUARANTINED', 'FAILED'] as const;
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number];

export interface Collector {
  id: string;
  workspace_id: string;
  /** Bright Data's collector id (`c_…`), returned by `scraper create`. Not our primary key. */
  collector_id: string;
  name: string;
  target_url: string;
  /** The user's original sentence — what the contract was inferred from. */
  intent_prompt: string;
  /** JSONB. Validated with `CollectorContractSchema` on read; LLM output is untrusted. */
  contract: CollectorContract;
  status: CollectorStatus;
  created_at: Iso8601;
}

// ---------------------------------------------------------------------------------------------
// golden_baselines
// ---------------------------------------------------------------------------------------------

/**
 * The regression test. Without it, `RESTORED` is an unverified claim.
 *
 * Refreshed ONLY on a HEALTHY run — never post-heal until the episode reaches RESTORED, or a bad
 * fix would rewrite the very baseline meant to catch it (doc 01 §3.4).
 */
export interface GoldenBaseline {
  id: string;
  collector_id: string;
  /** The pinned URL this baseline was captured from. */
  url: string;
  /**
   * JSONB. For `detail` shape: one scraped row. For `listing` shape: a row-set summary —
   * row count, field shape across rows, and the first N rows by a stable key.
   */
  baseline_row: ScrapedRow | ListingBaselineSummary;
  shape: GoldenSetShape;
  captured_at: Iso8601;
}

/** `listing`-shape baseline payload — a summary of the row set, not an individual product. */
export interface ListingBaselineSummary {
  row_count: number;
  /** Field names present across the row set, used to detect a shape change. */
  field_shape: string[];
  /** First N rows by a stable key, for spot comparison. */
  sample_rows: ScrapedRow[];
  /** The stable key the sample was ordered by, e.g. `product_url`. */
  stable_key: string;
}

// ---------------------------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------------------------

export const JOB_KINDS = ['manual', 'scheduled', 'confirmation'] as const;
/** `confirmation` is the post-approval golden-set run that decides RESTORED vs QUARANTINED. */
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * ASSUMPTION — not enumerated in doc 01/03. Queue semantics only; claimed with
 * `FOR UPDATE SKIP LOCKED`. Confirm before the Day 2 freeze.
 */
export const JOB_STATES = ['PENDING', 'CLAIMED', 'DONE', 'FAILED'] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface Job {
  id: string;
  collector_id: string;
  kind: JobKind;
  state: JobState;
  /** Incremented on each claim; drives retry/abandon decisions. */
  attempts: number;
  scheduled_for: Iso8601;
  claimed_at: Iso8601 | null;
  /** Worker instance id holding the claim. */
  claimed_by: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------------------------

export interface Run {
  id: string;
  collector_id: string;
  /** Null for runs not driven by the queue (e.g. an inline first run at creation). */
  job_id: string | null;
  started_at: Iso8601;
  finished_at: Iso8601 | null;
  /** JSONB — the rows as returned by the CLI. */
  rows: ScrapedRow[];
  row_count: number;
  /** Final, penalty-adjusted FHS. Null while the run is still in flight. */
  fhs: number | null;
  /** JSONB — per-field detail behind `fhs`. */
  field_scores: FieldScore[] | null;
  run_state: RunState;
  credits_spent: number | null;
}

// ---------------------------------------------------------------------------------------------
// healing_episodes
// ---------------------------------------------------------------------------------------------

export const EPISODE_FINAL_STATES = ['RESTORED', 'QUARANTINED', 'DISMISSED'] as const;
/** `DISMISSED` is the PENDING_OPERATOR → IDLE path: the operator declined the repair. */
export type EpisodeFinalState = (typeof EPISODE_FINAL_STATES)[number];

export const EPISODE_TRIGGER_REASONS = ['DEGRADED', 'BROKEN'] as const;
export type EpisodeTriggerReason = (typeof EPISODE_TRIGGER_REASONS)[number];

export const EPISODE_AUTHORISERS = ['AUTONOMOUS', 'OPERATOR'] as const;
/** BROKEN → AUTONOMOUS · DEGRADED → OPERATOR. Severity gates autonomy; there is no toggle. */
export type EpisodeAuthorisedBy = (typeof EPISODE_AUTHORISERS)[number];

/**
 * A point-in-time capture of what the collector was producing — the before/after diff the ledger
 * timeline expands into (doc 01 §10).
 */
export interface EpisodeSnapshot {
  rows: ScrapedRow[];
  row_count: number;
  fhs: number;
  captured_at: Iso8601;
}

export interface HealingEpisode {
  id: string;
  collector_id: string;
  workspace_id: string;
  triggered_at: Iso8601;
  /** Null while the episode is still running. */
  resolved_at: Iso8601 | null;
  final_state: EpisodeFinalState | null;
  trigger_reason: EpisodeTriggerReason;
  authorised_by: EpisodeAuthorisedBy;
  /** Both null on the autonomous path — nobody was asked. */
  operator_prompted_at: Iso8601 | null;
  operator_acted_at: Iso8601 | null;
  /** The score that opened the episode. */
  fhs_before: number;
  /** The score after the golden-set confirmation run. Null unless the episode reached RESTORED. */
  fhs_after: number | null;
  /** JSONB — contract fields that fell below `min_fill`, i.e. what the diagnosis was written about. */
  failed_fields: string[];
  /** JSONB — what the collector produced when it broke. */
  snapshot_before: EpisodeSnapshot | null;
  /** JSONB — what it produced after the repair was committed and confirmed. */
  snapshot_after: EpisodeSnapshot | null;
  credits_spent: number | null;
  duration_ms: number | null;
  /** Number of `healing_attempts` rows — the "attempt 2 of 3" counter. */
  attempt_count: number;
}

// ---------------------------------------------------------------------------------------------
// healing_attempts
// ---------------------------------------------------------------------------------------------

export const ATTEMPT_DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type AttemptDecision = (typeof ATTEMPT_DECISIONS)[number];

/**
 * One row per heal attempt.
 *
 * Not optional, and not merge-able into `healing_episodes`: a single episode row can only ever
 * record a success. The "attempt 1 rejected, attempt 2 approved" ledger entry — doc 04 Beat 5e's
 * strongest ten seconds — does not exist without this table (doc 03 §4).
 */
export interface HealingAttempt {
  id: string;
  episode_id: string;
  /** 1-based. */
  attempt_no: number;
  /** The exact ≤1000-char diagnosis sent to `scraper heal`, verbatim. */
  description_sent: string;
  /** JSONB — the `preview_result` the CLI returned at the approval gate. */
  canary_sample: ScrapedRow[] | null;
  /**
   * The canary's score against the same contract that caught the break — the number that justified
   * the decision. Null only if the heal call itself errored before returning a sample.
   *
   * NOTE: the brief calls this `canary_score`; doc 01 §10 and doc 03 §4 both name the column
   * `canary_fhs`. Following the schema docs — flagged for confirmation before the Day 2 freeze.
   */
  canary_fhs: number | null;
  /** Null while the attempt is still at the gate. */
  decision: AttemptDecision | null;
  /** Why a canary was rejected — human-readable, shown in the ledger. */
  rejection_reason: string | null;
  /** The exact argv, with the API key redacted. Reproducibility is the point. */
  cli_argv_redacted: string;
  stderr_excerpt: string | null;
  created_at: Iso8601;
}
