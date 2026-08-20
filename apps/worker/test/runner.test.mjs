/**
 * Runner tests -- one claimed job, executed end to end.
 *
 * The Bright Data client is faked (a real one would spawn a subprocess and bill credits); the
 * database is real. So these assert on what actually lands in the ledger: the run row, its rows,
 * its score, its state, and what happened to the job afterwards.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { pollOnce } from '../dist/poller.js';
import { enqueueJob } from '../dist/queue.js';

import { cliFail, cliOk, fakeBrightData, freshDb, scrapedRows, seedCollector, testLog } from './helpers.mjs';

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

function deps(brightdata, overrides = {}) {
  return {
    db,
    brightdata,
    log: testLog,
    lifecycle: { stopping: false, signal: undefined },
    workerId: 'host#1#test',
    pollIntervalMs: 10_000,
    claimTimeoutMs: 600_000,
    maxAttempts: 3,
    retryBackoffMs: 30_000,
    rowHistoryWindow: 5,
    // Detection-only by default. These tests are about scoring and the queue; the repair loop has
    // its own suite in episode.test.mjs, and leaving it armed here would have every BROKEN fixture
    // open an episode as a side effect.
    healingEnabled: false,
    ...overrides,
  };
}

async function latestRun() {
  const { rows } = await db.query('select * from runs order by started_at desc limit 1');
  return rows[0];
}

async function onlyJob() {
  const { rows } = await db.query('select * from jobs limit 1');
  return rows[0];
}

test('pollOnce reports an empty queue without touching anything', async () => {
  assert.equal(await pollOnce(deps(fakeBrightData([]))), false);
  const { rows } = await db.query('select count(*)::int as n from runs');
  assert.equal(rows[0].n, 0);
});

test('a healthy scrape writes rows, a score and a HEALTHY run, and finishes the job', async () => {
  const rows = scrapedRows(12);
  await enqueueJob(db, collector.id, 'scheduled');

  const bd = fakeBrightData([cliOk(rows)]);
  assert.equal(await pollOnce(deps(bd)), true);

  const run = await latestRun();
  assert.equal(run.run_state, 'HEALTHY');
  assert.equal(run.row_count, 12);
  assert.equal(Number(run.fhs), 1);
  assert.ok(run.finished_at, 'a finished run records when it finished');
  assert.equal(run.job_id, (await onlyJob()).id);
  assert.equal((await onlyJob()).state, 'DONE');

  // The CLI is addressed with Bright Data's collector id, never our primary key.
  assert.equal(bd.calls[0].collectorId, collector.collector_id);
  assert.equal(bd.calls[0].url, collector.target_url);
});

test('rows are stored verbatim, nested price envelope and input echo included', async () => {
  const rows = scrapedRows(3);
  await enqueueJob(db, collector.id, 'manual');
  await pollOnce(deps(fakeBrightData([cliOk(rows)])));

  const run = await latestRun();
  assert.deepEqual(run.rows, rows, 'the ledger keeps what the CLI returned, unmodified');
  assert.deepEqual(run.rows[0].price, { value: 1300, currency: 'USD', symbol: '$' });
  assert.equal(run.rows[0].input.url, 'https://master-weaver-theta.vercel.app/');
});

test('field_scores records the per-field detail behind the score', async () => {
  await enqueueJob(db, collector.id, 'manual');
  await pollOnce(deps(fakeBrightData([cliOk(scrapedRows(10))])));

  const run = await latestRun();
  assert.equal(run.field_scores.length, 4);
  assert.deepEqual(run.field_scores.map((f) => f.field),
    ['product_name', 'price', 'in_stock', 'product_url']);
  assert.equal(run.field_scores[1].weight, 2, 'required fields weigh double');
});

test('the run row exists in RUNNING before the CLI is called', async () => {
  // Ledger integrity rule, doc 03 section 4: the row is written before the subprocess, so a crash
  // mid-scrape is still auditable. The fake client reads the ledger from inside the call.
  await enqueueJob(db, collector.id, 'manual');

  let seen = null;
  const bd = {
    calls: [],
    runScraper: async () => {
      const { rows } = await db.query('select run_state, finished_at from runs');
      seen = rows;
      return cliOk(scrapedRows(5));
    },
  };

  await pollOnce(deps(bd));
  assert.equal(seen.length, 1, 'exactly one run row was open during the scrape');
  assert.equal(seen[0].run_state, 'RUNNING');
  assert.equal(seen[0].finished_at, null);
});

test('a partial break halts at PENDING_OPERATOR and never heals unattended', async () => {
  // Price empty on 70% of rows: the demo's own break, scoring 0.80 (doc 01 section 3.2).
  const rows = scrapedRows(10, (row, i) => (i < 7 ? { ...row, price: null } : row));
  await enqueueJob(db, collector.id, 'scheduled');

  // Healing ARMED, deliberately: the point of this test is that arming it changes nothing for a
  // partial break. Architect decision 3 makes severity the authorisation signal, with no toggle.
  await pollOnce(deps(fakeBrightData([cliOk(rows)]), { healingEnabled: true }));

  const run = await latestRun();
  assert.equal(run.run_state, 'PENDING_OPERATOR');
  assert.equal(Number(run.fhs), 0.8);
  assert.equal(run.field_scores.find((f) => f.field === 'price').below_min_fill, true);

  // No episode, even with healing enabled. A human has to ask.
  const { rows: episodes } = await db.query('select count(*)::int as n from healing_episodes');
  assert.equal(episodes[0].n, 0);
  assert.equal((await onlyJob()).state, 'DONE', 'the job still completed -- the run was recorded');
});

test('a total break opens an autonomous episode when healing is armed', async () => {
  await enqueueJob(db, collector.id, 'scheduled');
  await pollOnce(deps(fakeBrightData([cliOk([])]), { healingEnabled: true }));

  const run = await latestRun();
  assert.equal(run.run_state, 'BROKEN');

  const { rows } = await db.query('select trigger_reason, authorised_by from healing_episodes');
  assert.equal(rows.length, 1, 'BROKEN repairs itself without being asked');
  assert.equal(rows[0].trigger_reason, 'BROKEN');
  assert.equal(rows[0].authorised_by, 'AUTONOMOUS');

  // The fake client has no heal surface, so the episode cannot complete -- but the job still
  // finishes, because the run itself succeeded and re-running it would not fix the repair loop.
  assert.equal((await onlyJob()).state, 'DONE');
});

test('the kill switch leaves detection intact and opens no episode', async () => {
  await enqueueJob(db, collector.id, 'scheduled');
  await pollOnce(deps(fakeBrightData([cliOk([])]), { healingEnabled: false }));

  assert.equal((await latestRun()).run_state, 'BROKEN');
  const { rows } = await db.query('select count(*)::int as n from healing_episodes');
  assert.equal(rows[0].n, 0);
});

test('a scrape that returns nothing lands in BROKEN with FHS 0', async () => {
  await enqueueJob(db, collector.id, 'scheduled');
  await pollOnce(deps(fakeBrightData([cliOk([])])));

  const run = await latestRun();
  assert.equal(run.run_state, 'BROKEN');
  assert.equal(Number(run.fhs), 0);
  assert.equal(run.row_count, 0);
  assert.deepEqual(run.rows, []);
});

test('the row penalty uses the trailing median of HEALTHY runs', async () => {
  for (let i = 0; i < 3; i += 1) {
    await db.query(
      `insert into runs (collector_id, run_state, row_count, fhs, finished_at)
       values ($1, 'HEALTHY', 20, 1, now())`, [collector.id],
    );
  }

  // Ten perfect rows where twenty are normal: the fields are fine, the harvest is half.
  await enqueueJob(db, collector.id, 'scheduled');
  await pollOnce(deps(fakeBrightData([cliOk(scrapedRows(10))])));

  const run = await latestRun();
  assert.equal(Number(run.fhs), 0.5);
  assert.equal(run.run_state, 'BROKEN');
  assert.equal(run.field_scores.every((f) => f.field_score === 1), true,
    'every field was perfect -- the penalty is what dropped the score');
});

test('a failed CLI call becomes TRANSIENT_RETRY and the job is requeued with backoff', async () => {
  await enqueueJob(db, collector.id, 'scheduled');
  await pollOnce(deps(fakeBrightData([cliFail('deadline exceeded')])));

  const run = await latestRun();
  assert.equal(run.run_state, 'TRANSIENT_RETRY');
  assert.equal(Number(run.row_count), 0);
  assert.equal(run.fhs, null, 'nothing was scraped, so there is nothing to score');
  assert.ok(run.finished_at);

  const job = await onlyJob();
  assert.equal(job.state, 'PENDING');
  assert.equal(job.attempts, 1);
  assert.match(job.error, /deadline exceeded/);
  const { rows } = await db.query(`select scheduled_for > now() as later from jobs where id = $1`, [job.id]);
  assert.equal(rows[0].later, true);
});

test('a job that has used all its attempts is abandoned rather than retried', async () => {
  const { id } = await enqueueJob(db, collector.id, 'scheduled');
  await db.query(`update jobs set attempts = 2 where id = $1`, [id]);

  await pollOnce(deps(fakeBrightData([cliFail('still failing')])));

  const job = await onlyJob();
  assert.equal(job.state, 'FAILED');
  assert.equal(job.attempts, 3);
  assert.match(job.error, /gave up after 3 attempts/);
});

test('a job for a collector that no longer exists fails permanently, without a run row', async () => {
  const { id } = await enqueueJob(db, collector.id, 'manual');
  // Detach the job from its collector the way a race between deletion and the poller would.
  await db.query(`alter table jobs drop constraint jobs_collector_id_fkey`);
  await db.query(`update jobs set collector_id = gen_random_uuid() where id = $1`, [id]);

  await pollOnce(deps(fakeBrightData([])));

  const job = await onlyJob();
  assert.equal(job.state, 'FAILED');
  assert.match(job.error, /does not exist/);
  const { rows } = await db.query('select count(*)::int as n from runs');
  assert.equal(rows[0].n, 0, 'nothing was scraped, so there is nothing to record');

  // The orphaned row has to go before the foreign key can be trusted again.
  await db.query('delete from jobs');
  await db.query(`alter table jobs add constraint jobs_collector_id_fkey
                  foreign key (collector_id) references collectors (id) on delete cascade`);
});

test('a collector whose contract does not parse fails the job instead of burning credits', async () => {
  await db.query(`update collectors set contract = '{"nonsense": true}'::jsonb where id = $1`,
    [collector.id]);
  await enqueueJob(db, collector.id, 'manual');

  const bd = fakeBrightData([]);
  await pollOnce(deps(bd));

  assert.equal(bd.calls.length, 0, 'the CLI is never called for a collector we could not validate');
  const job = await onlyJob();
  assert.equal(job.state, 'FAILED');
  assert.match(job.error, /does not parse as a CollectorContract/);
});

test('an unexpected throw does not leave the job stranded in CLAIMED', async () => {
  await enqueueJob(db, collector.id, 'scheduled');

  const bd = {
    calls: [],
    runScraper: async () => { throw new Error('socket hang up'); },
  };
  await pollOnce(deps(bd));

  const job = await onlyJob();
  assert.equal(job.state, 'PENDING', 'requeued, so the collector keeps being monitored');
  assert.match(job.error, /socket hang up/);
});
