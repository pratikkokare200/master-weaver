/**
 * @weaver/contracts — the frozen vocabulary of the system.
 *
 * Everything downstream (worker, healing, validation, dashboard) imports its types, its state names
 * and its magic numbers from here. FROZEN Day 2 AM: after that, changes are additive only.
 *
 * This package has exactly one runtime dependency (`zod`) and does no I/O. Keep it that way — it is
 * imported by both the Node worker and the browser bundle.
 */

// The state machine — 17 states, their legal transitions, and their public labels.
export {
  RUN_STATES,
  RunState,
  isRunState,
  RUN_STATE_TRANSITIONS,
  isLegalTransition,
  nextStates,
  RUN_STATE_LABEL,
  HEALTH_HEADLINES,
  HEALTH_HEADLINE_LABEL,
  RUN_STATE_HEADLINE,
  headlineFor,
  IN_FLIGHT_STATES,
  isInFlight,
} from './states.js';
export type { HealthHeadline } from './states.js';

// Thresholds — every magic number in the product, in one object.
export {
  FHS_THRESHOLDS,
  GOLDEN_SET_MAX,
  BREAKER_LIMITS,
  CLI_INPUT_LIMITS,
  FIELD_WEIGHTS,
  GOLDEN_TOLERANCES,
  classifyFhs,
  isAutonomousBand,
  clearsCanaryGate,
} from './thresholds.js';
export type { FhsBand } from './thresholds.js';

// The validation contract — Zod schemas for the field contracts.
export {
  FIELD_TYPES,
  FieldTypeSchema,
  GOLDEN_SET_SHAPES,
  GoldenSetShapeSchema,
  ScrapedRowSchema,
  FieldContractSchema,
  RowCountRuleSchema,
  CollectorContractSchema,
  parseCollectorContract,
  safeParseCollectorContract,
  goldenSetSize,
  isWeakGoldenSet,
  requiredFields,
} from './contract.js';
export type {
  ScrapedValue,
  ScrapedRow,
  FieldType,
  GoldenSetShape,
  FieldContract,
  RowCountRule,
  CollectorContract,
} from './contract.js';

// Field Health Score — result shapes and the scorer interface. Implementation: @weaver/validation.
export { EMPTY_CANARY_FHS } from './fhs.js';
export type { FieldScore, FhsBreakdown, FhsScoreOptions, FhsScorer } from './fhs.js';

// Ledger row types.
export {
  COLLECTOR_STATUSES,
  JOB_KINDS,
  JOB_STATES,
  EPISODE_FINAL_STATES,
  EPISODE_TRIGGER_REASONS,
  EPISODE_AUTHORISERS,
  ATTEMPT_DECISIONS,
} from './db.js';
export type {
  Iso8601,
  Json,
  CollectorStatus,
  Collector,
  GoldenBaseline,
  ListingBaselineSummary,
  JobKind,
  JobState,
  Job,
  Run,
  EpisodeFinalState,
  EpisodeTriggerReason,
  EpisodeAuthorisedBy,
  EpisodeSnapshot,
  HealingEpisode,
  AttemptDecision,
  HealingAttempt,
} from './db.js';
