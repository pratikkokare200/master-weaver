/**
 * The validation contract — Zod schemas for the per-collector field contract.
 *
 * Spec: doc 01 §3.1. A contract is declared per collector, once, at creation time, inferred by the
 * LLM from the user's intent. It is the thing that catches breakage, so it is validated at the
 * boundary (LLM output is untrusted) rather than trusted as a plain object.
 */

import { z } from 'zod';
import { GOLDEN_SET_MAX } from './thresholds.js';

/** A single scraped cell. The CLI returns nested objects for some fields — see {@link ScrapedRow}. */
export type ScrapedValue = unknown;

/**
 * One row as returned by `brightdata scraper run`.
 *
 * Note for the scorer (`@weaver/validation`): values are NOT always scalars. Verified against real
 * CLI output, `price` comes back as `{ value: 1299, currency: "USD", symbol: "$" }`, and every row
 * carries an `input: { url }` echo. A `number` field contract on `price` must read `price.value`.
 */
export type ScrapedRow = Record<string, ScrapedValue>;

export const ScrapedRowSchema = z.record(z.string(), z.unknown());

/** Declared type of a contract field — what `type_pass` checks each value against. */
export const FIELD_TYPES = ['text', 'number', 'boolean', 'url'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FieldTypeSchema = z.enum(FIELD_TYPES);

/**
 * Collector shape — decides what the golden set can assert (doc 01 §3.4).
 *
 * `detail`  — N product URLs, one row each; the baseline asserts per-row field values.
 * `listing` — one category URL yielding many rows; the baseline asserts the row *set* (count within
 *             tolerance, field shape across rows, first N rows by a stable key).
 *
 * Both feed `golden_set_match_rate` identically; only what counts as "passing" differs.
 */
export const GOLDEN_SET_SHAPES = ['detail', 'listing'] as const;
export type GoldenSetShape = (typeof GOLDEN_SET_SHAPES)[number];
export const GoldenSetShapeSchema = z.enum(GOLDEN_SET_SHAPES);

/**
 * One field's contract.
 *
 * `min_fill` is the load-bearing part. A null check on the first row misses the failure mode that
 * actually happens — a redesign moves one field and price silently returns empty on 70% of rows
 * while 12 of 14 fields still work. Partial breakage is the common case (doc 01 §3.3).
 */
export const FieldContractSchema = z.object({
  /** Key in the scraped row, e.g. `product_name`. */
  name: z.string().min(1),
  type: FieldTypeSchema,
  /** Required fields are weighted double in the FHS (doc 01 §3.2). */
  required: z.boolean(),
  /** Minimum acceptable fill rate, 0–1. */
  min_fill: z.number().min(0).max(1),
  /** `number` fields only — inclusive `[min, max]` sanity bounds. */
  range: z.tuple([z.number(), z.number()]).optional(),
  /** Permitted drift vs. the trailing baseline, 0–1 (e.g. 0.40 = ±40%). */
  drift_tolerance: z.number().min(0).max(1).optional(),
  /** `url` fields only — require an absolute URL rather than a site-relative path. */
  absolute: z.boolean().optional(),
});

export type FieldContract = z.infer<typeof FieldContractSchema>;

/** Row-count expectations for the collector as a whole. */
export const RowCountRuleSchema = z.object({
  /** Fewer rows than this is a failure regardless of field scores. */
  min: z.number().int().min(0),
  /** Permitted drift vs. the trailing median row count, 0–1. */
  drift_tolerance: z.number().min(0).max(1),
});

export type RowCountRule = z.infer<typeof RowCountRuleSchema>;

/**
 * The full per-collector contract.
 *
 * `golden_set` is capped at {@link GOLDEN_SET_MAX} but has a floor of 1, deliberately: creation
 * never fails for having too few URLs (doc 01 §3.4).
 */
export const CollectorContractSchema = z.object({
  /** Bright Data collector id, e.g. `c_mswyapbp22wiwv8fhh`. */
  collector_id: z.string().min(1),
  fields: z.array(FieldContractSchema).min(1),
  row_count: RowCountRuleSchema,
  golden_set: z.array(z.url()).min(1).max(GOLDEN_SET_MAX),
  golden_set_shape: GoldenSetShapeSchema,
});

export type CollectorContract = z.infer<typeof CollectorContractSchema>;

/**
 * Parse an LLM-inferred contract, throwing on invalid input.
 *
 * Use at the trust boundary — inferred contracts come out of a language model, not out of a form.
 */
export function parseCollectorContract(input: unknown): CollectorContract {
  return CollectorContractSchema.parse(input);
}

/** Non-throwing variant, for paths that want to record the failure rather than crash the worker. */
export function safeParseCollectorContract(input: unknown) {
  return CollectorContractSchema.safeParse(input);
}

/** The golden set actually used for a collector: `min(GOLDEN_SET_MAX, available)`. */
export function goldenSetSize(availableUrls: number): number {
  return Math.max(0, Math.min(GOLDEN_SET_MAX, availableUrls));
}

/**
 * A golden set of 1 is a weaker regression test than one of 3.
 *
 * Surface this in the UI so the confidence level is visible — but do NOT compensate by raising the
 * canary threshold (doc 01 §3.4).
 */
export function isWeakGoldenSet(contract: CollectorContract): boolean {
  return contract.golden_set_shape === 'detail' && contract.golden_set.length < GOLDEN_SET_MAX;
}

export function requiredFields(contract: CollectorContract): FieldContract[] {
  return contract.fields.filter((f) => f.required);
}
