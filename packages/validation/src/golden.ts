/**
 * Golden baselines — the regression test behind every `RESTORED` verdict (doc 01 §3.4).
 *
 * Without this module `golden_set_match_rate` has no producer, `golden_penalty` is permanently 1,
 * and `RESTORED` is a claim rather than a result. That was audit finding F2 of doc 03 §8 and
 * finding F4 of the Day-3 audit: the table and the types existed, the logic did not.
 *
 * **What a baseline can and cannot assert.** Not exact values — prices change hourly and that is
 * the entire point of the product. So:
 *
 *   - identity fields (`product_name`, `sku`, `product_url`) must match exactly
 *   - every other contract field must be present and parse as its declared type
 *   - numeric fields must land within tolerance of the recorded value — ±35% for price by default,
 *     which catches `0`, `null`, `"$"` and the classic "scraped the shipping cost instead" without
 *     false-alarming on a real sale
 *
 * **Two shapes, two semantics, one match rate.** A detail collector pins N product URLs and asserts
 * per-row values. A listing collector has one URL yielding many rows and cannot assert three
 * individual products, so it asserts the row *set*: count within tolerance, the same field shape
 * across rows, and the first N rows by a stable key. Both feed `golden_set_match_rate` identically.
 *
 * **Everything here is per-URL and takes a set.** {@link evaluateGoldenSet} is written against N
 * pinned URLs, not one, so a collector that grows from one URL to three changes its data and not
 * its code path.
 */

import { GOLDEN_TOLERANCES } from '@weaver/contracts';
import type {
  CollectorContract,
  FieldContract,
  GoldenSetShape,
  ListingBaselineSummary,
  ScrapedRow,
} from '@weaver/contracts';

import { coerceField } from './score.js';
import { dedupeRows, rowIdentity } from './dedupe.js';
import { extractFieldValue, isFilled } from './values.js';

/**
 * Fields asserted by exact string equality rather than by presence and type.
 *
 * These are the row's identity. If the name changed, we are not looking at the same product, and no
 * amount of correct typing elsewhere makes the run a pass. `product_page_url` is the spelling the
 * live collector uses for `product_url`.
 */
export const EXACT_MATCH_FIELDS: ReadonlySet<string> = new Set([
  'product_name',
  'sku',
  'product_url',
  'product_page_url',
]);

/** How many rows a listing baseline pins by stable key. Enough to spot a reshuffle, few enough to stay cheap. */
export const LISTING_SAMPLE_SIZE = 3;

/** One assertion made against a baseline, kept whether it passed or failed so the ledger can show the work. */
export interface GoldenCheck {
  /** Field name, or a row-set aspect such as `row_count` / `field_shape`. */
  aspect: string;
  ok: boolean;
  /** Present only on failure. Plain English — this text reaches the diagnosis builder. */
  reason?: string;
}

/** The verdict for one pinned URL. */
export interface GoldenUrlResult {
  url: string;
  passed: boolean;
  checks: GoldenCheck[];
  /** `aspect` of every failed check, for the episode's `failed_fields`. */
  failures: string[];
}

/** The verdict across the whole pinned set. */
export interface GoldenSetResult {
  /** `golden_set_match_rate` — passing pinned URLs / total pinned URLs. Feeds `golden_penalty`. */
  match_rate: number;
  /** Every URL's result, in the order the pinned set declares them. */
  results: GoldenUrlResult[];
  passed_urls: number;
  total_urls: number;
}

// -------------------------------------------------------------------------------------------
// Capture
// -------------------------------------------------------------------------------------------

/** The field names present across a row set, sorted, excluding the CLI's request echo. */
function fieldShapeOf(rows: readonly unknown[]): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (key !== 'input') names.add(key);
    }
  }
  return [...names].sort();
}

/**
 * Capture a `listing` baseline: the row-set summary.
 *
 * Rows are de-duplicated before the count is taken. A baseline that recorded 144 where the page
 * holds 12 would pin the duplication in place as the expected shape, and a later run that stopped
 * duplicating — a genuine improvement — would fail its own regression test.
 *
 * `sample_rows` is ordered by {@link rowIdentity} rather than by page order so that a page which
 * reorders its products without changing them still matches.
 */
export function captureListingBaseline(
  rows: readonly unknown[] | null | undefined,
  contract: CollectorContract,
): ListingBaselineSummary {
  const distinct = dedupeRows(rows);
  const sorted = [...distinct].sort((a, b) =>
    rowIdentity(a, contract).localeCompare(rowIdentity(b, contract)),
  );

  return {
    row_count: distinct.length,
    field_shape: fieldShapeOf(distinct),
    sample_rows: sorted.slice(0, LISTING_SAMPLE_SIZE) as ScrapedRow[],
    stable_key: identityFieldNames(contract).join('+') || 'row_content',
  };
}

/** Capture a `detail` baseline: the single row this URL produced. */
export function captureDetailBaseline(
  rows: readonly unknown[] | null | undefined,
  _contract: CollectorContract,
): ScrapedRow | null {
  const distinct = dedupeRows(rows);
  return (distinct[0] as ScrapedRow | undefined) ?? null;
}

/** Capture whichever baseline the contract's shape calls for. */
export function captureBaseline(
  rows: readonly unknown[] | null | undefined,
  contract: CollectorContract,
): ScrapedRow | ListingBaselineSummary | null {
  return contract.golden_set_shape === 'listing'
    ? captureListingBaseline(rows, contract)
    : captureDetailBaseline(rows, contract);
}

function identityFieldNames(contract: CollectorContract): string[] {
  return (contract?.fields ?? [])
    .filter((f) => f.required && (f.type === 'text' || f.type === 'url'))
    .map((f) => f.name);
}

// -------------------------------------------------------------------------------------------
// Compare
// -------------------------------------------------------------------------------------------

/** The drift a numeric field is allowed against its baseline value. */
function toleranceFor(field: FieldContract): number {
  return field.drift_tolerance ?? GOLDEN_TOLERANCES.PRICE;
}

/** Compare one field of one row against the same field of the baseline row. */
function checkField(
  current: unknown,
  baseline: unknown,
  field: FieldContract,
): GoldenCheck {
  const currentValue = extractFieldValue(current, field);
  const baselineValue = extractFieldValue(baseline, field);

  if (!isFilled(currentValue)) {
    return {
      aspect: field.name,
      ok: false,
      reason: `${field.name} is empty — the baseline recorded ${JSON.stringify(baselineValue) ?? 'a value'}`,
    };
  }

  const coerced = coerceField(currentValue, field);
  if (coerced === null) {
    return {
      aspect: field.name,
      ok: false,
      reason: `${field.name} returned ${JSON.stringify(currentValue)}, which does not parse as ${field.type}`,
    };
  }

  // Identity: exact equality, compared as the coerced scalar so "  Name " and "Name" agree.
  if (EXACT_MATCH_FIELDS.has(field.name)) {
    const baselineCoerced = isFilled(baselineValue) ? coerceField(baselineValue, field) : null;
    if (baselineCoerced !== null && coerced !== baselineCoerced) {
      return {
        aspect: field.name,
        ok: false,
        reason: `${field.name} is now ${JSON.stringify(coerced)}, was ${JSON.stringify(baselineCoerced)}`,
      };
    }
    return { aspect: field.name, ok: true };
  }

  // Numbers: within tolerance of the recorded value.
  if (field.type === 'number' && typeof coerced === 'number') {
    const baselineNumber = isFilled(baselineValue) ? coerceField(baselineValue, field) : null;
    if (typeof baselineNumber === 'number' && baselineNumber !== 0) {
      const drift = Math.abs(coerced - baselineNumber) / Math.abs(baselineNumber);
      const tolerance = toleranceFor(field);
      if (drift > tolerance) {
        return {
          aspect: field.name,
          ok: false,
          reason:
            `${field.name} is ${coerced}, ${(drift * 100).toFixed(0)}% from the baseline ` +
            `${baselineNumber} (tolerance ${(tolerance * 100).toFixed(0)}%)`,
        };
      }
    }
    return { aspect: field.name, ok: true };
  }

  // Everything else: present and correctly typed is the assertion.
  return { aspect: field.name, ok: true };
}

/** Compare a `detail` run against its pinned row. */
export function compareDetailBaseline(
  rows: readonly unknown[] | null | undefined,
  baseline: ScrapedRow | null | undefined,
  contract: CollectorContract,
  url: string,
): GoldenUrlResult {
  const distinct = dedupeRows(rows);
  const current = distinct[0];

  if (current === undefined) {
    return finish(url, [{ aspect: 'rows', ok: false, reason: 'the run returned no rows for this URL' }]);
  }
  if (!baseline) {
    return finish(url, [{ aspect: 'baseline', ok: false, reason: 'no baseline has been captured for this URL' }]);
  }

  const checks = (contract.fields ?? []).map((field) => checkField(current, baseline, field));
  return finish(url, checks);
}

/** Compare a `listing` run against its pinned row-set summary. */
export function compareListingBaseline(
  rows: readonly unknown[] | null | undefined,
  baseline: ListingBaselineSummary | null | undefined,
  contract: CollectorContract,
  url: string,
): GoldenUrlResult {
  const distinct = dedupeRows(rows);

  if (!baseline) {
    return finish(url, [{ aspect: 'baseline', ok: false, reason: 'no baseline has been captured for this URL' }]);
  }

  const checks: GoldenCheck[] = [];

  // 1. Row count within the contract's declared drift tolerance.
  const tolerance = contract.row_count?.drift_tolerance ?? 0.5;
  const expected = baseline.row_count;
  if (expected > 0) {
    const drift = Math.abs(distinct.length - expected) / expected;
    checks.push(
      drift > tolerance
        ? {
            aspect: 'row_count',
            ok: false,
            reason:
              `the page yielded ${distinct.length} distinct rows, was ${expected} ` +
              `(${(drift * 100).toFixed(0)}% drift, tolerance ${(tolerance * 100).toFixed(0)}%)`,
          }
        : { aspect: 'row_count', ok: true },
    );
  }

  // 2. Field shape — a field that vanished from every row is a structural change even if the rows
  //    that remain are perfect. Extra fields are not a failure: a page gaining data is not a break.
  const currentShape = new Set(fieldShapeOf(distinct));
  const missing = baseline.field_shape.filter((name) => !currentShape.has(name));
  checks.push(
    missing.length > 0
      ? { aspect: 'field_shape', ok: false, reason: `no row carries ${missing.join(', ')} any more` }
      : { aspect: 'field_shape', ok: true },
  );

  // 3. The pinned sample, matched by stable key rather than by position.
  const byIdentity = new Map(distinct.map((row) => [rowIdentity(row, contract), row]));
  for (const sample of baseline.sample_rows ?? []) {
    const key = rowIdentity(sample, contract);
    const current = byIdentity.get(key);
    if (current === undefined) {
      checks.push({ aspect: `sample:${key}`, ok: false, reason: `pinned row "${key}" is no longer on the page` });
      continue;
    }
    for (const field of contract.fields ?? []) {
      const check = checkField(current, sample, field);
      if (!check.ok) checks.push({ ...check, aspect: `sample:${key}.${check.aspect}` });
    }
  }

  return finish(url, checks);
}

function finish(url: string, checks: GoldenCheck[]): GoldenUrlResult {
  const failures = checks.filter((c) => !c.ok).map((c) => c.aspect);
  return { url, passed: failures.length === 0, checks, failures };
}

/** Compare against whichever baseline shape the contract declares. */
export function compareBaseline(
  rows: readonly unknown[] | null | undefined,
  baseline: ScrapedRow | ListingBaselineSummary | null | undefined,
  contract: CollectorContract,
  url: string,
  shape: GoldenSetShape = contract.golden_set_shape,
): GoldenUrlResult {
  return shape === 'listing'
    ? compareListingBaseline(rows, baseline as ListingBaselineSummary | null, contract, url)
    : compareDetailBaseline(rows, baseline as ScrapedRow | null, contract, url);
}

// -------------------------------------------------------------------------------------------
// The set
// -------------------------------------------------------------------------------------------

/** One pinned URL's captured baseline plus the rows the confirmation run produced for it. */
export interface GoldenSetEntry {
  url: string;
  baseline: ScrapedRow | ListingBaselineSummary | null | undefined;
  rows: readonly unknown[] | null | undefined;
}

/**
 * Evaluate every pinned URL and reduce to `golden_set_match_rate`.
 *
 * Written against N entries throughout. A single-URL listing collector is the degenerate case of
 * this function, not a separate path — which is what lets a collector's golden set grow without any
 * code change (Day-3 audit F4).
 *
 * A URL with no rows and no baseline still counts in the denominator. Dropping it would let a
 * collector improve its own match rate by failing to return anything.
 */
export function evaluateGoldenSet(
  entries: readonly GoldenSetEntry[],
  contract: CollectorContract,
): GoldenSetResult {
  const results = entries.map((entry) =>
    compareBaseline(entry.rows, entry.baseline, contract, entry.url),
  );
  const passed = results.filter((r) => r.passed).length;

  return {
    match_rate: results.length === 0 ? 1 : Math.round((passed / results.length) * 1e6) / 1e6,
    results,
    passed_urls: passed,
    total_urls: results.length,
  };
}

/**
 * Every failed aspect across the set, de-duplicated, for `healing_episodes.failed_fields` and for
 * the diagnosis builder's evidence bundle.
 */
export function goldenFailures(result: GoldenSetResult): string[] {
  return [...new Set(result.results.flatMap((r) => r.failures))];
}
