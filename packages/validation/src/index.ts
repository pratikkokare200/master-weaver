/**
 * @weaver/validation — the contract validator and the Field Health Score scorer.
 *
 * `@weaver/contracts` declares the FHS result shapes and the `FhsScorer` interface but deliberately
 * ships no implementation; this is it. Everything here is pure and synchronous, so the worker, the
 * canary gate and any test can call the same function and get the same number.
 *
 * Start at {@link scoreRun}. Reach for {@link scoreFhs} when you hold run history or a golden-set
 * result and need the penalty-adjusted score, and for the `coerce`/`values` exports when you are
 * explaining a failure rather than computing one.
 */

// The scorer.
export { scoreRun, scoreFhs, scoreCanary, evaluateField, coerceField, fieldWeight, fhsScorer } from './score.js';
export type { RunScore } from './score.js';

// Value extraction — unwrapping `price: { value, currency, symbol }` and deciding what "filled" means.
export { extractFieldValue, unwrapScalar, readPath, isFilled, NULLISH_TOKENS } from './values.js';

// Type coercion — the per-type parsers behind `type_pass`.
export { parseNumber, parseBoolean, parseText, parseUrl, normalizeNumericString } from './coerce.js';

// Read-path de-duplication — the live collector emits every product 12 times (Day-3 audit F1).
// Deliberately NOT wired into the scorer: stored rows stay exactly as the CLI returned them.
export {
  dedupeRows,
  dedupeRowsBy,
  describeDuplication,
  canonicalRowKey,
  rowIdentity,
  ECHO_KEYS,
} from './dedupe.js';
export type { DuplicationReport } from './dedupe.js';

// Golden baselines — capture, compare, and the `golden_set_match_rate` behind every RESTORED.
export {
  captureBaseline,
  captureDetailBaseline,
  captureListingBaseline,
  compareBaseline,
  compareDetailBaseline,
  compareListingBaseline,
  evaluateGoldenSet,
  goldenFailures,
  EXACT_MATCH_FIELDS,
  LISTING_SAMPLE_SIZE,
} from './golden.js';
export type { GoldenCheck, GoldenUrlResult, GoldenSetResult, GoldenSetEntry } from './golden.js';
