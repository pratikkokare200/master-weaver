/**
 * Schema tests -- the migration applied to a real Postgres.
 *
 * These guard the parts a later edit could quietly break: that all six tables exist, that the CHECK
 * constraints actually reject the values `@weaver/contracts` says are impossible, and that the two
 * integrity rules written into the schema (severity gates autonomy; a claim records who and when)
 * hold against the database rather than only against the code that writes to it.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { COLLECTOR_STATUSES, JOB_KINDS, JOB_STATES, RUN_STATES } from '@weaver/contracts';

import { freshDb, seedCollector } from './helpers.mjs';

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

async function rejects(sql, values, why) {
  await assert.rejects(() => db.query(sql, values), why);
}

test('the migration applies cleanly and creates exactly the six tables', async () => {
  const { rows } = await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    ['collectors', 'golden_baselines', 'healing_attempts', 'healing_episodes', 'jobs', 'runs'],
  );
});

test('every jsonb payload column is jsonb, not text', async () => {
  const { rows } = await db.query(
    `select table_name, column_name, data_type
       from information_schema.columns
      where table_schema = 'public'
        and column_name in ('contract', 'baseline_row', 'rows', 'field_scores',
                            'failed_fields', 'snapshot_before', 'snapshot_after', 'canary_sample')
      order by table_name, column_name`,
  );
  assert.equal(rows.length, 8);
  for (const row of rows) {
    assert.equal(row.data_type, 'jsonb', row.table_name + '.' + row.column_name + ' is ' + row.data_type);
  }
});

test('the run_state check accepts all 17 states from the frozen machine', async () => {
  const collector = await seedCollector(db);
  for (const state of RUN_STATES) {
    await db.query(`insert into runs (collector_id, run_state) values ($1, $2)`, [collector.id, state]);
  }
  const { rows } = await db.query(`select count(distinct run_state)::int as n from runs`);
  assert.equal(rows[0].n, RUN_STATES.length);
  await db.query(`delete from runs`);
});

test('the enum checks reject values outside the contract arrays', async () => {
  const collector = await seedCollector(db);

  await rejects(`insert into runs (collector_id, run_state) values ($1, 'SLIGHTLY_OFF')`,
    [collector.id], /run_state/);
  await rejects(`insert into jobs (collector_id, kind) values ($1, 'queued')`,
    [collector.id], /kind/);
  await rejects(`insert into jobs (collector_id, kind, state) values ($1, 'manual', 'queued')`,
    [collector.id], /state/);
  await rejects(`update collectors set status = 'RUNNING' where id = $1`, [collector.id], /status/);

  // The contract arrays and the SQL checks are the same lists; if one drifts, these stop matching.
  // 'repair' is the operator-authorised heal added by migration 0002.
  assert.deepEqual([...JOB_KINDS], ['manual', 'scheduled', 'confirmation', 'repair']);

  // Stronger than the literal above, and the half that actually catches a one-sided change: every
  // kind the contract declares must be one the database will accept. A list that agrees with a
  // stale copy of itself proves nothing.
  for (const kind of JOB_KINDS) {
    await db.query(`insert into jobs (collector_id, kind) values ($1, $2)`, [collector.id, kind]);
  }
  await db.query(`delete from jobs where collector_id = $1`, [collector.id]);
  assert.deepEqual([...JOB_STATES], ['PENDING', 'CLAIMED', 'DONE', 'FAILED']);
  assert.deepEqual([...COLLECTOR_STATUSES], ['CREATING', 'ACTIVE', 'PAUSED', 'QUARANTINED', 'FAILED']);
});

test('fhs is constrained to 0..1 and keeps six decimal places', async () => {
  const collector = await seedCollector(db);

  await rejects(`insert into runs (collector_id, run_state, fhs) values ($1, 'HEALTHY', 1.4)`,
    [collector.id], /fhs/);
  await rejects(`insert into runs (collector_id, run_state, fhs) values ($1, 'BROKEN', -0.1)`,
    [collector.id], /fhs/);

  const { rows } = await db.query(
    `insert into runs (collector_id, run_state, fhs) values ($1, 'DEGRADED', 0.885714) returning fhs`,
    [collector.id],
  );
  assert.equal(Number(rows[0].fhs), 0.885714);
  await db.query(`delete from runs`);
});

test('severity gates autonomy is enforced by the database, not just by code', async () => {
  const collector = await seedCollector(db);
  const episode = (reason, authoriser) =>
    db.query(
      `insert into healing_episodes (collector_id, workspace_id, trigger_reason, authorised_by, fhs_before)
       values ($1, $2, $3, $4, 0.8)`,
      [collector.id, collector.workspace_id, reason, authoriser],
    );

  // BROKEN heals unattended; DEGRADED waits for a click (architect decision 3, locked 2026-08-12).
  await assert.doesNotReject(() => episode('BROKEN', 'AUTONOMOUS'));
  await assert.doesNotReject(() => episode('DEGRADED', 'OPERATOR'));
  await assert.rejects(() => episode('DEGRADED', 'AUTONOMOUS'), /severity_gates_autonomy/);
  await assert.rejects(() => episode('BROKEN', 'OPERATOR'), /severity_gates_autonomy/);

  await db.query(`delete from healing_episodes`);
});

test('a CLAIMED job must record who claimed it and when', async () => {
  const collector = await seedCollector(db);

  await rejects(
    `insert into jobs (collector_id, kind, state) values ($1, 'manual', 'CLAIMED')`,
    [collector.id],
    /jobs_claim_is_complete/,
  );

  // DONE keeps the claim fields as the audit trail of which worker ran it.
  await assert.doesNotReject(() =>
    db.query(
      `insert into jobs (collector_id, kind, state, claimed_at, claimed_by)
       values ($1, 'manual', 'DONE', now(), 'host#1#abc')`,
      [collector.id],
    ),
  );
  await db.query(`delete from jobs`);
});

test('the CLI input limits are enforced as column constraints', async () => {
  const collector = await seedCollector(db);
  const { rows } = await db.query(
    `insert into healing_episodes (collector_id, workspace_id, trigger_reason, authorised_by, fhs_before)
     values ($1, $2, 'BROKEN', 'AUTONOMOUS', 0.4) returning id`,
    [collector.id, collector.workspace_id],
  );

  await rejects(
    `insert into healing_attempts (episode_id, attempt_no, description_sent, cli_argv_redacted)
     values ($1, 1, $2, 'x')`,
    [rows[0].id, 'x'.repeat(1001)],
    /description_sent/,
  );
  await rejects(
    `insert into collectors (workspace_id, collector_id, name, target_url, intent_prompt, contract)
     values ($1, 'c_toolong', 'n', 'https://x.test/', $2, '{}'::jsonb)`,
    [collector.workspace_id, 'x'.repeat(501)],
    /intent_prompt/,
  );
  await db.query(`delete from healing_episodes`);
});

test('deleting a collector cascades to its children, but runs outlive their job', async () => {
  const collector = await seedCollector(db);
  const { rows: jobRows } = await db.query(
    `insert into jobs (collector_id, kind) values ($1, 'manual') returning id`, [collector.id],
  );
  await db.query(`insert into runs (collector_id, job_id, run_state) values ($1, $2, 'HEALTHY')`,
    [collector.id, jobRows[0].id]);

  // Pruning the queue must never delete the run history it produced.
  await db.query(`delete from jobs where id = $1`, [jobRows[0].id]);
  const { rows: kept } = await db.query(`select job_id from runs where collector_id = $1`, [collector.id]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].job_id, null);

  await db.query(`delete from collectors where id = $1`, [collector.id]);
  const { rows: gone } = await db.query(`select count(*)::int as n from runs`);
  assert.equal(gone[0].n, 0);
});
