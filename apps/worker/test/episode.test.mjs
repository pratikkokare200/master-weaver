/**
 * Healing episode orchestrator tests — the full doc 01 §7 loop against a real Postgres.
 *
 * The Bright Data client is faked; everything else is real, including the schema, its CHECK
 * constraints and the ledger writes. That is the point: the decisions are already proved pure in
 * `@weaver/healing`, so what needs proving here is that the sequence around them writes an audit
 * trail that is true even when the episode ends badly.
 *
 * Three tests carry more weight than the rest:
 *   - the rejected-then-approved episode, which doc 04 Beat 5e calls the strongest ten seconds
 *   - the attempt row existing BEFORE the heal subprocess is spawned (doc 03 §4)
 *   - `--auto-approve` never appearing in any argv, which is the entire product thesis
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { scoreFhs } from '@weaver/validation';

import { runHealingEpisode } from '../dist/episode.js';
import { upsertBaseline } from '../dist/episodes.js';
import { CONTRACT, freshDb, healthyRow, scrapedRows, seedCollector, testLog } from './helpers.mjs';

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

let collector;
beforeEach(async () => {
  await db.query('delete from healing_episodes');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
});

const GOLDEN_URL = CONTRACT.golden_set[0];

/** A canary sample that scores 1.0 against CONTRACT. */
const goodCanary = () => scrapedRows(3);

/** A canary missing `price` — weights 2+2+1+2 = 7, so (2+0+1+2)/7 = 0.714. Below the 0.90 gate. */
const weakCanary = () => scrapedRows(3, (row) => ({ ...row, price: null }));

function healResponse(canary) {
  return {
    ok: true,
    data: { status: 'awaiting_approval', preview_result: canary },
    argvRedacted: 'brightdata scraper heal c_test <diagnosis> --url ... --json',
    exitCode: 0,
    stdout: '',
    stderrExcerpt: '',
    error: null,
    durationMs: 4000,
  };
}

const okResult = (data = {}) => ({
  ok: true,
  data,
  argvRedacted: 'brightdata <cmd> --json',
  exitCode: 0,
  stdout: typeof data === 'string' ? data : JSON.stringify(data),
  stderrExcerpt: '',
  error: null,
  durationMs: 900,
});

const failResult = (message) => ({
  ok: false,
  data: null,
  argvRedacted: 'brightdata <cmd> --json',
  exitCode: 1,
  stdout: '',
  stderrExcerpt: message,
  error: { kind: 'http', message, retryable: false },
  durationMs: 300_000,
});

/**
 * A Bright Data stand-in that records every call, and — for the ledger-integrity test — can run an
 * assertion at the moment `healScraper` is entered.
 */
function fakeClient({ heals = [], confirmRows = null, onHeal, approveOk = true, balance = 100 } = {}) {
  const healQueue = [...heals];
  const calls = [];

  return {
    calls,
    argvSeen: [],
    getBudget: async () => okResult({ balance }),
    probeUrl: async (input) => {
      calls.push({ cmd: 'scrape', ...input });
      return okResult('The page. AeroBook Pro 1 price 1300 here.');
    },
    healScraper: async (input) => {
      calls.push({ cmd: 'heal', ...input });
      if (onHeal) await onHeal(input);
      const next = healQueue.shift();
      if (!next) throw new Error('fakeClient: no queued heal response');
      return next;
    },
    approveHeal: async (input) => {
      calls.push({ cmd: 'approve', ...input });
      return approveOk ? okResult({ committed: true }) : failResult('approve exploded');
    },
    rejectHeal: async (input) => {
      calls.push({ cmd: 'reject', ...input });
      return okResult({ rejected: true });
    },
    runScraper: async (input) => {
      calls.push({ cmd: 'run', ...input });
      return okResult(confirmRows ?? scrapedRows(3));
    },
  };
}

/** The score of a totally broken run — the BROKEN band that opens an autonomous episode. */
function brokenBreakdown() {
  return scoreFhs([{}, {}, {}], CONTRACT);
}

async function seedBaseline(rows = [healthyRow(1)]) {
  await upsertBaseline(db, {
    collectorId: collector.id,
    url: GOLDEN_URL,
    baseline: rows[0],
    shape: 'detail',
  });
}

function episodeInput(overrides = {}) {
  return {
    collector,
    contract: CONTRACT,
    trigger: 'BROKEN',
    breakdown: brokenBreakdown(),
    badRows: [{}],
    ...overrides,
  };
}

const deps = (brightdata) => ({ db, brightdata, log: testLog });

// ---------------------------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------------------------

test('a clean repair reaches RESTORED and writes one approved attempt', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'RESTORED');
  assert.equal(outcome.attempts, 1);

  const { rows: episodes } = await db.query('select * from healing_episodes');
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].final_state, 'RESTORED');
  assert.equal(episodes[0].trigger_reason, 'BROKEN');
  assert.equal(episodes[0].authorised_by, 'AUTONOMOUS');
  assert.equal(episodes[0].attempt_count, 1);
  assert.ok(episodes[0].resolved_at !== null);

  const { rows: attempts } = await db.query('select * from healing_attempts');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].decision, 'APPROVED');
  assert.equal(Number(attempts[0].canary_fhs), 1);
  assert.ok(attempts[0].description_sent.length > 0);
  assert.ok(attempts[0].description_sent.length <= 1000);
});

test('the episode records the before score and the after score', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  await runHealingEpisode(deps(bd), episodeInput());

  const { rows } = await db.query('select fhs_before, fhs_after from healing_episodes');
  assert.equal(Number(rows[0].fhs_before), 0);
  assert.equal(Number(rows[0].fhs_after), 1);
});

test('credits and duration are accounted for', async () => {
  await seedBaseline();
  // Balance is read before and after; the fake returns a constant, so the difference is 0 — a real
  // number rather than a null, which is what the pitch line needs.
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.creditsSpent, 0);
  assert.ok(outcome.durationMs >= 0);

  const { rows } = await db.query('select credits_spent, duration_ms from healing_episodes');
  assert.equal(Number(rows[0].credits_spent), 0);
  assert.ok(rows[0].duration_ms !== null);
});

// ---------------------------------------------------------------------------------------------
// Doc 04 Beat 5e — the strongest ten seconds
// ---------------------------------------------------------------------------------------------

test('attempt 1 rejected, attempt 2 approved — both survive in the ledger', async () => {
  await seedBaseline();
  const bd = fakeClient({
    heals: [healResponse(weakCanary()), healResponse(goodCanary())],
  });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'RESTORED');
  assert.equal(outcome.attempts, 2);

  const { rows: attempts } = await db.query(
    'select attempt_no, decision, canary_fhs, rejection_reason, description_sent from healing_attempts order by attempt_no',
  );
  assert.equal(attempts.length, 2);

  assert.equal(attempts[0].decision, 'REJECTED');
  assert.ok(Math.abs(Number(attempts[0].canary_fhs) - 5 / 7) < 1e-3);
  assert.match(attempts[0].rejection_reason, /does not clear the gate/);

  assert.equal(attempts[1].decision, 'APPROVED');
  assert.equal(Number(attempts[1].canary_fhs), 1);

  // The second description is NOT the first one resent.
  assert.notEqual(attempts[1].description_sent, attempts[0].description_sent);
  assert.match(attempts[1].description_sent, /previous fix attempt was rejected/);
});

test('a rejected fix is discarded through approve --reject, not left at the gate', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(weakCanary()), healResponse(goodCanary())] });

  await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(bd.calls.filter((c) => c.cmd === 'reject').length, 1);
  assert.equal(bd.calls.filter((c) => c.cmd === 'approve').length, 1);
});

test('two rejections end the episode in QUARANTINED', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(weakCanary()), healResponse(weakCanary())] });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.equal(outcome.attempts, 2);

  const { rows } = await db.query("select count(*)::int as n from healing_attempts where decision = 'REJECTED'");
  assert.equal(rows[0].n, 2);
});

// ---------------------------------------------------------------------------------------------
// The thesis
// ---------------------------------------------------------------------------------------------

test('--auto-approve is never passed, on any path', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(weakCanary()), healResponse(goodCanary())] });

  await runHealingEpisode(deps(bd), episodeInput());

  for (const call of bd.calls) {
    assert.ok(
      !JSON.stringify(call).includes('auto-approve'),
      `--auto-approve reached the client in ${call.cmd}`,
    );
  }
});

test('nothing is approved before its canary has been scored', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  await runHealingEpisode(deps(bd), episodeInput());

  const order = bd.calls.map((c) => c.cmd);
  assert.ok(order.indexOf('heal') < order.indexOf('approve'), 'heal must precede approve');

  // And the score that justified it is on the record.
  const { rows } = await db.query('select canary_fhs from healing_attempts');
  assert.ok(rows[0].canary_fhs !== null);
});

// ---------------------------------------------------------------------------------------------
// Ledger integrity — doc 03 §4
// ---------------------------------------------------------------------------------------------

test('the attempt row exists BEFORE the heal subprocess is spawned', async () => {
  await seedBaseline();

  let attemptsAtHealTime = null;
  const bd = fakeClient({
    heals: [healResponse(goodCanary())],
    onHeal: async () => {
      const { rows } = await db.query(
        'select attempt_no, description_sent, decision from healing_attempts',
      );
      attemptsAtHealTime = rows;
    },
  });

  await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(attemptsAtHealTime.length, 1, 'the attempt must be on record before the call');
  assert.equal(attemptsAtHealTime[0].attempt_no, 1);
  assert.ok(attemptsAtHealTime[0].description_sent.length > 0);
  // Open, with no decision yet — which is the honest state at that instant.
  assert.equal(attemptsAtHealTime[0].decision, null);
});

test('an episode is opened before any repair call is made', async () => {
  await seedBaseline();
  let episodesAtHealTime = 0;
  const bd = fakeClient({
    heals: [healResponse(goodCanary())],
    onHeal: async () => {
      const { rows } = await db.query('select count(*)::int as n from healing_episodes');
      episodesAtHealTime = rows[0].n;
    },
  });

  await runHealingEpisode(deps(bd), episodeInput());
  assert.equal(episodesAtHealTime, 1);
});

// ---------------------------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------------------------

test('a heal that errors quarantines, and the attempt keeps a null decision', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [failResult('Transient error (status 500)')] });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.match(outcome.reason, /heal call failed/);

  const { rows } = await db.query('select decision, stderr_excerpt from healing_attempts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, null, 'nothing was approved and nothing was rejected');
  assert.match(rows[0].stderr_excerpt, /500/);

  // And no approve was ever attempted.
  assert.equal(bd.calls.filter((c) => c.cmd === 'approve').length, 0);
});

test('a heal that never reaches a gate quarantines rather than trusting it', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [okResult({ status: 'done' })] });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());
  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.match(outcome.reason, /approval gate|no canary/);
});

test('a committed fix that fails the golden set quarantines — doc 01 §2.3', async () => {
  await seedBaseline([healthyRow(1)]);
  // The canary looked perfect, but the confirmation run returns a different product entirely.
  const bd = fakeClient({
    heals: [healResponse(goodCanary())],
    confirmRows: [{ ...healthyRow(1), product_name: 'Something Else Entirely' }],
  });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.match(outcome.reason, /already\s+committed/);

  // The fix WAS approved — that is what makes this the dangerous edge.
  const { rows } = await db.query('select decision from healing_attempts');
  assert.equal(rows[0].decision, 'APPROVED');
});

test('an approve call that fails quarantines without claiming a repair', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(goodCanary())], approveOk: false });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());
  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.match(outcome.reason, /approve call failed/);
});

// ---------------------------------------------------------------------------------------------
// The breaker
// ---------------------------------------------------------------------------------------------

test('the breaker refuses before a single credit is spent, and says which rail', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [healResponse(goodCanary())], balance: 2 });

  const outcome = await runHealingEpisode(deps(bd), episodeInput());

  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.equal(outcome.attempts, 0);
  assert.match(outcome.reason, /credit/);

  // No heal was attempted at all.
  assert.equal(bd.calls.filter((c) => c.cmd === 'heal').length, 0);
  const { rows } = await db.query('select count(*)::int as n from healing_attempts');
  assert.equal(rows[0].n, 0);
});

test('a refused repair is still recorded as an episode — the ledger says it was asked for', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [], balance: 0 });

  await runHealingEpisode(deps(bd), episodeInput());

  const { rows } = await db.query('select final_state, attempt_count from healing_episodes');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].final_state, 'QUARANTINED');
  assert.equal(rows[0].attempt_count, 0);
});

test('the kill switch stops healing without touching the run', async () => {
  await seedBaseline();
  const bd = fakeClient({ heals: [] });

  const outcome = await runHealingEpisode(
    { db, brightdata: bd, log: testLog, killSwitchEnabled: true },
    episodeInput(),
  );

  assert.equal(outcome.finalState, 'QUARANTINED');
  assert.match(outcome.reason, /kill switch/);
  assert.equal(bd.calls.filter((c) => c.cmd === 'heal').length, 0);
});

// ---------------------------------------------------------------------------------------------
// Severity gates autonomy
// ---------------------------------------------------------------------------------------------

test('a DEGRADED episode without an operator is refused outright', async () => {
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  await assert.rejects(
    () => runHealingEpisode(deps(bd), episodeInput({ trigger: 'DEGRADED' })),
    /never repairs unattended/,
  );

  // Nothing was written and nothing was spent.
  const { rows } = await db.query('select count(*)::int as n from healing_episodes');
  assert.equal(rows[0].n, 0);
});

test('a DEGRADED episode with an operator records who authorised it and when', async () => {
  await seedBaseline();
  const actedAt = new Date('2026-08-20T10:00:00Z');
  const bd = fakeClient({ heals: [healResponse(goodCanary())] });

  const outcome = await runHealingEpisode(
    deps(bd),
    episodeInput({
      trigger: 'DEGRADED',
      operatorPromptedAt: new Date('2026-08-20T09:58:00Z'),
      operatorActedAt: actedAt,
    }),
  );

  assert.equal(outcome.finalState, 'RESTORED');

  const { rows } = await db.query(
    'select trigger_reason, authorised_by, operator_acted_at from healing_episodes',
  );
  assert.equal(rows[0].trigger_reason, 'DEGRADED');
  assert.equal(rows[0].authorised_by, 'OPERATOR');
  assert.ok(rows[0].operator_acted_at !== null);
});

// ---------------------------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------------------------

test('the golden baseline is refreshed only after RESTORED', async () => {
  await seedBaseline([healthyRow(1)]);
  const before = await db.query('select captured_at from golden_baselines');

  const bd = fakeClient({
    heals: [healResponse(goodCanary())],
    confirmRows: [healthyRow(1)],
  });
  await runHealingEpisode(deps(bd), episodeInput());

  const afterRows = await db.query('select captured_at from golden_baselines');
  assert.ok(
    new Date(afterRows.rows[0].captured_at) >= new Date(before.rows[0].captured_at),
    'a RESTORED episode refreshes the baseline',
  );
});

test('a quarantined episode never refreshes the baseline', async () => {
  await seedBaseline([healthyRow(1)]);
  const before = await db.query('select baseline_row from golden_baselines');

  const bd = fakeClient({ heals: [healResponse(weakCanary()), healResponse(weakCanary())] });
  const outcome = await runHealingEpisode(deps(bd), episodeInput());
  assert.equal(outcome.finalState, 'QUARANTINED');

  const afterRows = await db.query('select baseline_row from golden_baselines');
  assert.deepEqual(
    afterRows.rows[0].baseline_row,
    before.rows[0].baseline_row,
    'the bar must not ratchet down to meet the breakage',
  );
});
