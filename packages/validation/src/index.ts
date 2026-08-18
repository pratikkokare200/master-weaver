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
