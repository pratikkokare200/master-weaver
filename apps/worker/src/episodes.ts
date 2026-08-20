/**
 * Ledger writes for the healing tables: `healing_episodes`, `healing_attempts`, `golden_baselines`.
 *
 * Kept apart from `ledger.ts`, which owns collectors and runs. The split is not filing — these
 * tables carry the audit trail the product's whole claim rests on, and they follow one rule the run
 * tables do not need quite so sharply:
 *
 *   **Every row is written BEFORE the CLI call it describes** (doc 03 §4). An episode interrupted by
 *   a crash is still auditable up to the point of failure. A `healing_attempts` row that appeared
 *   only after `scraper heal` returned would leave the most expensive and least reversible call in
 *   the system with no record that it was ever made.
 *
 * The tables are append-only in spirit: attempts are inserted open and closed with their decision,
 * episodes are opened with what was known and closed with what was learned. Nothing is deleted, and
 * no row is rewritten to say something different from what it originally said.
 */

import type {
  EpisodeAuthorisedBy,
  EpisodeFinalState,
  EpisodeTriggerReason,
  GoldenSetShape,
  ListingBaselineSummary,
  ScrapedRow,
} from '@weaver/contracts';

import type { Queryable } from './db.js';

// ---------------------------------------------------------------------------------------------
// healing_episodes
// ---------------------------------------------------------------------------------------------

export interface EpisodeRow {
  id: string;
  collector_id: string;
  workspace_id: string;
  trigger_reason: EpisodeTriggerReason;
  authorised_by: EpisodeAuthorisedBy;
  fhs_before: number;
  attempt_count: number;
}

export interface OpenEpisodeInput {
  collectorId: string;
  workspaceId: string;
  trigger: EpisodeTriggerReason;
  authorisedBy: EpisodeAuthorisedBy;
  fhsBefore: number;
  failedFields: string[];
  /** Last-known-good sample. Snapshot before every heal, unconditionally (doc 01 §8). */
  snapshotBefore: unknown;
  /** Set on the operator path: when the human was asked. Null on the autonomous path. */
  operatorPromptedAt?: Date | null;
  /** Set on the operator path: when the human answered. */
  operatorActedAt?: Date | null;
}

/**
 * Open an episode. Written before the first CLI call of the repair, never after.
 *
 * `authorised_by` is not free to disagree with `trigger_reason` — the database enforces their
 * equivalence as a CHECK constraint, so a caller that got it wrong fails here rather than putting a
 * misleading row in the audit trail.
 */
export async function openEpisode(db: Queryable, input: OpenEpisodeInput): Promise<EpisodeRow> {
  const { rows } = await db.query<EpisodeRow>(
    `insert into healing_episodes
       (collector_id, workspace_id, trigger_reason, authorised_by, fhs_before,
        failed_fields, snapshot_before, operator_prompted_at, operator_acted_at, triggered_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, now())
     returning id, collector_id, workspace_id, trigger_reason, authorised_by, fhs_before, attempt_count`,
    [
      input.collectorId,
      input.workspaceId,
      input.trigger,
      input.authorisedBy,
      input.fhsBefore,
      JSON.stringify(input.failedFields),
      input.snapshotBefore === undefined ? null : JSON.stringify(input.snapshotBefore),
      input.operatorPromptedAt ?? null,
      input.operatorActedAt ?? null,
    ],
  );

  const episode = rows[0];
  if (!episode) throw new Error('openEpisode inserted no row');
  return episode;
}

export interface CloseEpisodeInput {
  episodeId: string;
  finalState: EpisodeFinalState;
  fhsAfter?: number | null;
  snapshotAfter?: unknown;
  creditsSpent?: number | null;
  durationMs?: number | null;
  attemptCount: number;
}

/** Close an episode with what was learned. One write; an episode is never reopened. */
export async function closeEpisode(db: Queryable, input: CloseEpisodeInput): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `update healing_episodes
        set final_state    = $2,
            fhs_after      = $3,
            snapshot_after = $4::jsonb,
            credits_spent  = $5,
            duration_ms    = $6,
            attempt_count  = $7,
            resolved_at    = now()
      where id = $1
        and final_state is null
    returning id`,
    [
      input.episodeId,
      input.finalState,
      input.fhsAfter ?? null,
      input.snapshotAfter === undefined ? null : JSON.stringify(input.snapshotAfter),
      input.creditsSpent ?? null,
      input.durationMs ?? null,
      input.attemptCount,
    ],
  );

  if (rows.length === 0) {
    throw new Error(`episode ${input.episodeId} was already closed, or does not exist`);
  }
}

/**
 * Heal attempts against a collector in the last rolling 24 hours — the breaker's primary rail.
 *
 * Counts ATTEMPTS, not episodes. Three episodes of one attempt and one episode of three attempts
 * cost the same credits and carry the same risk of mutating a working collector, so the rail has to
 * see them as the same thing.
 */
export async function healAttemptsLast24h(db: Queryable, collectorId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count
       from healing_attempts a
       join healing_episodes e on e.id = a.episode_id
      where e.collector_id = $1
        and a.created_at > now() - interval '24 hours'`,
    [collectorId],
  );
  return rows[0]?.count ?? 0;
}

/** The open episode for a collector, if one is in flight. At most one exists — see the partial index. */
export async function openEpisodeFor(db: Queryable, collectorId: string): Promise<EpisodeRow | null> {
  const { rows } = await db.query<EpisodeRow>(
    `select id, collector_id, workspace_id, trigger_reason, authorised_by, fhs_before, attempt_count
       from healing_episodes
      where collector_id = $1 and final_state is null
      order by triggered_at desc
      limit 1`,
    [collectorId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// healing_attempts
// ---------------------------------------------------------------------------------------------

export interface AttemptRow {
  id: string;
  episode_id: string;
  attempt_no: number;
}

export interface RecordAttemptInput {
  episodeId: string;
  attemptNo: number;
  /** The exact string sent to `scraper heal`. Capped at 1000 by the column, matching the CLI. */
  descriptionSent: string;
  /** The exact argv with the key redacted. Reproducibility is the point (doc 01 §6.2). */
  cliArgvRedacted: string;
}

/**
 * Insert an attempt in its OPEN state — before the heal call, with no decision yet.
 *
 * The decision is a separate write precisely because the gap between these two is where the money is
 * spent and where a crash is most damaging. An attempt row with a null decision is a readable state:
 * "we asked for a fix and never recorded what we did with it", which is exactly what happened.
 */
export async function recordAttempt(db: Queryable, input: RecordAttemptInput): Promise<AttemptRow> {
  const { rows } = await db.query<AttemptRow>(
    `insert into healing_attempts
       (episode_id, attempt_no, description_sent, cli_argv_redacted, created_at)
     values ($1, $2, $3, $4, now())
     returning id, episode_id, attempt_no`,
    [input.episodeId, input.attemptNo, input.descriptionSent, input.cliArgvRedacted],
  );

  const attempt = rows[0];
  if (!attempt) throw new Error('recordAttempt inserted no row');
  return attempt;
}

export interface SettleAttemptInput {
  attemptId: string;
  canarySample?: unknown;
  canaryFhs?: number | null;
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  stderrExcerpt?: string | null;
}

/** Close an attempt with the canary, its score, and the decision that score justified. */
export async function settleAttempt(db: Queryable, input: SettleAttemptInput): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `update healing_attempts
        set canary_sample    = $2::jsonb,
            canary_fhs       = $3,
            decision         = $4,
            rejection_reason = $5,
            stderr_excerpt   = $6
      where id = $1
        and decision is null
    returning id`,
    [
      input.attemptId,
      input.canarySample === undefined ? null : JSON.stringify(input.canarySample),
      input.canaryFhs ?? null,
      input.decision,
      input.rejectionReason ?? null,
      input.stderrExcerpt ?? null,
    ],
  );

  if (rows.length === 0) {
    throw new Error(`attempt ${input.attemptId} was already settled, or does not exist`);
  }
}

/** Rejections recorded so far in an episode — the per-episode breaker rail. */
export async function rejectionsInEpisode(db: Queryable, episodeId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count
       from healing_attempts
      where episode_id = $1 and decision = 'REJECTED'`,
    [episodeId],
  );
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------------------------
// golden_baselines
// ---------------------------------------------------------------------------------------------

export interface BaselineRow {
  id: string;
  collector_id: string;
  url: string;
  baseline_row: ScrapedRow | ListingBaselineSummary;
  shape: GoldenSetShape;
}

/** Every pinned baseline for a collector, in the order the golden set declares them. */
export async function getBaselines(db: Queryable, collectorId: string): Promise<BaselineRow[]> {
  const { rows } = await db.query<BaselineRow>(
    `select id, collector_id, url, baseline_row, shape
       from golden_baselines
      where collector_id = $1
      order by url`,
    [collectorId],
  );
  return rows;
}

/**
 * Write or refresh one pinned baseline.
 *
 * **Only ever call this from a HEALTHY run**, and never post-heal until the episode reaches
 * RESTORED. Refreshing from a degraded or freshly-repaired run ratchets the quality bar down to meet
 * whatever the collector currently manages, which is how these systems rot in production
 * (doc 01 §3.4). The rule is not enforceable in SQL, so it lives here and at every call site.
 */
export async function upsertBaseline(
  db: Queryable,
  input: {
    collectorId: string;
    url: string;
    baseline: ScrapedRow | ListingBaselineSummary;
    shape: GoldenSetShape;
  },
): Promise<void> {
  await db.query(
    `insert into golden_baselines (collector_id, url, baseline_row, shape, captured_at)
     values ($1, $2, $3::jsonb, $4, now())
     on conflict (collector_id, url) do update
        set baseline_row = excluded.baseline_row,
            shape        = excluded.shape,
            captured_at  = excluded.captured_at`,
    [input.collectorId, input.url, JSON.stringify(input.baseline), input.shape],
  );
}

/** The most recent HEALTHY run's rows — the last-known-good snapshot for an episode and its diagnosis. */
export async function lastHealthyRows(
  db: Queryable,
  collectorId: string,
): Promise<{ rows: unknown[]; fhs: number | null } | null> {
  const { rows } = await db.query<{ rows: unknown[]; fhs: string | number | null }>(
    `select "rows", fhs
       from runs
      where collector_id = $1
        and run_state = 'HEALTHY'
        and finished_at is not null
      order by started_at desc
      limit 1`,
    [collectorId],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    rows: Array.isArray(row.rows) ? row.rows : [],
    fhs: row.fhs === null ? null : Number(row.fhs),
  };
}

/**
 * Record that an attempt never reached a decision.
 *
 * The heal call errored, or came back without a gate to stand at. The row keeps its null `decision`,
 * which reads exactly as what happened — "we asked for a fix and never got one to judge" — and gains
 * the argv and stderr that explain why. Writing a decision here would be a lie: nothing was approved
 * and nothing was rejected.
 */
export async function noteAttemptFailure(
  db: Queryable,
  input: { attemptId: string; cliArgvRedacted?: string | null; stderrExcerpt?: string | null },
): Promise<void> {
  await db.query(
    `update healing_attempts
        set cli_argv_redacted = coalesce($2, cli_argv_redacted),
            stderr_excerpt    = $3
      where id = $1`,
    [input.attemptId, input.cliArgvRedacted ?? null, input.stderrExcerpt ?? null],
  );
}
