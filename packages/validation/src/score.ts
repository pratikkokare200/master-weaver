/**
 * The Field Health Score itself (doc 01 §3.2).
 *
 * Pure and synchronous, as `@weaver/contracts` requires of an {@link FhsScorer}: no I/O, no clock,
 * no network. The same function scores a live run and a canary sample, which is what makes the
 * canary gate meaningful — a proposed fix is judged by exactly the measure that caught the break.
 *
 *   fill_rate(f)   = rows with a non-null, non-empty value / total rows
 *   type_pass(f)   = rows whose value parses as the declared type / non-null rows
 *   field_score(f) = fill_rate(f) × type_pass(f)
 *
 *   FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))     weight = 2 if required else 1
 *
 *   row_penalty    = clamp(row_count / trailing_median_row_count, 0, 1)
 *   golden_penalty = golden_set_match_rate
 *   FHS_final      = FHS × row_penalty × golden_penalty
 */

import { FIELD_WEIGHTS, classifyFhs } from '@weaver/contracts';
import type {
  CollectorContract,
  FieldContract,
  FhsBreakdown,
  FhsScoreOptions,
  FhsScorer,
  FieldScore,
} from '@weaver/contracts';

import { parseBoolean, parseNumber, parseText, parseUrl } from './coerce.js';
import { extractFieldValue, isFilled } from './values.js';

/** Decimal places kept on every reported rate. Enough to be exact, few enough to dodge float noise. */
const PRECISION = 1e6;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** The simplified result shape the worker and the ledger writer consume. */
export interface RunScore {
  /** Final FHS, 0–1. Compare against `FHS_THRESHOLDS` / `classifyFhs`. */
  fhs: number;
  /** `field_score` per contract field name, in contract order. */
  field_scores: Record<string, number>;
  /** Names of fields whose `field_score` fell below their own `min_fill`. */
  failed_fields: string[];
}

/** 2 for required fields, 1 otherwise (doc 01 §3.2). */
export function fieldWeight(field: FieldContract): number {
  return field.required ? FIELD_WEIGHTS.REQUIRED : FIELD_WEIGHTS.OPTIONAL;
}

/**
 * Coerce one already-unwrapped value against one field contract. `null` means it failed the check.
 *
 * A declared `range` is enforced here, as part of `type_pass`, and that is a deliberate reading of
 * the spec rather than a literal one. Doc 01 §3.4 leans on numeric sanity to catch `0`, `null` and
 * `"$"` in a price — and a price of `0` *does* parse as a number, so a pure type check would wave it
 * through. Treating "outside the declared plausible range" as a type failure is what makes `range`
 * do the job the contract declares it for.
 */
export function coerceField(value: unknown, field: FieldContract): string | number | boolean | null {
  switch (field.type) {
    case 'number': {
      const parsed = parseNumber(value);
      if (parsed === null) return null;
      if (field.range !== undefined) {
        const [min, max] = field.range;
        if (parsed < min || parsed > max) return null;
      }
      return parsed;
    }
    case 'boolean':
      return parseBoolean(value);
    case 'url':
      return parseUrl(value, { absolute: field.absolute === true });
    case 'text':
      return parseText(value);
  }
}

/**
 * Score one field across every row.
 *
 * `type_pass` is 1 when no row had a value at all. There is no denominator, so there is nothing to
 * fail — and it changes nothing, because `field_score` is already 0 via `fill_rate`. Reporting it
 * this way keeps the ledger legible: `fill_rate 0.00 / type_pass 1.00` reads as "the field came back
 * empty", which is the actual diagnosis, rather than implying the types were also wrong.
 */
export function evaluateField(rows: readonly unknown[], field: FieldContract): FieldScore {
  const total = rows.length;
  let filled = 0;
  let typed = 0;

  for (const row of rows) {
    const value = extractFieldValue(row, field);
    if (!isFilled(value)) continue;
    filled += 1;
    if (coerceField(value, field) !== null) typed += 1;
  }

  const fillRate = total === 0 ? 0 : filled / total;
  const typePass = filled === 0 ? 1 : typed / filled;
  const fieldScore = round(fillRate * typePass);

  return {
    field: field.name,
    fill_rate: round(fillRate),
    type_pass: round(typePass),
    field_score: fieldScore,
    weight: fieldWeight(field),
    // Compared against `field_score`, not `fill_rate`, per the FieldScore contract in
    // @weaver/contracts. It is the stricter test: a field that is fully populated with garbage
    // fails it, where a fill-rate comparison alone would call that healthy.
    below_min_fill: fieldScore < field.min_fill,
  };
}

/**
 * Full scoring with the run-level penalties — the {@link FhsScorer} implementation.
 *
 * Both penalties default to 1 when their input is absent, which is the correct behaviour on a
 * collector's first run: there is no history to compare a row count against, and skipping the golden
 * penalty is how a canary sample is scored. Absent is *not* the same as zero, and neither is it an
 * excuse: an empty `rows` array scores 0 through `fill_rate`, never "no data, assume fine"
 * (doc 01 §11).
 */
export function scoreFhs(
  rows: readonly unknown[] | null | undefined,
  contract: CollectorContract,
  options: FhsScoreOptions = {},
): FhsBreakdown {
  const safeRows = Array.isArray(rows) ? rows : [];
  const fields = Array.isArray(contract?.fields) ? contract.fields : [];

  const fieldScores = fields.map((field) => evaluateField(safeRows, field));

  let weightedSum = 0;
  let totalWeight = 0;
  for (const score of fieldScores) {
    weightedSum += score.weight * score.field_score;
    totalWeight += score.weight;
  }

  // A contract with no fields asserts nothing, so a run against it has demonstrated nothing. 0, not
  // a vacuous 1 — the schema forbids this shape anyway, and guessing "healthy" here is how a broken
  // collector would sail past the gate.
  const fhsRaw = totalWeight === 0 ? 0 : weightedSum / totalWeight;

  const median = options.trailingMedianRowCount;
  const rowPenalty =
    median === null || median === undefined || median <= 0
      ? 1
      : clamp01(safeRows.length / median);

  const matchRate = options.goldenSetMatchRate;
  const goldenPenalty = matchRate === null || matchRate === undefined ? 1 : clamp01(matchRate);

  const fhs = round(clamp01(fhsRaw * rowPenalty * goldenPenalty));

  return {
    fhs,
    fhs_raw: round(fhsRaw),
    row_penalty: round(rowPenalty),
    golden_penalty: round(goldenPenalty),
    field_scores: fieldScores,
    row_count: safeRows.length,
    trailing_median_row_count: median ?? null,
    failed_fields: fieldScores.filter((s) => s.below_min_fill).map((s) => s.field),
    band: classifyFhs(fhs),
  };
}

/**
 * Score a run against its contract.
 *
 * The primary entry point. No penalties are applied — with no run history and no golden-set result
 * passed in, both are 1 — so `fhs` here is the weighted field score. Use {@link scoreFhs} when you
 * hold the trailing median row count or a golden-set match rate and want the final number.
 */
export function scoreRun(rows: readonly unknown[] | null | undefined, contract: CollectorContract): RunScore {
  const breakdown = scoreFhs(rows, contract);

  const fieldScores: Record<string, number> = {};
  for (const score of breakdown.field_scores) fieldScores[score.field] = score.field_score;

  return {
    fhs: breakdown.fhs,
    field_scores: fieldScores,
    failed_fields: breakdown.failed_fields,
  };
}

/**
 * Score a canary sample — the same measure with the golden penalty skipped.
 *
 * A canary is a preview of a proposed fix, not a run against the pinned URLs, so there is no
 * golden-set result to fold in. An empty or malformed sample falls through to FHS 0 and is rejected
 * by the gate, which is the required behaviour (doc 01 §11) and the reason this does not special-case
 * a short sample into a pass.
 */
export function scoreCanary(
  rows: readonly unknown[] | null | undefined,
  contract: CollectorContract,
): FhsBreakdown {
  return scoreFhs(rows, contract, { trailingMedianRowCount: null, goldenSetMatchRate: null });
}

/** The {@link FhsScorer} `@weaver/contracts` declares and this package implements. */
export const fhsScorer: FhsScorer = { score: scoreFhs };
