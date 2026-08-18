/**
 * Queue tests.
 *
 * These import the compiled `dist/queue.js` and run its statements against a real Postgres, so what
 * is under test is the SQL the worker ships -- not a re-typed copy of it. The claim statement in
 * particular is the one piece that has to be exactly right, and a typo in it would show up here as
 * a syntax error rather than as two workers scraping the same page in production.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import {
  backoffMs,
  claimNextJob,
  completeJob,
  enqueueJob,
  enqueueScheduledRuns,
  failJob,
  queueDepth,
  reapStaleClaims,
  retryJob,
} from '../dist/queue.js';

import { freshDb, seedCollector } from './helpers.mjs';

const WORKER = 'host#1#aaaaaa';

let db;
let collector;

before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

beforeEach(async () => {
  await db.query('delete from jobs');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
});

async function readJob(id) {
  const { rows } = await db.query('select * from jobs where id = $1', [id]);
  return rows[0];
}

test('an empty queue claims nothing', async () => {
  assert.equal(await claimNextJob(db, WORKER), null);
});

test('claiming marks the job CLAIMED, stamps the worker and counts the attempt', async () => {
  const { id } = await enqueueJob(db, collector.id, 'manual');

  const claimed = await claimNextJob(db, WORKER);
  assert.equal(claimed.id, id);
  assert.equal(claimed.state, 'CLAIMED');
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.claimed_by, WORKER);
  assert.ok(claimed.claimed_at, 'claimed_at must be stamped');
  assert.equal(claimed.kind, 'manual');

  // The row is not handed out twice.
  assert.equal(await claimNextJob(db, 'other#2#bbbbbb'), null);
});

test('claiming takes the oldest due job first', async () => {
  const older = await enqueueJob(db, collector.id, 'scheduled');
  await db.query(`update jobs set scheduled_for = now() - interval '1 hour' where id = $1`, [older.id]);
  const newer = await enqueueJob(db, collector.id, 'manual');

  assert.equal((await claimNextJob(db, WORKER)).id, older.id);
  assert.equal((await claimNextJob(db, WORKER)).id, newer.id);
});

test('a job scheduled in the future is not due yet', async () => {
  const { id } = await enqueueJob(db, collector.id, 'manual');
  await db.query(`update jobs set scheduled_for = now() + interval '5 minutes' where id = $1`, [id]);

  assert.equal(await claimNextJob(db, WORKER), null);
});

test('completing keeps the claim fields as the audit trail', async () => {
  const { id } = await enqueueJob(db, collector.id, 'manual');
  await claimNextJob(db, WORKER);
  await completeJob(db, id);

  const job = await readJob(id);
  assert.equal(job.state, 'DONE');
  assert.equal(job.error, null);
  assert.equal(job.claimed_by, WORKER, 'which worker ran it stays on the row');
});

test('failing records the reason and stops the job being claimed again', async () => {
  const { id } = await enqueueJob(db, collector.id, 'manual');
  await claimNextJob(db, WORKER);
  await failJob(db, id, 'collector does not exist');

  const job = await readJob(id);
  assert.equal(job.state, 'FAILED');
  assert.equal(job.error, 'collector does not exist');
  assert.equal(await claimNextJob(db, WORKER), null);
});

test('retrying releases the claim and pushes the job into the future', async () => {
  const { id } = await enqueueJob(db, collector.id, 'scheduled');
  await claimNextJob(db, WORKER);
  await retryJob(db, id, 'deadline exceeded', 60_000);

  const job = await readJob(id);
  assert.equal(job.state, 'PENDING');
  assert.equal(job.error, 'deadline exceeded');
  assert.equal(job.claimed_by, null, 'a PENDING row must not carry a stale claim');
  assert.equal(job.claimed_at, null);
  assert.equal(job.attempts, 1, 'the attempt already spent is not refunded');

  // Not due yet, so the loop moves on instead of hot-looping on a failing job.
  assert.equal(await claimNextJob(db, WORKER), null);

  await db.query(`update jobs set scheduled_for = now() where id = $1`, [id]);
  const reclaimed = await claimNextJob(db, WORKER);
  assert.equal(reclaimed.attempts, 2);
});

test('backoff doubles per attempt and then stops growing', () => {
  assert.equal(backoffMs(1, 30_000), 30_000);
  assert.equal(backoffMs(2, 30_000), 60_000);
  assert.equal(backoffMs(3, 30_000), 120_000);
  assert.equal(backoffMs(0, 30_000), 30_000);
  // Capped, so a long-lived job cannot be scheduled a month out.
  assert.equal(backoffMs(50, 30_000), 30_000 * 64);
});

test('a claim from a worker that died is recovered, not left stranded', async () => {
  const { id } = await enqueueJob(db, collector.id, 'scheduled');
  await claimNextJob(db, WORKER);
  await db.query(`update jobs set claimed_at = now() - interval '30 minutes' where id = $1`, [id]);

  const reaped = await reapStaleClaims(db, 10 * 60_000, 3);
  assert.equal(reaped.length, 1);
  assert.equal(reaped[0].state, 'PENDING');

  const job = await readJob(id);
  assert.equal(job.claimed_by, null);
  assert.match(job.error, /claim expired/);
  // Immediately available again -- the collector resumes being monitored.
  assert.equal((await claimNextJob(db, WORKER)).id, id);
});

test('a job that has exhausted its attempts is abandoned rather than requeued forever', async () => {
  const { id } = await enqueueJob(db, collector.id, 'scheduled');
  await db.query(
    `update jobs set state = 'CLAIMED', attempts = 3, claimed_at = now() - interval '30 minutes',
                     claimed_by = $2 where id = $1`,
    [id, WORKER],
  );

  const reaped = await reapStaleClaims(db, 10 * 60_000, 3);
  assert.equal(reaped[0].state, 'FAILED');
  assert.equal((await readJob(id)).claimed_by, WORKER, 'the failed row keeps who held it');
});

test('a fresh claim is left alone by the reaper', async () => {
  await enqueueJob(db, collector.id, 'scheduled');
  await claimNextJob(db, WORKER);
  assert.deepEqual(await reapStaleClaims(db, 10 * 60_000, 3), []);
});

test('the cron enqueues one scheduled job per ACTIVE collector', async () => {
  const second = await seedCollector(db);
  const paused = await seedCollector(db, { status: 'PAUSED' });
  await seedCollector(db, { status: 'QUARANTINED' });

  const enqueued = await enqueueScheduledRuns(db);
  const ids = enqueued.map((job) => job.collector_id).sort();
  assert.deepEqual(ids, [collector.id, second.id].sort());
  assert.ok(!ids.includes(paused.id), 'a paused collector is not scraped');
});

test('the cron is idempotent while a scheduled job is still outstanding', async () => {
  assert.equal((await enqueueScheduledRuns(db)).length, 1);

  // A second tick, or a worker restart, must not pile up duplicate runs.
  assert.equal((await enqueueScheduledRuns(db)).length, 0);

  // Nor while the job is being worked on.
  await claimNextJob(db, WORKER);
  assert.equal((await enqueueScheduledRuns(db)).length, 0);

  // Once it is finished, the next tick schedules the next run.
  const { rows } = await db.query(`select id from jobs limit 1`);
  await completeJob(db, rows[0].id);
  assert.equal((await enqueueScheduledRuns(db)).length, 1);
});

test('a manual job does not block the cron, and vice versa', async () => {
  await enqueueJob(db, collector.id, 'manual');
  assert.equal((await enqueueScheduledRuns(db)).length, 1, 'kinds are queued independently');
});

test('queueDepth counts by state', async () => {
  await enqueueJob(db, collector.id, 'manual');
  const { id } = await enqueueJob(db, collector.id, 'scheduled');
  await claimNextJob(db, WORKER);
  await failJob(db, id, 'nope');

  const depth = await queueDepth(db);
  assert.equal(depth.CLAIMED, 1);
  assert.equal(depth.FAILED, 1);
});
