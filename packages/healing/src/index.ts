/**
 * @weaver/healing — the engine's brain.
 *
 * Three pieces, all pure and synchronous, so the whole repair loop can be exercised without a
 * database, a subprocess or a Bright Data account:
 *
 *   machine    — which edge to take at every decision point in doc 01 §2.2, and why
 *   breaker    — the rails that stop an autonomous heal loop becoming a runaway-spend machine
 *   diagnosis  — the evidence-built, ≤1000-character description that decides whether a repair works
 *
 * What is deliberately NOT here: the orchestrator that calls Bright Data and writes the ledger. That
 * belongs to the worker, which owns the I/O, so this package stays testable and the decisions stay
 * separable from the plumbing that executes them.
 *
 * The one rule that outranks everything in this package: `--auto-approve` is never passed. Every
 * proposed fix is scored at the gate before it is committed. See `@weaver/brightdata`'s
 * `healScraper`, ADR-003 and ADR-005.
 */

// The state machine — one function per decision point.
export {
  decideAfterRun,
  decideAfterValidation,
  decideAfterTransient,
  decideAfterDegraded,
  decideAfterBroken,
  decideAfterOperator,
  decideAfterDiagnosis,
  decideAfterHeal,
  decideAfterGate,
  decideAfterCanary,
  decideAfterRejection,
  decideAfterConfirmation,
  decideAfterHealthy,
  authorisedBy,
} from './machine.js';
export type { Decision, OperatorAction } from './machine.js';

// The circuit breaker.
export {
  checkBreaker,
  mayRetryTransient,
  transientBackoffMs,
  BREAKER_RAILS,
  DEFAULT_BREAKER_LIMITS,
  TRANSIENT_BACKOFF_MS,
} from './breaker.js';
export type { BreakerInput, BreakerLimits, BreakerRail, BreakerVerdict } from './breaker.js';

// The diagnosis builder.
export {
  buildDiagnosis,
  buildEvidence,
  diagnose,
  refineDiagnosis,
  extractPageContext,
  stripBinaryNoise,
  renderExample,
  MAX_REPORTED_FIELDS,
  PAGE_CONTEXT_CHARS,
} from './diagnosis.js';
export type { EvidenceBundle, FieldEvidence, RejectionContext } from './diagnosis.js';
