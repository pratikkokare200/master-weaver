/**
 * Circuit breaker tests — doc 01 §9.
 *
 * Every rail gets a test, and so does the precedence between them: the reason written to the ledger
 * should be the most fundamental one, not whichever check happened to run first. A breaker that
 * reports "too many attempts" when the real problem is an empty account sends a human to fix the
 * wrong thing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BREAKER_LIMITS } from '@weaver/contracts';

import {
  DEFAULT_BREAKER_LIMITS,
  TRANSIENT_BACKOFF_MS,
  checkBreaker,
  mayRetryTransient,
  transientBackoffMs,
} from '../dist/index.js';

const CLEAR = { healAttemptsLast24h: 0, rejectionsThisEpisode: 0, accountBalance: 100 };

test('a collector with room on every rail is allowed to heal', () => {
  assert.deepEqual(checkBreaker(CLEAR), { allowed: true });
});

test('the defaults come from @weaver/contracts, so tuning stays a one-file edit', () => {
  assert.equal(DEFAULT_BREAKER_LIMITS.healAttemptsPer24h, BREAKER_LIMITS.HEAL_ATTEMPTS_PER_24H);
  assert.equal(DEFAULT_BREAKER_LIMITS.rejectionsPerEpisode, BREAKER_LIMITS.REJECTIONS_PER_EPISODE);
});

// ---------------------------------------------------------------------------------------------
// Rails
// ---------------------------------------------------------------------------------------------

test('the kill switch stops healing outright', () => {
  const v = checkBreaker({ ...CLEAR, killSwitchEnabled: true });
  assert.equal(v.allowed, false);
  assert.equal(v.rail, 'KILL_SWITCH');
  // Runs must keep executing — the kill switch is not a pause button for the whole worker.
  assert.match(v.reason, /runs still execute/);
});

test('three heals in 24 hours is the ceiling', () => {
  assert.equal(checkBreaker({ ...CLEAR, healAttemptsLast24h: 2 }).allowed, true);
  const v = checkBreaker({ ...CLEAR, healAttemptsLast24h: 3 });
  assert.equal(v.allowed, false);
  assert.equal(v.rail, 'HEAL_ATTEMPTS_24H');
});

test('two rejections ends an episode', () => {
  assert.equal(checkBreaker({ ...CLEAR, rejectionsThisEpisode: 1 }).allowed, true);
  const v = checkBreaker({ ...CLEAR, rejectionsThisEpisode: 2 });
  assert.equal(v.allowed, false);
  assert.equal(v.rail, 'EPISODE_REJECTIONS');
});

test('the account credit floor halts autonomous healing', () => {
  const v = checkBreaker({ ...CLEAR, accountBalance: 4 });
  assert.equal(v.allowed, false);
  assert.equal(v.rail, 'ACCOUNT_CREDIT_FLOOR');
});

test('a balance exactly at the floor is not below it', () => {
  assert.equal(checkBreaker({ ...CLEAR, accountBalance: 10 }).allowed, true);
  assert.equal(checkBreaker({ ...CLEAR, accountBalance: 9 }).allowed, false);
});

test('an unreadable balance does not trip the floor', () => {
  // budget failing is not evidence of an empty account, and refusing every repair because one CLI
  // call did not answer would be its own outage.
  assert.equal(checkBreaker({ ...CLEAR, accountBalance: null }).allowed, true);
  assert.equal(checkBreaker({ healAttemptsLast24h: 0 }).allowed, true);
});

test('the per-episode credit cap is off until a heal has been measured', () => {
  assert.equal(DEFAULT_BREAKER_LIMITS.creditsPerEpisode, null);
  assert.equal(checkBreaker({ ...CLEAR, creditsSpentThisEpisode: 9999 }).allowed, true);
});

test('the per-episode credit cap fires once configured', () => {
  const limits = { ...DEFAULT_BREAKER_LIMITS, creditsPerEpisode: 20 };
  assert.equal(checkBreaker({ ...CLEAR, creditsSpentThisEpisode: 19 }, limits).allowed, true);
  const v = checkBreaker({ ...CLEAR, creditsSpentThisEpisode: 20 }, limits);
  assert.equal(v.allowed, false);
  assert.equal(v.rail, 'EPISODE_CREDITS');
});

// ---------------------------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------------------------

test('the kill switch outranks every other rail', () => {
  const v = checkBreaker({
    killSwitchEnabled: true,
    healAttemptsLast24h: 99,
    rejectionsThisEpisode: 99,
    accountBalance: 0,
  });
  assert.equal(v.rail, 'KILL_SWITCH');
});

test('an empty account is reported before an exhausted attempt budget', () => {
  // Otherwise a human is sent to investigate "too many heals" when the real answer is "top up".
  const v = checkBreaker({ healAttemptsLast24h: 99, accountBalance: 0 });
  assert.equal(v.rail, 'ACCOUNT_CREDIT_FLOOR');
});

test('the 24h ceiling is reported before the per-episode rejection count', () => {
  const v = checkBreaker({ ...CLEAR, healAttemptsLast24h: 3, rejectionsThisEpisode: 2 });
  assert.equal(v.rail, 'HEAL_ATTEMPTS_24H');
});

test('every refusal explains itself in terms a human can act on', () => {
  const refusals = [
    checkBreaker({ ...CLEAR, killSwitchEnabled: true }),
    checkBreaker({ ...CLEAR, healAttemptsLast24h: 3 }),
    checkBreaker({ ...CLEAR, rejectionsThisEpisode: 2 }),
    checkBreaker({ ...CLEAR, accountBalance: 0 }),
  ];
  for (const v of refusals) {
    assert.equal(v.allowed, false);
    assert.ok(v.reason.length > 20, `thin reason: ${v.reason}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Transient backoff
// ---------------------------------------------------------------------------------------------

test('backoff is 1 minute then 5 minutes, per doc 01 §4.3', () => {
  assert.deepEqual([...TRANSIENT_BACKOFF_MS], [60_000, 300_000]);
  assert.equal(transientBackoffMs(1), 60_000);
  assert.equal(transientBackoffMs(2), 300_000);
});

test('backoff past the schedule holds at the last delay rather than throwing', () => {
  // This runs inside an error path; a throw here would turn a transient blip into a crash.
  assert.equal(transientBackoffMs(3), 300_000);
  assert.equal(transientBackoffMs(99), 300_000);
  assert.equal(transientBackoffMs(0), 60_000);
  assert.equal(transientBackoffMs(-5), 60_000);
});

test('two transient retries are permitted, a third is not', () => {
  assert.equal(mayRetryTransient(0), true);
  assert.equal(mayRetryTransient(1), true);
  assert.equal(mayRetryTransient(2), false);
});
