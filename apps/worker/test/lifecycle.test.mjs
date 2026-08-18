/**
 * The poll loop under shutdown.
 *
 * "Catch SIGINT/SIGTERM, finish the current job, and exit" is easy to claim and easy to get wrong
 * in either direction: abandon the scrape halfway, or keep claiming work forever. This drives the
 * real loop against a real database and asserts both halves.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { runPollLoop } from '../dist/poller.js';
import { enqueueJob } from '../dist/queue.js';
import { createLifecycle } from '../dist/shutdown.js';

import { cliOk, freshDb, scrapedRows, seedCollector, testLog } from './helpers.mjs';

let db;
let collector;

before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

beforeEach(async () => {
  await db.query('delete from runs');
  await db.query('delete from jobs');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
});

function lifecycleFor(exits) {
  return createLifecycle({
    log: testLog,
    graceMs: 60_000,
    exit: (code) => exits.push(code),
    onSignal: () => {},
  });
}

function deps(brightdata, lifecycle, pollIntervalMs = 50) {
  return {
    db,
    brightdata,
    log: testLog,
    lifecycle,
    workerId: 'host#1#test',
    pollIntervalMs,
    claimTimeoutMs: 600_000,
    maxAttempts: 3,
    retryBackoffMs: 30_000,
    rowHistoryWindow: 5,
  };
}

test('a signal mid-scrape finishes that job and claims no more', async () => {
  const first = await enqueueJob(db, collector.id, 'scheduled');
  const second = await enqueueJob(db, collector.id, 'manual');

  const exits = [];
  const lifecycle = lifecycleFor(exits);

  let calls = 0;
  const brightdata = {
    runScraper: async () => {
      calls += 1;
      // SIGTERM arrives while the subprocess is running.
      lifecycle.requestShutdown('SIGTERM');
      return cliOk(scrapedRows(8));
    },
  };

  await runPollLoop(deps(brightdata, lifecycle));
  lifecycle.release();

  assert.equal(calls, 1, 'exactly one scrape ran');

  const { rows: jobs } = await db.query('select id, state from jobs order by scheduled_for, id');
  assert.equal(jobs.find((j) => j.id === first.id).state, 'DONE', 'the in-flight job finished');
  assert.equal(jobs.find((j) => j.id === second.id).state, 'PENDING', 'the next job was left queued');

  const { rows: runs } = await db.query('select run_state, row_count from runs');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].run_state, 'HEALTHY', 'the run was scored and closed, not abandoned');
  assert.equal(runs[0].row_count, 8);

  assert.deepEqual(exits, [], 'a clean shutdown never needs the watchdog');
});

test('the loop drains a backlog back to back rather than one job per interval', async () => {
  for (let i = 0; i < 3; i += 1) await enqueueJob(db, collector.id, 'manual');

  const exits = [];
  const lifecycle = lifecycleFor(exits);

  let calls = 0;
  const brightdata = {
    runScraper: async () => {
      calls += 1;
      if (calls === 3) lifecycle.requestShutdown('SIGTERM');
      return cliOk(scrapedRows(4));
    },
  };

  // A minute-long poll interval: if the loop slept even once between jobs this would hang, so
  // the generous threshold still proves the property exactly, without racing a loaded machine.
  const started = Date.now();
  await runPollLoop(deps(brightdata, lifecycle, 60_000));
  lifecycle.release();

  assert.equal(calls, 3);
  assert.ok(Date.now() - started < 10_000, 'no sleep between jobs when work is waiting');

  const { rows } = await db.query(`select count(*)::int as n from jobs where state = 'DONE'`);
  assert.equal(rows[0].n, 3);
});

test('an already-stopping lifecycle claims nothing at all', async () => {
  await enqueueJob(db, collector.id, 'manual');

  const exits = [];
  const lifecycle = lifecycleFor(exits);
  lifecycle.requestShutdown('SIGTERM');

  const brightdata = { runScraper: async () => { throw new Error('must not be called'); } };
  await runPollLoop(deps(brightdata, lifecycle));
  lifecycle.release();

  const { rows } = await db.query(`select state from jobs`);
  assert.equal(rows[0].state, 'PENDING');
});
