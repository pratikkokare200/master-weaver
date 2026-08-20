/**
 * The healing state machine — the decisions behind doc 01 §2.2.
 *
 * `@weaver/contracts` owns the transition *table*: which edges exist. This file owns which edge is
 * taken, and why. Keeping them apart is what stops the ledger and the engine drifting: every
 * decision below returns a state the table already permits, and `machine.test.mjs` proves it for
 * every branch rather than trusting the comment.
 *
 * Each function is one decision point from the diagram, pure, and returns its reason alongside its
 * next state. The reason is not decoration — it is written to the ledger, shown in the UI, and read
 * aloud in the demo. A machine that can say why it stopped is the difference between a product and
 * a script.
 */

import { RunState, classifyFhs, clearsCanaryGate, isLegalTransition } from '@weaver/contracts';
import type { EpisodeAuthorisedBy, EpisodeTriggerReason, FhsBand } from '@weaver/contracts';

import { checkBreaker, mayRetryTransient } from './breaker.js';
import type { BreakerInput, BreakerLimits, BreakerVerdict } from './breaker.js';

/** Every decision returns one of these. `reason` reaches the ledger verbatim. */
export interface Decision {
  from: RunState;
  next: RunState;
  reason: string;
}

/** Build a decision and assert in development that the edge exists in the frozen table. */
function decide(from: RunState, next: RunState, reason: string): Decision {
  if (!isLegalTransition(from, next)) {
    // Unreachable by construction; thrown rather than logged because a machine that has invented an
    // edge is a machine whose ledger can no longer be trusted, and silently continuing writes that
    // untrustworthy row to an append-only table.
    throw new Error(`illegal transition ${from} -> ${next} (${reason})`);
  }
  return { from, next, reason };
}

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

/**
 * `RUNNING → VALIDATING | TRANSIENT_RETRY`.
 *
 * A CLI call that failed outright is not evidence of a layout change — it is evidence of nothing at
 * all, and healing on it would mutate a working collector because the network had a bad afternoon
 * (doc 01 §4.3). Zero rows is treated the same way here and disambiguated by the probe later, since
 * an empty result and a failed call are indistinguishable until the page itself is checked.
 */
export function decideAfterRun(input: {
  ok: boolean;
  rowCount: number;
}): Decision {
  if (!input.ok) {
    return decide(RunState.RUNNING, RunState.TRANSIENT_RETRY, 'the scraper run call failed');
  }
  if (input.rowCount === 0) {
    return decide(
      RunState.RUNNING,
      RunState.TRANSIENT_RETRY,
      'the run returned zero rows; the page probe decides whether this is a break or a block',
    );
  }
  return decide(RunState.RUNNING, RunState.VALIDATING, 'rows returned');
}

/**
 * `VALIDATING → HEALTHY | DEGRADED | BROKEN`.
 *
 * One code path for manual, scheduled and confirmation runs alike (doc 01 §4.2). There is no
 * unvalidated path and no second scorer.
 */
export function decideAfterValidation(fhs: number): Decision & { band: FhsBand } {
  const band = classifyFhs(fhs);
  const next =
    band === 'HEALTHY' ? RunState.HEALTHY : band === 'DEGRADED' ? RunState.DEGRADED : RunState.BROKEN;

  const reason =
    band === 'HEALTHY'
      ? `FHS ${fhs.toFixed(4)} is at or above the healthy threshold`
      : band === 'DEGRADED'
        ? `FHS ${fhs.toFixed(4)} is a partial break — a human decides whether to repair`
        : `FHS ${fhs.toFixed(4)} is a catastrophic break — repairing autonomously`;

  return { ...decide(RunState.VALIDATING, next, reason), band };
}

/**
 * `TRANSIENT_RETRY → RUNNING | BROKEN | QUARANTINED` — doc 01 §4.3.
 *
 * The probe is the whole point of this state. A page that still serves substantial content means our
 * extraction broke and healing is correct. A page that blocks, captchas or 500s means the site is
 * refusing us, and healing a scraper because Cloudflare had a bad afternoon is how a working scraper
 * becomes a broken one. That case is `QUARANTINED`, not `BROKEN` — it needs a human, not a repair.
 */
export function decideAfterTransient(input: {
  attemptsSoFar: number;
  /** `null` when the probe has not been run — only valid while retries remain. */
  probeOk: boolean | null;
  retryLimit?: number;
}): Decision {
  if (mayRetryTransient(input.attemptsSoFar, input.retryLimit)) {
    return decide(
      RunState.TRANSIENT_RETRY,
      RunState.RUNNING,
      `retrying after a suspected transient failure (attempt ${input.attemptsSoFar + 1})`,
    );
  }

  if (input.probeOk === true) {
    return decide(
      RunState.TRANSIENT_RETRY,
      RunState.BROKEN,
      'retries exhausted and the page still serves content — the break is structural',
    );
  }

  return decide(
    RunState.TRANSIENT_RETRY,
    RunState.QUARANTINED,
    input.probeOk === false
      ? 'retries exhausted and the page itself is unreachable or blocking — this needs a human, not a repair'
      : 'retries exhausted and the page could not be probed — refusing to heal on unverified evidence',
  );
}

// ---------------------------------------------------------------------------------------------
// Authorisation — severity gates autonomy (architect decision 3)
// ---------------------------------------------------------------------------------------------

/**
 * `DEGRADED → PENDING_OPERATOR`, always.
 *
 * There is no condition under which a degraded break heals unattended and no per-workspace toggle.
 * The tiering *is* the product statement: the system distinguishes a catastrophic failure it should
 * fix itself from a partial one where a human should decide.
 */
export function decideAfterDegraded(): Decision {
  return decide(
    RunState.DEGRADED,
    RunState.PENDING_OPERATOR,
    'partial breakage never repairs unattended — waiting for an operator',
  );
}

/** `BROKEN → DIAGNOSING | QUARANTINED`. The autonomous path; the breaker is the only gate. */
export function decideAfterBroken(
  breaker: BreakerInput,
  limits?: BreakerLimits,
): Decision & { verdict: BreakerVerdict } {
  const verdict = checkBreaker(breaker, limits);
  const next = verdict.allowed ? RunState.DIAGNOSING : RunState.QUARANTINED;
  const reason = verdict.allowed
    ? 'catastrophic break, repairing autonomously'
    : `circuit breaker tripped — ${verdict.reason}`;

  return { ...decide(RunState.BROKEN, next, reason), verdict };
}

/** What the operator did with a `PENDING_OPERATOR` prompt. */
export type OperatorAction = 'repair' | 'dismiss';

/** `PENDING_OPERATOR → DIAGNOSING | IDLE | QUARANTINED`. */
export function decideAfterOperator(
  action: OperatorAction,
  breaker: BreakerInput,
  limits?: BreakerLimits,
): Decision & { verdict: BreakerVerdict | null } {
  if (action === 'dismiss') {
    return {
      ...decide(RunState.PENDING_OPERATOR, RunState.IDLE, 'the operator dismissed the repair'),
      verdict: null,
    };
  }

  const verdict = checkBreaker(breaker, limits);
  const next = verdict.allowed ? RunState.DIAGNOSING : RunState.QUARANTINED;
  const reason = verdict.allowed
    ? 'the operator authorised the repair'
    : `the operator authorised the repair but the circuit breaker refused — ${verdict.reason}`;

  return { ...decide(RunState.PENDING_OPERATOR, next, reason), verdict };
}

/**
 * Who authorised an episode, derived from what triggered it.
 *
 * The database enforces this same equivalence as a CHECK constraint, so a disagreement between this
 * function and the schema is caught on write rather than discovered in the ledger later.
 */
export function authorisedBy(trigger: EpisodeTriggerReason): EpisodeAuthorisedBy {
  return trigger === 'BROKEN' ? 'AUTONOMOUS' : 'OPERATOR';
}

// ---------------------------------------------------------------------------------------------
// The repair loop
// ---------------------------------------------------------------------------------------------

/** `DIAGNOSING → HEALING`. The description is built; the call is next. */
export function decideAfterDiagnosis(descriptionLength: number): Decision {
  return decide(
    RunState.DIAGNOSING,
    RunState.HEALING,
    `sending a ${descriptionLength}-character diagnosis to the healer`,
  );
}

/**
 * `HEALING → AWAITING_APPROVAL | QUARANTINED`.
 *
 * Anything other than a gate we can stand at is a quarantine. If `heal` came back already applied,
 * there was no gate and therefore no canary to score — the product's central guarantee did not hold
 * for that call, and continuing as though it had would put an unverified fix in the ledger next to
 * verified ones.
 */
export function decideAfterHeal(input: {
  ok: boolean;
  awaitingApproval: boolean;
  hasCanary: boolean;
  error?: string;
}): Decision {
  if (!input.ok) {
    return decide(
      RunState.HEALING,
      RunState.QUARANTINED,
      `the heal call failed — ${input.error ?? 'no error text'}`,
    );
  }
  if (!input.awaitingApproval) {
    return decide(
      RunState.HEALING,
      RunState.QUARANTINED,
      'the healer did not stop at an approval gate — there is no canary to verify',
    );
  }
  if (!input.hasCanary) {
    return decide(
      RunState.HEALING,
      RunState.QUARANTINED,
      'the healer reached the gate but returned no canary sample to score',
    );
  }
  return decide(RunState.HEALING, RunState.AWAITING_APPROVAL, 'a proposed fix is waiting at the gate');
}

/** `AWAITING_APPROVAL → CANARY_VALIDATING`. */
export function decideAfterGate(canaryRowCount: number): Decision {
  return decide(
    RunState.AWAITING_APPROVAL,
    RunState.CANARY_VALIDATING,
    `scoring a ${canaryRowCount}-row canary sample against the contract that caught the break`,
  );
}

/**
 * `CANARY_VALIDATING → APPROVING | REJECTING` — the gate the product is built around.
 *
 * The threshold is 0.90 while the break may have triggered at 0.59: a fix must be clearly good, not
 * merely better than broken. Asymmetric on purpose — rejecting is cheap, and committing something
 * wrong cannot be undone.
 */
export function decideAfterCanary(canaryFhs: number): Decision & { approved: boolean } {
  const approved = clearsCanaryGate(canaryFhs);
  const next = approved ? RunState.APPROVING : RunState.REJECTING;
  const reason = approved
    ? `canary scored ${canaryFhs.toFixed(4)} and clears the gate — committing`
    : `canary scored ${canaryFhs.toFixed(4)} and does not clear the gate — rejecting the proposed fix`;

  return { ...decide(RunState.CANARY_VALIDATING, next, reason), approved };
}

/** `REJECTING → DIAGNOSING | QUARANTINED`. Two refinements, then stop. */
export function decideAfterRejection(
  breaker: BreakerInput,
  limits?: BreakerLimits,
): Decision & { verdict: BreakerVerdict } {
  const verdict = checkBreaker(breaker, limits);
  const next = verdict.allowed ? RunState.DIAGNOSING : RunState.QUARANTINED;
  const reason = verdict.allowed
    ? 'refining the diagnosis and trying again'
    : `giving up after a rejection — ${verdict.reason}`;

  return { ...decide(RunState.REJECTING, next, reason), verdict };
}

/**
 * `APPROVING → RESTORED | QUARANTINED` — doc 01 §2.3, the one genuinely dangerous edge.
 *
 * The fix cleared the canary and has already been committed, in place, with no version history to
 * roll back to. If the golden-set confirmation then fails, we are holding a collector that is worse
 * than before and the only remaining move is a forward fix. Quarantine and tell a human.
 */
export function decideAfterConfirmation(input: {
  goldenMatchRate: number;
  threshold?: number;
}): Decision {
  const threshold = input.threshold ?? 1;
  if (input.goldenMatchRate >= threshold) {
    return decide(
      RunState.APPROVING,
      RunState.RESTORED,
      `the golden set passed at ${(input.goldenMatchRate * 100).toFixed(0)}% — the repair is verified`,
    );
  }
  return decide(
    RunState.APPROVING,
    RunState.QUARANTINED,
    `the golden set failed at ${(input.goldenMatchRate * 100).toFixed(0)}% after the fix was already ` +
      'committed — a human needs to review this collector',
  );
}

/** `HEALTHY → IDLE`, the only edge out of a healthy run, and where the baseline is refreshed. */
export function decideAfterHealthy(): Decision {
  return decide(RunState.HEALTHY, RunState.IDLE, 'run recorded and the golden baseline refreshed');
}
