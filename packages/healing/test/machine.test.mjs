/**
 * State machine tests — doc 01 §2.2.
 *
 * The first test is the one that matters structurally: every decision the machine can reach is
 * checked against the frozen transition table in `@weaver/contracts`, so the engine cannot invent an
 * edge the ledger does not recognise. After that, the branches are checked against the numbers the
 * demo actually produces — 0.80 for the partial break and ~0.05 for the total one — because those
 * two figures are what the entire severity-gates-autonomy decision hangs on.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RUN_STATE_TRANSITIONS, isLegalTransition } from '@weaver/contracts';

import {
  authorisedBy,
  decideAfterBroken,
  decideAfterCanary,
  decideAfterConfirmation,
  decideAfterDegraded,
  decideAfterDiagnosis,
  decideAfterGate,
  decideAfterHeal,
  decideAfterHealthy,
  decideAfterOperator,
  decideAfterRejection,
  decideAfterRun,
  decideAfterTransient,
  decideAfterValidation,
} from '../dist/index.js';

/** A breaker input with every rail comfortably clear. */
const CLEAR = { healAttemptsLast24h: 0, rejectionsThisEpisode: 0, accountBalance: 100 };

/** Every decision this suite produces, collected for the legality sweep. */
const produced = [];
function record(decision) {
  produced.push(decision);
  return decision;
}

// ---------------------------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------------------------

test('every decision the machine makes is an edge the frozen table permits', () => {
  const all = [
    decideAfterRun({ ok: true, rowCount: 12 }),
    decideAfterRun({ ok: true, rowCount: 0 }),
    decideAfterRun({ ok: false, rowCount: 0 }),
    decideAfterValidation(0.99),
    decideAfterValidation(0.8),
    decideAfterValidation(0.05),
    decideAfterTransient({ attemptsSoFar: 0, probeOk: null }),
    decideAfterTransient({ attemptsSoFar: 2, probeOk: true }),
    decideAfterTransient({ attemptsSoFar: 2, probeOk: false }),
    decideAfterTransient({ attemptsSoFar: 2, probeOk: null }),
    decideAfterDegraded(),
    decideAfterBroken(CLEAR),
    decideAfterBroken({ ...CLEAR, healAttemptsLast24h: 3 }),
    decideAfterOperator('repair', CLEAR),
    decideAfterOperator('dismiss', CLEAR),
    decideAfterOperator('repair', { ...CLEAR, healAttemptsLast24h: 3 }),
    decideAfterDiagnosis(400),
    decideAfterHeal({ ok: true, awaitingApproval: true, hasCanary: true }),
    decideAfterHeal({ ok: false, awaitingApproval: false, hasCanary: false, error: 'boom' }),
    decideAfterHeal({ ok: true, awaitingApproval: false, hasCanary: false }),
    decideAfterHeal({ ok: true, awaitingApproval: true, hasCanary: false }),
    decideAfterGate(2),
    decideAfterCanary(0.97),
    decideAfterCanary(0.72),
    decideAfterRejection(CLEAR),
    decideAfterRejection({ ...CLEAR, rejectionsThisEpisode: 2 }),
    decideAfterConfirmation({ goldenMatchRate: 1 }),
    decideAfterConfirmation({ goldenMatchRate: 0.5 }),
    decideAfterHealthy(),
  ];

  for (const d of all) {
    record(d);
    assert.ok(
      isLegalTransition(d.from, d.next),
      `${d.from} -> ${d.next} is not in RUN_STATE_TRANSITIONS`,
    );
  }
});

test('every decision carries a reason worth writing to the ledger', () => {
  for (const d of produced) {
    assert.equal(typeof d.reason, 'string');
    assert.ok(d.reason.length > 10, `reason too thin: "${d.reason}"`);
  }
});

test('the machine refuses to invent an edge', () => {
  // HEALTHY may only go to IDLE, so nothing in the module should ever produce HEALTHY -> RUNNING.
  assert.deepEqual([...RUN_STATE_TRANSITIONS.HEALTHY], ['IDLE']);
  assert.equal(isLegalTransition('HEALTHY', 'RUNNING'), false);
});

// ---------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------

test('a failed CLI call is transient, not a layout change', () => {
  const d = decideAfterRun({ ok: false, rowCount: 0 });
  assert.equal(d.next, 'TRANSIENT_RETRY');
});

test('zero rows is not assumed to be a break — the probe decides', () => {
  const d = decideAfterRun({ ok: true, rowCount: 0 });
  assert.equal(d.next, 'TRANSIENT_RETRY');
  assert.match(d.reason, /probe/);
});

test('rows returned move straight to validation', () => {
  assert.equal(decideAfterRun({ ok: true, rowCount: 144 }).next, 'VALIDATING');
});

// ---------------------------------------------------------------------------------------------
// The two demo breaks
// ---------------------------------------------------------------------------------------------

test('the v3 partial break scores 0.80 and halts for a human — it NEVER auto-heals', () => {
  const validation = decideAfterValidation(0.8);
  assert.equal(validation.band, 'DEGRADED');
  assert.equal(validation.next, 'DEGRADED');

  // And the only edge out of DEGRADED is the operator prompt.
  assert.equal(decideAfterDegraded().next, 'PENDING_OPERATOR');
  assert.deepEqual([...RUN_STATE_TRANSITIONS.DEGRADED], ['PENDING_OPERATOR']);
});

test('the v2 total break repairs autonomously', () => {
  const validation = decideAfterValidation(0.05);
  assert.equal(validation.band, 'BROKEN');

  const broken = decideAfterBroken(CLEAR);
  assert.equal(broken.next, 'DIAGNOSING');
  assert.equal(broken.verdict.allowed, true);
});

test('a healthy run goes to HEALTHY and nowhere near the repair loop', () => {
  assert.equal(decideAfterValidation(0.99).next, 'HEALTHY');
  assert.equal(decideAfterHealthy().next, 'IDLE');
});

test('the band boundaries are exactly where the thresholds say', () => {
  assert.equal(decideAfterValidation(0.95).band, 'HEALTHY');
  assert.equal(decideAfterValidation(0.9499).band, 'DEGRADED');
  assert.equal(decideAfterValidation(0.6).band, 'DEGRADED');
  assert.equal(decideAfterValidation(0.5999).band, 'BROKEN');
});

// ---------------------------------------------------------------------------------------------
// Transient vs structural
// ---------------------------------------------------------------------------------------------

test('retries are taken before any conclusion is drawn', () => {
  assert.equal(decideAfterTransient({ attemptsSoFar: 0, probeOk: null }).next, 'RUNNING');
  assert.equal(decideAfterTransient({ attemptsSoFar: 1, probeOk: null }).next, 'RUNNING');
});

test('a live page after exhausted retries is a structural break', () => {
  assert.equal(decideAfterTransient({ attemptsSoFar: 2, probeOk: true }).next, 'BROKEN');
});

test('a blocked page is QUARANTINED, never BROKEN — we do not heal a scraper because a site blocked us', () => {
  const d = decideAfterTransient({ attemptsSoFar: 2, probeOk: false });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /needs a human/);
});

test('an unprobed failure refuses to heal on unverified evidence', () => {
  const d = decideAfterTransient({ attemptsSoFar: 2, probeOk: null });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /unverified/);
});

// ---------------------------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------------------------

test('authorisedBy matches the CHECK constraint the database enforces', () => {
  assert.equal(authorisedBy('BROKEN'), 'AUTONOMOUS');
  assert.equal(authorisedBy('DEGRADED'), 'OPERATOR');
});

test('an operator can dismiss a degraded break without repairing it', () => {
  const d = decideAfterOperator('dismiss', CLEAR);
  assert.equal(d.next, 'IDLE');
  assert.equal(d.verdict, null);
});

test('an operator cannot override the circuit breaker', () => {
  const d = decideAfterOperator('repair', { ...CLEAR, healAttemptsLast24h: 3 });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /circuit breaker refused/);
});

// ---------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------

test('a heal that never reached a gate is quarantined — there is nothing to verify', () => {
  const d = decideAfterHeal({ ok: true, awaitingApproval: false, hasCanary: false });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /approval gate/);
});

test('a gate with no canary sample is quarantined too', () => {
  const d = decideAfterHeal({ ok: true, awaitingApproval: true, hasCanary: false });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /no canary/);
});

test('the canary gate is 0.90 and is strictly enforced', () => {
  assert.equal(decideAfterCanary(0.9).approved, true);
  assert.equal(decideAfterCanary(0.8999).approved, false);
  assert.equal(decideAfterCanary(0.9).next, 'APPROVING');
  assert.equal(decideAfterCanary(0.8999).next, 'REJECTING');
});

test('a fix merely better than broken is still rejected', () => {
  // The break that triggered this could have scored 0.05. 0.72 is a big improvement and still fails.
  const d = decideAfterCanary(0.72);
  assert.equal(d.next, 'REJECTING');
});

test('an empty canary scores zero and is rejected', () => {
  assert.equal(decideAfterCanary(0).next, 'REJECTING');
});

// ---------------------------------------------------------------------------------------------
// Confirmation — the dangerous edge
// ---------------------------------------------------------------------------------------------

test('a passing golden set restores', () => {
  assert.equal(decideAfterConfirmation({ goldenMatchRate: 1 }).next, 'RESTORED');
});

test('a failing golden set after a committed fix quarantines — doc 01 §2.3', () => {
  const d = decideAfterConfirmation({ goldenMatchRate: 0.66 });
  assert.equal(d.next, 'QUARANTINED');
  assert.match(d.reason, /already\s+committed/);
});

test('the confirmation threshold defaults to a full pass', () => {
  assert.equal(decideAfterConfirmation({ goldenMatchRate: 0.99 }).next, 'QUARANTINED');
  assert.equal(decideAfterConfirmation({ goldenMatchRate: 0.99, threshold: 0.9 }).next, 'RESTORED');
});

// ---------------------------------------------------------------------------------------------
// Rejection loop
// ---------------------------------------------------------------------------------------------

test('a first rejection refines and retries', () => {
  const d = decideAfterRejection({ ...CLEAR, rejectionsThisEpisode: 1 });
  assert.equal(d.next, 'DIAGNOSING');
});

test('the second rejection ends the episode', () => {
  const d = decideAfterRejection({ ...CLEAR, rejectionsThisEpisode: 2 });
  assert.equal(d.next, 'QUARANTINED');
});

test('the full rejected-then-approved episode walks a legal path', () => {
  // Doc 04 Beat 5e: the strongest ten seconds of the video.
  const path = [
    decideAfterValidation(0.05),
    decideAfterBroken(CLEAR),
    decideAfterDiagnosis(600),
    decideAfterHeal({ ok: true, awaitingApproval: true, hasCanary: true }),
    decideAfterGate(2),
    decideAfterCanary(0.71), // attempt 1 rejected
    decideAfterRejection({ ...CLEAR, rejectionsThisEpisode: 1 }),
    decideAfterDiagnosis(720),
    decideAfterHeal({ ok: true, awaitingApproval: true, hasCanary: true }),
    decideAfterGate(3),
    decideAfterCanary(0.97), // attempt 2 approved
    decideAfterConfirmation({ goldenMatchRate: 1 }),
  ];

  for (const d of path) assert.ok(isLegalTransition(d.from, d.next), `${d.from} -> ${d.next}`);
  assert.equal(path.at(-1).next, 'RESTORED');
});
