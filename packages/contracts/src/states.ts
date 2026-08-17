/**
 * The run state machine — the single source of truth for every state the engine can be in.
 *
 * Spec: doc 01 §2.1 (states + public labels), §2.2 (legal transitions), doc 05 §4 (badge grouping).
 *
 * This module is FROZEN from Day 2 AM. Pro and Flash build against these names; renaming one
 * after the freeze breaks the dashboard, the worker and the ledger simultaneously.
 *
 * Deliberately a `const` object + union type rather than a TypeScript `enum`: enums are not
 * erasable, so they break Node's native type stripping in the worker and `isolatedModules` in
 * the Next.js app. `RunState.HEALTHY` (value) and `: RunState` (type) both work regardless.
 */

/** All 17 states, in lifecycle order. */
export const RUN_STATES = [
  'IDLE',
  'QUEUED',
  'RUNNING',
  'VALIDATING',
  'HEALTHY',
  'TRANSIENT_RETRY',
  'DEGRADED',
  'BROKEN',
  'PENDING_OPERATOR',
  'DIAGNOSING',
  'HEALING',
  'AWAITING_APPROVAL',
  'CANARY_VALIDATING',
  'APPROVING',
  'REJECTING',
  'RESTORED',
  'QUARANTINED',
] as const;

export type RunState = (typeof RUN_STATES)[number];

export const RunState = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  VALIDATING: 'VALIDATING',
  HEALTHY: 'HEALTHY',
  TRANSIENT_RETRY: 'TRANSIENT_RETRY',
  DEGRADED: 'DEGRADED',
  BROKEN: 'BROKEN',
  PENDING_OPERATOR: 'PENDING_OPERATOR',
  DIAGNOSING: 'DIAGNOSING',
  HEALING: 'HEALING',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  CANARY_VALIDATING: 'CANARY_VALIDATING',
  APPROVING: 'APPROVING',
  REJECTING: 'REJECTING',
  RESTORED: 'RESTORED',
  QUARANTINED: 'QUARANTINED',
} as const satisfies Record<RunState, RunState>;

export function isRunState(value: unknown): value is RunState {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value);
}

/**
 * Legal transitions — a direct transcription of the doc 01 §2.2 diagram.
 *
 * `packages/healing` owns the *decisions* (which edge to take, and when); this table only says
 * which edges exist, so the state machine and the ledger can't drift apart.
 */
export const RUN_STATE_TRANSITIONS = {
  IDLE: ['QUEUED'],
  QUEUED: ['RUNNING'],
  RUNNING: ['VALIDATING', 'TRANSIENT_RETRY'],
  // attempt < 2 → retry · attempt == 2 + page probe OK → structural · probe FAILS → blocked, not our bug
  TRANSIENT_RETRY: ['RUNNING', 'BROKEN', 'QUARANTINED'],
  VALIDATING: ['HEALTHY', 'DEGRADED', 'BROKEN'],
  HEALTHY: ['IDLE'],
  // Severity gates autonomy (architect decision 3, locked 2026-08-12): DEGRADED never auto-heals.
  DEGRADED: ['PENDING_OPERATOR'],
  PENDING_OPERATOR: ['DIAGNOSING', 'IDLE', 'QUARANTINED'],
  BROKEN: ['DIAGNOSING', 'QUARANTINED'],
  DIAGNOSING: ['HEALING'],
  HEALING: ['AWAITING_APPROVAL', 'QUARANTINED'],
  AWAITING_APPROVAL: ['CANARY_VALIDATING'],
  CANARY_VALIDATING: ['APPROVING', 'REJECTING'],
  REJECTING: ['DIAGNOSING', 'QUARANTINED'],
  // APPROVING → QUARANTINED is the dangerous edge (doc 01 §2.3): the fix passed canary but failed
  // the golden-set confirmation, and it is already committed. Forward-fix is the only rollback.
  APPROVING: ['RESTORED', 'QUARANTINED'],
  RESTORED: ['IDLE'],
  QUARANTINED: ['IDLE'],
} as const satisfies Record<RunState, readonly RunState[]>;

export function isLegalTransition(from: RunState, to: RunState): boolean {
  const allowed: readonly RunState[] = RUN_STATE_TRANSITIONS[from];
  return allowed.includes(to);
}

/** Every state reachable from `from` in one step. */
export function nextStates(from: RunState): readonly RunState[] {
  return RUN_STATE_TRANSITIONS[from];
}

/**
 * Per-state public label — doc 01 §2.1. Rendered as the badge *sub-caption*; the headline comes
 * from {@link RUN_STATE_HEADLINE}.
 */
export const RUN_STATE_LABEL = {
  IDLE: 'Idle',
  QUEUED: 'Queued',
  RUNNING: 'Scraping…',
  VALIDATING: 'Checking data…',
  HEALTHY: '✅ Healthy',
  TRANSIENT_RETRY: 'Retrying…',
  DEGRADED: '⚠️ Degraded',
  BROKEN: '⚠️ Layout Change Detected',
  PENDING_OPERATOR: '⚠️ Degraded — repair needs your approval',
  DIAGNOSING: 'Diagnosing…',
  HEALING: '⚠️ Layout Change Detected — Healing…',
  AWAITING_APPROVAL: 'Reviewing proposed fix…',
  CANARY_VALIDATING: 'Verifying fix…',
  APPROVING: 'Committing fix…',
  REJECTING: 'Fix rejected — retrying…',
  RESTORED: '✅ Pipeline Restored',
  QUARANTINED: '🛑 Needs your review',
} as const satisfies Record<RunState, string>;

/**
 * The six headline buckets the 17 states collapse into — doc 05 §4.
 *
 * Contracts owns the *grouping* (it is a function of the state machine); `packages/ui` owns how
 * each bucket looks. No colours or Tailwind classes here — those belong to the design system.
 */
export const HEALTH_HEADLINES = [
  'IDLE',
  'SCRAPING',
  'HEALING',
  'DEGRADED',
  'RESTORED',
  'QUARANTINED',
] as const;

export type HealthHeadline = (typeof HEALTH_HEADLINES)[number];

export const HEALTH_HEADLINE_LABEL = {
  IDLE: 'Idle',
  SCRAPING: 'Scraping…',
  HEALING: '⚠️ Layout Change Detected — Healing…',
  DEGRADED: '⚠️ Degraded — repair needs your approval',
  RESTORED: '✅ Pipeline Restored',
  QUARANTINED: '🛑 Needs your review',
} as const satisfies Record<HealthHeadline, string>;

export const RUN_STATE_HEADLINE = {
  IDLE: 'IDLE',
  QUEUED: 'IDLE',
  RUNNING: 'SCRAPING',
  VALIDATING: 'SCRAPING',
  TRANSIENT_RETRY: 'SCRAPING',
  BROKEN: 'HEALING',
  DIAGNOSING: 'HEALING',
  HEALING: 'HEALING',
  AWAITING_APPROVAL: 'HEALING',
  CANARY_VALIDATING: 'HEALING',
  APPROVING: 'HEALING',
  REJECTING: 'HEALING',
  // The only headline that carries an action — the badge *asks* instead of reporting (doc 05 §4).
  DEGRADED: 'DEGRADED',
  PENDING_OPERATOR: 'DEGRADED',
  HEALTHY: 'RESTORED',
  RESTORED: 'RESTORED',
  QUARANTINED: 'QUARANTINED',
} as const satisfies Record<RunState, HealthHeadline>;

export function headlineFor(state: RunState): HealthHeadline {
  return RUN_STATE_HEADLINE[state];
}

/** States where a subprocess is in flight — used to decide whether a job may be claimed. */
export const IN_FLIGHT_STATES = [
  'RUNNING',
  'HEALING',
  'APPROVING',
  'REJECTING',
] as const satisfies readonly RunState[];

export function isInFlight(state: RunState): boolean {
  return (IN_FLIGHT_STATES as readonly RunState[]).includes(state);
}
