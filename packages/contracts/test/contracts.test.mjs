/**
 * Contract tests.
 *
 * This package is frozen from Day 2 AM and everything else is built against it, so these tests
 * guard the things a later edit could quietly break: the state count, transition integrity, the
 * threshold values, and that a contract shaped like the one in doc 01 §3.1 still parses.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CollectorContractSchema,
  FHS_THRESHOLDS,
  GOLDEN_SET_MAX,
  HEALTH_HEADLINES,
  RUN_STATES,
  RUN_STATE_HEADLINE,
  RUN_STATE_LABEL,
  RUN_STATE_TRANSITIONS,
  RunState,
  classifyFhs,
  clearsCanaryGate,
  goldenSetSize,
  headlineFor,
  isAutonomousBand,
  isLegalTransition,
  isRunState,
  parseCollectorContract,
} from '../dist/index.js';

// ---------------------------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------------------------

test('there are exactly 17 states, all unique', () => {
  assert.equal(RUN_STATES.length, 17);
  assert.equal(new Set(RUN_STATES).size, 17);
});

test('the RunState value object matches the state list', () => {
  assert.deepEqual(Object.keys(RunState).sort(), [...RUN_STATES].sort());
  for (const state of RUN_STATES) assert.equal(RunState[state], state);
});

test('every state has a transition entry, a label and a headline', () => {
  for (const state of RUN_STATES) {
    assert.ok(state in RUN_STATE_TRANSITIONS, `${state} missing from transitions`);
    assert.ok(RUN_STATE_LABEL[state], `${state} missing a label`);
    assert.ok(HEALTH_HEADLINES.includes(RUN_STATE_HEADLINE[state]), `${state} headline invalid`);
  }
});

test('every transition target is itself a real state', () => {
  for (const [from, targets] of Object.entries(RUN_STATE_TRANSITIONS)) {
    for (const to of targets) {
      assert.ok(isRunState(to), `${from} -> ${to} is not a state`);
    }
  }
});

test('every state except IDLE is reachable', () => {
  const reachable = new Set(Object.values(RUN_STATE_TRANSITIONS).flat());
  for (const state of RUN_STATES) {
    if (state === RunState.IDLE) continue;
    assert.ok(reachable.has(state), `${state} is unreachable`);
  }
});

test('the load-bearing edges from doc 01 §2.2 exist', () => {
  // DEGRADED never auto-heals — it can only go to PENDING_OPERATOR.
  assert.deepEqual([...RUN_STATE_TRANSITIONS.DEGRADED], ['PENDING_OPERATOR']);
  assert.ok(isLegalTransition('BROKEN', 'DIAGNOSING'));
  assert.ok(isLegalTransition('CANARY_VALIDATING', 'APPROVING'));
  assert.ok(isLegalTransition('CANARY_VALIDATING', 'REJECTING'));
  // The dangerous edge: canary passed, golden-set confirmation failed, fix already committed.
  assert.ok(isLegalTransition('APPROVING', 'QUARANTINED'));
  assert.ok(isLegalTransition('REJECTING', 'DIAGNOSING'));
});

test('illegal transitions are rejected', () => {
  assert.equal(isLegalTransition('DEGRADED', 'DIAGNOSING'), false, 'DEGRADED must not auto-heal');
  assert.equal(isLegalTransition('IDLE', 'RUNNING'), false);
  assert.equal(isLegalTransition('HEALING', 'RESTORED'), false, 'no path skips the canary gate');
  assert.equal(isLegalTransition('AWAITING_APPROVAL', 'APPROVING'), false, 'must score first');
});

test('headlines collapse the machine to six buckets', () => {
  assert.equal(HEALTH_HEADLINES.length, 6);
  assert.equal(headlineFor('PENDING_OPERATOR'), 'DEGRADED');
  assert.equal(headlineFor('CANARY_VALIDATING'), 'HEALING');
  assert.equal(headlineFor('QUEUED'), 'IDLE');
  assert.equal(headlineFor('HEALTHY'), 'RESTORED');
});

test('isRunState rejects non-states', () => {
  assert.equal(isRunState('HEALTHY'), true);
  assert.equal(isRunState('NOT_A_STATE'), false);
  assert.equal(isRunState(undefined), false);
});

// ---------------------------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------------------------

test('the thresholds are the locked values', () => {
  assert.equal(FHS_THRESHOLDS.HEALTHY, 0.95);
  assert.equal(FHS_THRESHOLDS.DEGRADED, 0.6);
  assert.equal(FHS_THRESHOLDS.CANARY_GATE, 0.9);
  assert.equal(GOLDEN_SET_MAX, 3);
});

test('classifyFhs splits the bands at the documented boundaries', () => {
  assert.equal(classifyFhs(1), 'HEALTHY');
  assert.equal(classifyFhs(0.95), 'HEALTHY');
  assert.equal(classifyFhs(0.9499), 'DEGRADED');
  // The demo's own break scores 0.80 — it must land in DEGRADED, not HEALTHY (doc 03 §8 #1).
  assert.equal(classifyFhs(0.8), 'DEGRADED');
  assert.equal(classifyFhs(0.6), 'DEGRADED');
  assert.equal(classifyFhs(0.5999), 'BROKEN');
  assert.equal(classifyFhs(0), 'BROKEN');
});

test('severity gates autonomy: only BROKEN heals unattended', () => {
  assert.equal(isAutonomousBand('BROKEN'), true);
  assert.equal(isAutonomousBand('DEGRADED'), false);
  assert.equal(isAutonomousBand('HEALTHY'), false);
});

test('the canary gate is exact at 0.90', () => {
  assert.equal(clearsCanaryGate(0.9), true);
  assert.equal(clearsCanaryGate(0.8999), false);
});

test('golden set size is min(3, available) and never throws on too few', () => {
  assert.equal(goldenSetSize(0), 0);
  assert.equal(goldenSetSize(1), 1);
  assert.equal(goldenSetSize(3), 3);
  assert.equal(goldenSetSize(40), 3);
});

// ---------------------------------------------------------------------------------------------
// The validation contract
// ---------------------------------------------------------------------------------------------

/** The example contract from doc 01 §3.1, verbatim in shape. */
const DOC_CONTRACT = {
  collector_id: 'c_mpohus372o5tmid1jk',
  fields: [
    { name: 'product_name', type: 'text', required: true, min_fill: 0.95 },
    {
      name: 'price',
      type: 'number',
      required: true,
      min_fill: 0.9,
      range: [1, 100000],
      drift_tolerance: 0.4,
    },
    { name: 'in_stock', type: 'boolean', required: false, min_fill: 0.5 },
    { name: 'product_url', type: 'url', required: true, min_fill: 0.95, absolute: true },
  ],
  row_count: { min: 5, drift_tolerance: 0.5 },
  golden_set: ['https://x.dev/p/1', 'https://x.dev/p/2', 'https://x.dev/p/3'],
  golden_set_shape: 'detail',
};

test('the doc 01 §3.1 example contract parses', () => {
  const parsed = parseCollectorContract(DOC_CONTRACT);
  assert.equal(parsed.fields.length, 4);
  assert.deepEqual(parsed.fields[1].range, [1, 100000]);
  assert.equal(parsed.golden_set_shape, 'detail');
});

test('a single-URL golden set is valid — creation never fails for having too few', () => {
  const single = { ...DOC_CONTRACT, golden_set: ['https://x.dev/p/1'] };
  assert.doesNotThrow(() => parseCollectorContract(single));
});

test('a listing collector with one URL is valid', () => {
  const listing = {
    ...DOC_CONTRACT,
    golden_set: ['https://x.dev/category/laptops'],
    golden_set_shape: 'listing',
  };
  assert.equal(parseCollectorContract(listing).golden_set_shape, 'listing');
});

test('a golden set larger than GOLDEN_SET_MAX is rejected', () => {
  const tooMany = {
    ...DOC_CONTRACT,
    golden_set: ['https://x.dev/1', 'https://x.dev/2', 'https://x.dev/3', 'https://x.dev/4'],
  };
  assert.equal(CollectorContractSchema.safeParse(tooMany).success, false);
});

test('malformed LLM output is rejected at the boundary', () => {
  const cases = [
    { ...DOC_CONTRACT, fields: [] },
    { ...DOC_CONTRACT, golden_set: [] },
    { ...DOC_CONTRACT, golden_set: ['not-a-url'] },
    { ...DOC_CONTRACT, golden_set_shape: 'gallery' },
    { ...DOC_CONTRACT, fields: [{ name: 'x', type: 'date', required: true, min_fill: 0.9 }] },
    { ...DOC_CONTRACT, fields: [{ name: 'x', type: 'text', required: true, min_fill: 1.5 }] },
    { ...DOC_CONTRACT, row_count: { min: -1, drift_tolerance: 0.5 } },
  ];
  for (const [i, input] of cases.entries()) {
    assert.equal(CollectorContractSchema.safeParse(input).success, false, `case ${i} should fail`);
  }
});
