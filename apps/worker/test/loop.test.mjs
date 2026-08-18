/**
 * Cron alignment and shutdown tests -- the two behaviours that are hard to see by running the
 * worker and easy to get subtly wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { msUntilNextBoundary, startCron } from '../dist/cron.js';
import { createLifecycle } from '../dist/shutdown.js';
import { sleep } from '../dist/time.js';
import { freshDb, seedCollector, testLog } from './helpers.mjs';

const HALF_HOUR = 30 * 60_000;
const at = (iso) => Date.parse(iso);

test('the cron aligns to the wall clock, not to process start', () => {
  // Boot at 14:03 -- the first tick is at 14:30, so the price series stays on :00 and :30 across
  // restarts and a five-day history has evenly spaced points (doc 03 section 8).
  assert.equal(msUntilNextBoundary(at('2026-08-18T14:03:00Z'), HALF_HOUR), 27 * 60_000);
  assert.equal(msUntilNextBoundary(at('2026-08-18T14:29:00Z'), HALF_HOUR), 60_000);
  assert.equal(msUntilNextBoundary(at('2026-08-18T14:31:00Z'), HALF_HOUR), 29 * 60_000);
});

test('booting exactly on a boundary waits a full interval instead of firing twice', () => {
  assert.equal(msUntilNextBoundary(at('2026-08-18T14:30:00Z'), HALF_HOUR), HALF_HOUR);
  assert.equal(msUntilNextBoundary(at('2026-08-18T00:00:00Z'), HALF_HOUR), HALF_HOUR);
});

test('a cron tick enqueues one job per active collector and survives a database error', async () => {
  const db = await freshDb();
  try {
    await seedCollector(db);
    await seedCollector(db, { status: 'PAUSED' });

    const cron = startCron({ db, log: testLog, intervalMs: HALF_HOUR, runOnBoot: false });
    assert.equal(await cron.tick(), 1);
    assert.equal(await cron.tick(), 0, 'idempotent while the first is outstanding');

    // A tick that throws must not kill the loop -- the next one is thirty minutes away.
    const broken = { query: async () => { throw new Error('connection terminated'); } };
    const brokenCron = startCron({ db: broken, log: testLog, intervalMs: HALF_HOUR, runOnBoot: false });
    assert.equal(await brokenCron.tick(), 0);

    cron.stop();
    brokenCron.stop();
  } finally {
    await db.close();
  }
});

test('shutdown aborts the poll sleep so a SIGTERM is not sat out', async () => {
  const exits = [];
  const lifecycle = createLifecycle({
    log: testLog,
    graceMs: 60_000,
    exit: (code) => exits.push(code),
    onSignal: () => {},
  });

  assert.equal(lifecycle.stopping, false);

  const started = Date.now();
  const waiting = sleep(30_000, lifecycle.signal);
  lifecycle.requestShutdown('SIGTERM');
  await waiting;

  assert.ok(Date.now() - started < 5_000, 'the sleep was interrupted, not waited out');
  assert.equal(lifecycle.stopping, true);
  assert.deepEqual(exits, [], 'the first signal never forces an exit -- the job finishes');
  lifecycle.release();
});

test('a second signal stops waiting and exits', async () => {
  const exits = [];
  const lifecycle = createLifecycle({
    log: testLog,
    graceMs: 60_000,
    exit: (code) => exits.push(code),
    onSignal: () => {},
  });

  lifecycle.requestShutdown('SIGTERM');
  lifecycle.requestShutdown('SIGINT');
  assert.deepEqual(exits, [1]);
  lifecycle.release();
});

test('the watchdog forces an exit if the grace period expires', async () => {
  const exits = [];
  const lifecycle = createLifecycle({
    log: testLog,
    graceMs: 20,
    exit: (code) => exits.push(code),
    onSignal: () => {},
  });

  lifecycle.requestShutdown('SIGTERM');
  await sleep(600);
  assert.deepEqual(exits, [1], 'a graceful shutdown that never completes is a hang');
  lifecycle.release();
});

test('sleep resolves immediately when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  await sleep(10_000, controller.signal);
  assert.ok(Date.now() - started < 1_000);
});
