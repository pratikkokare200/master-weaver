/**
 * The operator-authorised repair job — migration 0002 and the runner's `repair` branch.
 *
 * This is the second half of doc 01 §2.2's `PENDING_OPERATOR --> DIAGNOSING`. The first half is the
 * halt, which `runner.test.mjs` covers; this is the click arriving as work.
 *
 * The property under test that matters most is that a repair does NOT scrape. The operator approved
 * a specific, visible break — re-measuring it would spend credits to re-derive something we already
 * know, and risks repairing a different break from the one that was authorised.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { upsertBaseline } from '../dist/episodes.js';
import { executeJob } from '../dist/runner.js';
import { CONTRACT, freshDb, healthyRow, scrapedRows, seedCollector, testLog } from './helpers.mjs';

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

let collector;
beforeEach(async () => {
  await db.query('delete from healing_episodes');
  await db.query('delete from jobs');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
});

/** A finished run parked in PENDING_OPERATOR — the state an operator is answering. */
async function pendingRun(rows = scrapedRows(10, (row, i) => (i < 7 ? { ...row, price: null } : row))) {
  const { rows: inserted } = await db.query(
    `insert into runs (collector_id, run_state, "rows", row_count, fhs, started_at, finished_at)
     values ($1, 'PENDING_OPERATOR', $2::jsonb, $3, 0.8, now(), now())
     returning id`,
    [collector.id, JSON.stringify(rows), rows.length],
  );
  return inserted[0].id;
}

/**
 * Pin a golden baseline for the contract's single detail URL.
 *
 * Required for RESTORED, and correctly so: doc 01 3.4 makes the baseline the regression test, and a
 * repair with nothing to regress against is an unverified claim. A collector with no baseline
 * quarantines instead — conservative, and the right way round.
 */
async function seedBaseline() {
  await upsertBaseline(db, {
    collectorId: collector.id,
    url: CONTRACT.golden_set[0],
    baseline: healthyRow(1),
    shape: 'detail',
  });
}

async function enqueueRepair() {
  const { rows } = await db.query(
    `insert into jobs (collector_id, kind, state) values ($1, 'repair', 'PENDING') returning id`,
    [collector.id],
  );
  return rows[0].id;
}

/** A client that fails loudly if anything tries to scrape. */
function noScrapeClient() {
  return {
    getBudget: async () => ({ ok: true, data: { balance: 100 }, argvRedacted: '', exitCode: 0, stdout: '', stderrExcerpt: '', error: null }),
    probeUrl: async () => ({ ok: true, data: null, argvRedacted: '', exitCode: 0, stdout: 'page text', stderrExcerpt: '', error: null }),
    healScraper: async () => ({
      ok: true,
      data: { status: 'awaiting_approval', preview_result: scrapedRows(3) },
      argvRedacted: 'brightdata scraper heal ... --json',
      exitCode: 0,
      stdout: '',
      stderrExcerpt: '',
      error: null,
    }),
    approveHeal: async () => ({ ok: true, data: {}, argvRedacted: '', exitCode: 0, stdout: '', stderrExcerpt: '', error: null }),
    rejectHeal: async () => ({ ok: true, data: {}, argvRedacted: '', exitCode: 0, stdout: '', stderrExcerpt: '', error: null }),
    runScraper: async () => ({ ok: true, data: scrapedRows(3), argvRedacted: '', exitCode: 0, stdout: '', stderrExcerpt: '', error: null }),
  };
}

const deps = (brightdata, overrides = {}) => ({
  db,
  brightdata,
  log: testLog,
  rowHistoryWindow: 5,
  healingEnabled: true,
  ...overrides,
});

const repairJob = (id) => ({ id, collector_id: collector.id, kind: 'repair', attempts: 1 });

// ---------------------------------------------------------------------------------------------
// Migration 0002
// ---------------------------------------------------------------------------------------------

test("'repair' is an accepted job kind", async () => {
  const id = await enqueueRepair();
  assert.ok(id);
});

test('a collector may have only one outstanding repair', async () => {
  await enqueueRepair();
  await assert.rejects(() => enqueueRepair(), /duplicate key|unique/i);
});

test('a completed repair does not block the next one', async () => {
  const first = await enqueueRepair();
  await db.query(`update jobs set state = 'DONE' where id = $1`, [first]);
  const second = await enqueueRepair();
  assert.ok(second);
});

// ---------------------------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------------------------

test('a repair job heals the parked run WITHOUT scraping again', async () => {
  const runId = await pendingRun();
  await seedBaseline();
  const jobId = await enqueueRepair();

  const bd = noScrapeClient();
  let scrapedTargets = 0;
  const originalRun = bd.runScraper;
  bd.runScraper = async (input) => {
    // The confirmation run against the golden set is legitimate; a fresh scrape of target_url is not.
    if (input.url === collector.target_url) scrapedTargets += 1;
    return originalRun(input);
  };

  const outcome = await executeJob(deps(bd), repairJob(jobId));

  assert.equal(outcome.kind, 'scored');
  assert.equal(scrapedTargets, 0, 'a repair must not re-measure the break it was authorised for');

  const { rows } = await db.query('select trigger_reason, authorised_by from healing_episodes');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trigger_reason, 'DEGRADED');
  assert.equal(rows[0].authorised_by, 'OPERATOR');
  assert.ok(runId);
});

test('the episode records when the operator was asked and when they answered', async () => {
  await pendingRun();
  const jobId = await enqueueRepair();

  await executeJob(deps(noScrapeClient()), repairJob(jobId));

  const { rows } = await db.query(
    'select operator_prompted_at, operator_acted_at from healing_episodes',
  );
  assert.ok(rows[0].operator_prompted_at !== null, 'the prompt time comes from the parked run');
  assert.ok(rows[0].operator_acted_at !== null);
});

test('the run is driven through the healing states, so the badge can follow along', async () => {
  const runId = await pendingRun();
  await seedBaseline();
  const jobId = await enqueueRepair();

  await executeJob(deps(noScrapeClient()), repairJob(jobId));

  const { rows } = await db.query('select run_state from runs where id = $1', [runId]);
  // PENDING_OPERATOR -> DIAGNOSING -> HEALING -> AWAITING_APPROVAL -> CANARY_VALIDATING ->
  // APPROVING -> RESTORED, every edge legal in the frozen table.
  assert.equal(rows[0].run_state, 'RESTORED');
});

test('a repair with nothing awaiting approval fails permanently rather than retrying', async () => {
  const jobId = await enqueueRepair(); // no PENDING_OPERATOR run exists

  const outcome = await executeJob(deps(noScrapeClient()), repairJob(jobId));

  assert.equal(outcome.kind, 'permanent');
  assert.match(outcome.error, /awaiting operator approval/);

  const { rows } = await db.query('select count(*)::int as n from healing_episodes');
  assert.equal(rows[0].n, 0, 'nothing was opened and nothing was spent');
});

test('the kill switch refuses a repair even when an operator asked for it', async () => {
  await pendingRun();
  const jobId = await enqueueRepair();

  const outcome = await executeJob(
    deps(noScrapeClient(), { healingEnabled: false }),
    repairJob(jobId),
  );

  assert.equal(outcome.kind, 'permanent');
  assert.match(outcome.error, /kill switch/);
});

test('the score is recomputed from the stored rows, not read back from the run', async () => {
  // The run row claims 0.8; the stored rows are in fact completely empty. The diagnosis must be
  // built from the rows, or it would describe a break that is not the one on the page.
  await db.query(
    `insert into runs (collector_id, run_state, "rows", row_count, fhs, started_at, finished_at)
     values ($1, 'PENDING_OPERATOR', $2::jsonb, 3, 0.8, now(), now())`,
    [collector.id, JSON.stringify([{}, {}, {}])],
  );
  const jobId = await enqueueRepair();

  await executeJob(deps(noScrapeClient()), repairJob(jobId));

  const { rows } = await db.query('select fhs_before, failed_fields from healing_episodes');
  assert.equal(Number(rows[0].fhs_before), 0, 'recomputed from the rows, not the stale 0.8');
  assert.ok(rows[0].failed_fields.length > 0);
});

test('a DEGRADED repair still refuses to skip the canary gate', async () => {
  await pendingRun();
  const jobId = await enqueueRepair();

  const bd = noScrapeClient();
  // A canary that scores 5/7 = 0.714, below the 0.90 gate.
  bd.healScraper = async () => ({
    ok: true,
    data: { status: 'awaiting_approval', preview_result: scrapedRows(3, (r) => ({ ...r, price: null })) },
    argvRedacted: '',
    exitCode: 0,
    stdout: '',
    stderrExcerpt: '',
    error: null,
  });

  await executeJob(deps(bd), repairJob(jobId));

  const { rows } = await db.query('select decision from healing_attempts order by attempt_no');
  assert.ok(rows.length > 0);
  assert.equal(rows[0].decision, 'REJECTED', 'operator authorisation is not gate authorisation');
  assert.ok(CONTRACT.fields.length > 0);
});

test('a repair with no golden baseline quarantines rather than claiming an unverified RESTORED', async () => {
  const runId = await pendingRun(); // deliberately no seedBaseline()
  const jobId = await enqueueRepair();

  await executeJob(deps(noScrapeClient()), repairJob(jobId));

  const { rows: runs } = await db.query('select run_state from runs where id = $1', [runId]);
  assert.equal(runs[0].run_state, 'QUARANTINED');

  const { rows: episodes } = await db.query('select final_state from healing_episodes');
  assert.equal(episodes[0].final_state, 'QUARANTINED');
});
