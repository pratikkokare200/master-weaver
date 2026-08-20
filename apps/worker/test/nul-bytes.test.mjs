/**
 * NUL bytes at the Postgres seam — regression for the crash that ended the first real episode.
 *
 * The first autonomous healing episode fired against the live Bright Data API on 2026-08-20. It
 * detected the break, built a diagnosis, healed, scored a canary of 1.0, committed the fix, ran the
 * golden-set confirmation, correctly decided the repair could not be verified — and then died
 * writing that verdict down:
 *
 *   error: unsupported Unicode escape sequence
 *       at closeEpisode (src/episodes.ts:102)
 *
 * `rowIdentity` joined its parts with `\0`. Those keys surface as the `sample:<key>` aspect of a
 * failed golden check, travel through `goldenFailures` into `snapshot_after`, and hit a `jsonb`
 * column. Postgres stores no NUL in `text` or `jsonb` at any depth.
 *
 * The damage was out of all proportion to the cause. `closeEpisode` is the LAST write of an episode,
 * so the credits were already spent and the collector already mutated — and the verdict itself was
 * what got lost. `healing_episodes_open_idx` is a plain partial index, not a unique one, so nothing
 * stopped a second episode: the run stayed BROKEN, the ledger held no evidence that a repair had
 * already been tried and had already failed its confirmation, and the next cron tick repeated the
 * whole thing fifteen minutes later.
 *
 * Two fixes, tested separately here because they defend different things:
 *   1. `IDENTITY_SEPARATOR` is now U+001F — storable, and the character actually meant for the job.
 *   2. `pgSafe` strips NULs at the seam, because scraped values are untrusted and a page is free to
 *      serve a NUL in a product name. Fixing only the separator would leave that open.
 *
 * These run against real Postgres. A mock would have accepted the NUL and proved nothing — which is
 * precisely why no existing test caught this.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { rowIdentity } from '@weaver/validation';

import { pgSafe, pgSafeText } from '../dist/db.js';
import { closeEpisode, openEpisode, recordAttempt, settleAttempt } from '../dist/episodes.js';
import { CONTRACT, freshDb, healthyRow, seedCollector, testLog } from './helpers.mjs';

const NUL = '\u0000';

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

let collector;
beforeEach(async () => {
  await db.query('delete from healing_episodes');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
  assert.ok(testLog);
});

async function open(overrides = {}) {
  return openEpisode(db, {
    collectorId: collector.id,
    workspaceId: collector.workspace_id,
    trigger: 'BROKEN',
    authorisedBy: 'AUTONOMOUS',
    fhsBefore: 0,
    failedFields: ['price'],
    snapshotBefore: [healthyRow(1)],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------------------------
// The separator
// ---------------------------------------------------------------------------------------------

test('rowIdentity does not use a NUL as its separator', () => {
  const key = rowIdentity(healthyRow(1), CONTRACT);
  assert.ok(!key.includes(NUL), `identity key still carries a NUL: ${JSON.stringify(key)}`);
});

test('an identity key built from multiple fields is still storable', async () => {
  // The exact shape that crashed: several identity fields joined, then used as a failure aspect.
  const key = rowIdentity(healthyRow(1), CONTRACT);
  const episode = await open();

  await closeEpisode(db, {
    episodeId: episode.id,
    finalState: 'QUARANTINED',
    attemptCount: 1,
    snapshotAfter: { failures: ['row_count', 'field_shape', `sample:${key}`] },
  });

  const { rows } = await db.query('select final_state, snapshot_after from healing_episodes');
  assert.equal(rows[0].final_state, 'QUARANTINED');
  assert.ok(rows[0].snapshot_after.failures.some((f) => f.startsWith('sample:')));
});

// ---------------------------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------------------------

test('pgSafe strips NULs from strings, arrays, nested objects and keys', () => {
  assert.equal(pgSafe(`a${NUL}b`), 'ab');
  assert.deepEqual(pgSafe([`x${NUL}`, `${NUL}y`]), ['x', 'y']);
  assert.deepEqual(pgSafe({ [`k${NUL}`]: { deep: [`v${NUL}`] } }), { k: { deep: ['v'] } });
});

test('pgSafe leaves everything else exactly as it found it', () => {
  // Only NUL is unstorable. Stripping any more than that would quietly corrupt scraped content.
  const row = { name: 'Ünïcøde ✓', tab: 'a\tb', nl: 'a\nb', unit: 'ab', n: 12, ok: true, nil: null };
  assert.deepEqual(pgSafe(row), row);
  assert.equal(pgSafe(undefined), undefined);
  assert.equal(pgSafeText(null), null);
});

test('a NUL in scraped content does not stop an episode being closed', async () => {
  // The failure that mattered: the verdict is reached, and writing it down is what fails.
  const episode = await open({ snapshotBefore: [{ product_name: `Aero${NUL}Book`, price: 1299 }] });

  await closeEpisode(db, {
    episodeId: episode.id,
    finalState: 'QUARANTINED',
    fhsAfter: 0,
    attemptCount: 1,
    snapshotAfter: { failures: [`sample:Aero${NUL}Book`], rows: [{ [`bad${NUL}key`]: `v${NUL}` }] },
  });

  const { rows } = await db.query(
    'select final_state, resolved_at, snapshot_before, snapshot_after from healing_episodes',
  );
  assert.equal(rows[0].final_state, 'QUARANTINED', 'the verdict must survive its own content');
  assert.ok(rows[0].resolved_at !== null, 'an episode left open loses the verdict it reached');
  assert.equal(rows[0].snapshot_before[0].product_name, 'AeroBook');
  assert.deepEqual(rows[0].snapshot_after.failures, ['sample:AeroBook']);
  assert.deepEqual(rows[0].snapshot_after.rows, [{ badkey: 'v' }]);
});

test('a NUL in the diagnosis or the stderr excerpt does not stop an attempt being recorded', async () => {
  const episode = await open();

  const attempt = await recordAttempt(db, {
    episodeId: episode.id,
    attemptNo: 1,
    descriptionSent: `price broke${NUL} here`,
    cliArgvRedacted: `brightdata scraper heal ${NUL} --json`,
  });

  await settleAttempt(db, {
    attemptId: attempt.id,
    decision: 'REJECTED',
    canaryFhs: 0.5,
    rejectionReason: `canary${NUL} below the gate`,
    stderrExcerpt: `boom${NUL}`,
    canarySample: [{ [`k${NUL}`]: `v${NUL}` }],
  });

  const { rows } = await db.query(
    'select description_sent, rejection_reason, stderr_excerpt, canary_sample from healing_attempts',
  );
  assert.equal(rows[0].description_sent, 'price broke here');
  assert.equal(rows[0].rejection_reason, 'canary below the gate');
  assert.equal(rows[0].stderr_excerpt, 'boom');
  assert.deepEqual(rows[0].canary_sample, [{ k: 'v' }]);
});

test('raw Postgres still rejects a NUL, so the guard is doing real work', async () => {
  // Guards against the test above passing for the wrong reason — if Postgres ever accepted NULs,
  // every assertion here would hold whether or not pgSafe ran at all.
  await assert.rejects(
    () => db.query(`select $1::jsonb`, [JSON.stringify({ bad: `x${NUL}` })]),
    /unsupported Unicode escape sequence/i,
  );
});
