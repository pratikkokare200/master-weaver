/**
 * The trailing median row count — and why its window stops at the last committed heal.
 *
 * The row penalty is `row_count / trailing_median_row_count`. It exists to catch a collector that
 * silently starts returning three products instead of three hundred, which no field score would
 * notice because the three it does return are perfectly well formed.
 *
 * It also, before this fix, made a legitimate improvement unrecoverable.
 *
 * The ram/storage heal repaired a duplication defect nobody had asked it to touch: the collector had
 * been emitting each of 12 products 12 times, and the new template returned a flat 12. Every field
 * scored 1.0, and the run landed at FHS 0.083 — 12 divided by a trailing median of 144, read as a
 * 91% row collapse.
 *
 * The part that made it serious is that it does not clear on its own. Only HEALTHY runs feed the
 * median; the penalty guarantees no run is HEALTHY; so the median stays at 144 forever and the
 * collector sits below the BROKEN line by arithmetic alone, healing on every tick until the breaker
 * stops it. Recovery required editing the database by hand.
 *
 * An APPROVED heal attempt is the precise moment the extractor changed, so runs before it are
 * evidence about a different collector.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { trailingMedianRowCount } from '../dist/ledger.js';
import { openEpisode, recordAttempt, settleAttempt } from '../dist/episodes.js';
import { freshDb, seedCollector } from './helpers.mjs';

let db;
before(async () => { db = await freshDb(); });
after(async () => { await db?.close(); });

let collector;
beforeEach(async () => {
  await db.query('delete from healing_episodes');
  await db.query('delete from runs');
  await db.query('delete from collectors');
  collector = await seedCollector(db);
});

/** A finished run with a given row count, at a given offset from now. */
async function run(rowCount, minutesAgo, state = 'HEALTHY') {
  await db.query(
    `insert into runs (collector_id, run_state, "rows", row_count, fhs, started_at, finished_at)
     values ($1, $2, '[]'::jsonb, $3, 1, now() - ($4 || ' minutes')::interval,
             now() - ($4 || ' minutes')::interval)`,
    [collector.id, state, rowCount, String(minutesAgo)],
  );
}

/** A committed heal: an episode carrying an APPROVED attempt, `minutesAgo` in the past. */
async function committedHeal(minutesAgo) {
  const episode = await openEpisode(db, {
    collectorId: collector.id,
    workspaceId: collector.workspace_id,
    trigger: 'BROKEN',
    authorisedBy: 'AUTONOMOUS',
    fhsBefore: 0,
    failedFields: ['ram'],
    snapshotBefore: [],
  });

  const attempt = await recordAttempt(db, {
    episodeId: episode.id,
    attemptNo: 1,
    descriptionSent: 'ram and storage are missing',
    cliArgvRedacted: 'brightdata scraper heal ... --json',
  });

  await settleAttempt(db, { attemptId: attempt.id, decision: 'APPROVED', canaryFhs: 1 });

  await db.query(
    `update healing_attempts set created_at = now() - ($1 || ' minutes')::interval where id = $2`,
    [String(minutesAgo), attempt.id],
  );
  return episode.id;
}

test('with no heal in the history, every healthy run counts', async () => {
  await run(144, 30);
  await run(144, 20);
  await run(144, 10);

  assert.equal(await trailingMedianRowCount(db, collector.id, 5), 144);
});

test('runs from before a committed heal are excluded — they measured a different extractor', async () => {
  await run(144, 60);
  await run(144, 50);
  await run(144, 40);
  await committedHeal(30);
  await run(12, 20);
  await run(12, 10);

  // 12, not 144 and not the 78 a naive median across both eras would give.
  assert.equal(await trailingMedianRowCount(db, collector.id, 5), 12);
});

test('immediately after a heal the median is null, so the penalty is skipped', async () => {
  await run(144, 60);
  await run(144, 50);
  await committedHeal(30);

  // The honest position: the thing being measured just changed and normal is not yet known.
  // Returning 144 here is what produced FHS 0.083 on a run whose every field scored 1.0.
  assert.equal(await trailingMedianRowCount(db, collector.id, 5), null);
});

test('a de-duplicating heal no longer deadlocks the collector', async () => {
  // The exact scenario, end to end. Before the fix this returned 144 and the resulting penalty of
  // 12/144 = 0.083 kept every subsequent run under the BROKEN line, which kept any run from being
  // HEALTHY, which kept the median at 144.
  for (let i = 10; i > 4; i -= 1) await run(144, i * 10);
  await committedHeal(45);

  const median = await trailingMedianRowCount(db, collector.id, 5);
  assert.equal(median, null, 'the pre-heal era must not set the bar for the post-heal one');

  // First run on the new template: no penalty, so it can be HEALTHY and seed the new baseline.
  await run(12, 40);
  assert.equal(await trailingMedianRowCount(db, collector.id, 5), 12);
});

test('a REJECTED attempt does not move the boundary — nothing was committed', async () => {
  await run(144, 60);
  await run(144, 50);

  const episode = await openEpisode(db, {
    collectorId: collector.id,
    workspaceId: collector.workspace_id,
    trigger: 'BROKEN',
    authorisedBy: 'AUTONOMOUS',
    fhsBefore: 0,
    failedFields: ['price'],
    snapshotBefore: [],
  });
  const attempt = await recordAttempt(db, {
    episodeId: episode.id,
    attemptNo: 1,
    descriptionSent: 'price broke',
    cliArgvRedacted: 'brightdata scraper heal ... --json',
  });
  await settleAttempt(db, {
    attemptId: attempt.id,
    decision: 'REJECTED',
    canaryFhs: 0.4,
    rejectionReason: 'canary below the gate',
  });

  // A rejected fix never reached the collector, so the history before it is still about this one.
  assert.equal(await trailingMedianRowCount(db, collector.id, 5), 144);
});

test('a heal on ANOTHER collector does not truncate this one’s history', async () => {
  const other = await seedCollector(db, { collector_id: 'c_other', name: 'other' });
  await run(144, 60);
  await run(144, 50);

  const episode = await openEpisode(db, {
    collectorId: other.id,
    workspaceId: other.workspace_id,
    trigger: 'BROKEN',
    authorisedBy: 'AUTONOMOUS',
    fhsBefore: 0,
    failedFields: ['price'],
    snapshotBefore: [],
  });
  const attempt = await recordAttempt(db, {
    episodeId: episode.id,
    attemptNo: 1,
    descriptionSent: 'unrelated',
    cliArgvRedacted: 'brightdata scraper heal ... --json',
  });
  await settleAttempt(db, { attemptId: attempt.id, decision: 'APPROVED', canaryFhs: 1 });

  assert.equal(await trailingMedianRowCount(db, collector.id, 5), 144);
});

test('unhealthy runs after a heal still do not count', async () => {
  // The self-lowering bar the original HEALTHY-only rule exists to prevent, unchanged by the new
  // boundary: a broken run must never become the baseline that makes brokenness look normal.
  await committedHeal(60);
  await run(3, 50, 'BROKEN');
  await run(3, 40, 'DEGRADED');

  assert.equal(await trailingMedianRowCount(db, collector.id, 5), null);
});
