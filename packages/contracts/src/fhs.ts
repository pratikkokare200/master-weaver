/**
 * Field Health Score — the number every decision in the product depends on.
 *
 * This module defines the *interface and result shape only*. The implementation lives in
 * `@weaver/validation` (owned by Flash). Do not reimplement the scorer here, and do not import a
 * scorer into contracts — this package must stay dependency-light and frozen.
 *
 * Formula (doc 01 §3.2):
 *
 *   fill_rate(f)   = rows with a non-null, non-empty value / total rows
 *   type_pass(f)   = rows whose value parses as the declared type / non-null rows
 *   field_score(f) = fill_rate(f) × type_pass(f)
 *
 *   FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))      weight = 2 if required else 1
 *
 *   row_penalty    = clamp(row_count / trailing_median_row_count, 0, 1)
 *   golden_penalty = golden_set_match_rate
 *   FHS_final      = FHS × row_penalty × golden_penalty
 */

import type { CollectorContract, ScrapedRow } from './contract.js';
import type { FhsBand } from './thresholds.js';

/** Per-field scoring detail. Persisted to `runs.field_scores` and rendered in the ledger. */
export interface FieldScore {
  /** Contract field name. */
  field: string;
  /** Non-null, non-empty values / total rows. 0–1. */
  fill_rate: number;
  /** Values parsing as the declared type / non-null values. 0–1. */
  type_pass: number;
  /** `fill_rate × type_pass`. 0–1. */
  field_score: number;
  /** 2 for required fields, 1 otherwise. */
  weight: number;
  /** Whether `field_score` fell below the field's own `min_fill`. */
  below_min_fill: boolean;
}

/**
 * A complete scoring result. `fhs` is the final, penalty-adjusted number — the one compared against
 * {@link FHS_THRESHOLDS}. `fhs_raw` is kept so the ledger can show *why* a run scored low.
 */
export interface FhsBreakdown {
  /** Penalty-adjusted final score, 0–1. This is the number that drives state. */
  fhs: number;
  /** Weighted field score before run-level penalties, 0–1. */
  fhs_raw: number;
  /** `clamp(row_count / trailing_median_row_count, 0, 1)`. */
  row_penalty: number;
  /** `golden_set_match_rate` — passing pinned URLs / total pinned URLs. */
  golden_penalty: number;
  field_scores: FieldScore[];
  row_count: number;
  /** Null on a collector's first run, when there is no history to compare against. */
  trailing_median_row_count: number | null;
  /** Fields whose score fell below their `min_fill` — the "what broke" list in the diagnosis. */
  failed_fields: string[];
  band: FhsBand;
}

/** Inputs the scorer needs beyond the rows themselves. */
export interface FhsScoreOptions {
  /** Trailing median row count from run history. Omit on a first run to skip the row penalty. */
  trailingMedianRowCount?: number | null;
  /** Golden-set match rate, 0–1. Omit to skip the golden penalty (e.g. when scoring a canary). */
  goldenSetMatchRate?: number | null;
}

/**
 * The contract `@weaver/validation` implements. Pure and synchronous — scoring must never do I/O,
 * so the same function scores a live run and a canary sample identically.
 */
export interface FhsScorer {
  score(rows: ScrapedRow[], contract: CollectorContract, options?: FhsScoreOptions): FhsBreakdown;
}

/**
 * Scoring a canary sample is the *same* function with the golden penalty skipped — the canary is a
 * preview of a proposed fix, not a run against pinned URLs. Doc 01 §11: an empty or malformed
 * canary sample is treated as FHS 0 and rejected, never as "no data, assume fine".
 */
export const EMPTY_CANARY_FHS = 0;
