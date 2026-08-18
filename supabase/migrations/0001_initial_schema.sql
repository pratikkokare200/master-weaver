-- ============================================================================================
-- 0001_initial_schema — the ledger.
--
-- Six tables, a direct transcription of doc 03 section 4 and the row types in
-- `@weaver/contracts/db.ts`. Column names are the TypeScript field names verbatim, so a row
-- selected here assigns to `Collector` / `Job` / `Run` / ... without a mapping layer. If you rename
-- a column, rename the interface field in the same commit or the worker reads undefined and writes
-- nulls.
--
-- Two conventions worth knowing before you read on:
--
--   * `collectors.id` is OUR primary key. `collectors.collector_id` is BRIGHT DATA's id (c_...),
--     which is a different thing that unfortunately reads the same. Every child table's
--     `collector_id` column is a foreign key to `collectors.id` -- our uuid, not Bright Data's.
--     The worker passes `collectors.collector_id` to the CLI and `collectors.id` to the database.
--
--   * Enumerations are `text` + CHECK, not Postgres enum types. The lists below are copied from
--     the frozen const arrays in `@weaver/contracts`, and a text column round-trips to a TS string
--     union with no driver mapping. Keep the two in sync: contracts is the source of truth.
--
-- Ledger integrity rule (doc 03 section 4): every state transition writes its row *before* the next
-- CLI call is made, so an episode interrupted by a crash is still auditable up to the point of
-- failure. The worker honours this by inserting the `runs` row in RUNNING before it spawns the CLI.
-- ============================================================================================

-- gen_random_uuid() is core Postgres since PG13, so no pgcrypto extension is required. Supabase
-- has shipped PG15+ for years; if you target something older, add `create extension pgcrypto`.

-- ============================================================================================
-- collectors
-- ============================================================================================

create table if not exists collectors (
  id            uuid primary key default gen_random_uuid(),

  -- No workspaces table exists yet (there is no auth in the six). Deliberately unconstrained:
  -- add the FK in the migration that introduces workspaces.
  workspace_id  uuid        not null,

  -- Bright Data's collector id, e.g. c_mswyapbp22wiwv8fhh. Unique because it is what every CLI
  -- call is addressed to -- two rows pointing at one collector would race each other's heals.
  collector_id  text        not null unique,

  name          text        not null,
  target_url    text        not null,

  -- The user's original sentence -- what the contract was inferred from. Capped at the CLI's own
  -- `scraper create <url> <description>` limit (CLI_INPUT_LIMITS.INTENT_CHARS).
  intent_prompt text        not null check (char_length(intent_prompt) <= 500),

  -- The per-collector validation contract, doc 01 section 3.1. Validated with
  -- `CollectorContractSchema` on read -- it is LLM output, so it stays untrusted even after a round
  -- trip through the database.
  contract      jsonb       not null,

  -- COLLECTOR_STATUSES
  status        text        not null default 'CREATING'
                            check (status in ('CREATING', 'ACTIVE', 'PAUSED', 'QUARANTINED', 'FAILED')),

  created_at    timestamptz not null default now()
);

-- The cron sweeps active collectors every 30 minutes; this is the index it rides.
create index if not exists collectors_active_idx on collectors (status) where status = 'ACTIVE';
create index if not exists collectors_workspace_idx on collectors (workspace_id);

-- ============================================================================================
-- golden_baselines -- the regression test. Without it, RESTORED is an unverified claim.
-- ============================================================================================

create table if not exists golden_baselines (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid        not null references collectors (id) on delete cascade,

  -- The pinned URL this baseline was captured from. Size is min(3, available) -- creation NEVER
  -- fails for having too few (doc 01 section 3.4), so no minimum is enforced here.
  url          text        not null,

  -- `detail` shape: one ScrapedRow. `listing` shape: a ListingBaselineSummary -- row count, field
  -- shape across rows, and the first N rows by a stable key. One column, two payloads, because a
  -- listing collector has one URL and cannot assert three individual products.
  baseline_row jsonb       not null,

  -- GOLDEN_SET_SHAPES
  shape        text        not null check (shape in ('detail', 'listing')),

  captured_at  timestamptz not null default now(),

  -- One baseline per pinned URL. A refresh is an upsert on this key, never an append -- otherwise
  -- "refresh on every HEALTHY run" would grow unbounded.
  unique (collector_id, url)
);

create index if not exists golden_baselines_collector_idx on golden_baselines (collector_id);

-- ============================================================================================
-- jobs -- the queue. Claimed with FOR UPDATE SKIP LOCKED (doc 03 section 3.4, ADR-001).
-- ============================================================================================

create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  collector_id  uuid        not null references collectors (id) on delete cascade,

  -- JOB_KINDS. `confirmation` is the post-approval golden-set run that decides RESTORED vs
  -- QUARANTINED; the worker does not enqueue those yet.
  kind          text        not null check (kind in ('manual', 'scheduled', 'confirmation')),

  -- JOB_STATES. NOTE: the states are PENDING/CLAIMED/DONE/FAILED, per `@weaver/contracts`.
  -- If you came looking for `queued`, this is it under its frozen name.
  state         text        not null default 'PENDING'
                            check (state in ('PENDING', 'CLAIMED', 'DONE', 'FAILED')),

  -- Incremented on each claim, so a job that keeps killing its worker is visible as such and can be
  -- abandoned rather than retried forever.
  attempts      integer     not null default 0 check (attempts >= 0),

  -- Queue order, and the backoff mechanism: a transient failure reschedules by pushing this out.
  scheduled_for timestamptz not null default now(),

  claimed_at    timestamptz,
  -- Worker instance id holding the claim, e.g. host#pid#ab12cd. Text, not a FK -- workers are
  -- processes, not rows.
  claimed_by    text,
  error         text,

  -- A claim records who and when, or it is not a claim. An implication rather than an equivalence:
  -- DONE and FAILED rows keep claimed_by/claimed_at as the audit trail of which worker ran them,
  -- and the stale-claim reaper depends on claimed_at being present for everything CLAIMED.
  constraint jobs_claim_is_complete check (
    state <> 'CLAIMED' or (claimed_at is not null and claimed_by is not null)
  )
);

-- The poller's index. Partial on PENDING because that is the only state it scans, so the queue's
-- hot set stays small even as DONE rows accumulate into history.
create index if not exists jobs_queue_idx on jobs (scheduled_for, id) where state = 'PENDING';

-- The stale-claim reaper's index: find claims older than the claim timeout.
create index if not exists jobs_claimed_idx on jobs (claimed_at) where state = 'CLAIMED';

create index if not exists jobs_collector_idx on jobs (collector_id, kind, state);

-- ============================================================================================
-- runs
-- ============================================================================================

create table if not exists runs (
  id           uuid primary key default gen_random_uuid(),
  collector_id uuid        not null references collectors (id) on delete cascade,

  -- Null for runs not driven by the queue (e.g. an inline first run at creation). ON DELETE SET
  -- NULL rather than CASCADE: pruning the queue must never delete the run history it produced.
  job_id       uuid        references jobs (id) on delete set null,

  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  -- The rows exactly as the CLI returned them, unmodified. ROWS is non-reserved in PostgreSQL but
  -- reserved in the SQL standard, so the column is double-quoted everywhere it appears.
  "rows"       jsonb       not null default '[]'::jsonb,
  row_count    integer     not null default 0 check (row_count >= 0),

  -- Final, penalty-adjusted FHS. Null while the run is still in flight. numeric(7,6) holds the
  -- scorer's six decimal places exactly; the check is what stops a penalty bug writing 1.4.
  fhs          numeric(7, 6) check (fhs >= 0 and fhs <= 1),

  -- Per-field detail behind `fhs` -- an array of FieldScore. This is what the ledger expands into
  -- "price filling 30%", so it is stored per run rather than recomputed.
  field_scores jsonb,

  -- RUN_STATES -- all 17.
  run_state    text        not null
                           check (run_state in (
                             'IDLE', 'QUEUED', 'RUNNING', 'VALIDATING', 'HEALTHY', 'TRANSIENT_RETRY',
                             'DEGRADED', 'BROKEN', 'PENDING_OPERATOR', 'DIAGNOSING', 'HEALING',
                             'AWAITING_APPROVAL', 'CANARY_VALIDATING', 'APPROVING', 'REJECTING',
                             'RESTORED', 'QUARANTINED'
                           )),

  credits_spent numeric(12, 4) check (credits_spent >= 0)
);

-- The dashboard's primary read: latest runs for a collector. Also the query behind the trailing
-- median row count that the FHS row penalty needs.
create index if not exists runs_collector_started_idx on runs (collector_id, started_at desc);
create index if not exists runs_job_idx on runs (job_id);

-- ============================================================================================
-- healing_episodes
-- ============================================================================================

create table if not exists healing_episodes (
  id                   uuid primary key default gen_random_uuid(),
  collector_id         uuid        not null references collectors (id) on delete cascade,
  workspace_id         uuid        not null,

  triggered_at         timestamptz not null default now(),
  -- Null while the episode is still running.
  resolved_at          timestamptz,

  -- EPISODE_FINAL_STATES. DISMISSED is the PENDING_OPERATOR -> IDLE path: the operator declined.
  final_state          text        check (final_state in ('RESTORED', 'QUARANTINED', 'DISMISSED')),

  -- EPISODE_TRIGGER_REASONS / EPISODE_AUTHORISERS.
  trigger_reason       text        not null check (trigger_reason in ('DEGRADED', 'BROKEN')),
  authorised_by        text        not null check (authorised_by in ('AUTONOMOUS', 'OPERATOR')),

  -- Both null on the autonomous path -- nobody was asked.
  operator_prompted_at timestamptz,
  operator_acted_at    timestamptz,

  fhs_before           numeric(7, 6) not null check (fhs_before >= 0 and fhs_before <= 1),
  -- Null unless the episode reached RESTORED.
  fhs_after            numeric(7, 6) check (fhs_after >= 0 and fhs_after <= 1),

  -- Contract fields that fell below min_fill -- what the diagnosis was written about. Stored as
  -- jsonb so it round-trips to string[] alongside the other jsonb payloads.
  failed_fields        jsonb       not null default '[]'::jsonb,

  -- EpisodeSnapshot: what the collector produced when it broke, and after the repair was confirmed.
  snapshot_before      jsonb,
  snapshot_after       jsonb,

  credits_spent        numeric(12, 4) check (credits_spent >= 0),
  duration_ms          integer     check (duration_ms >= 0),

  -- Number of healing_attempts rows -- the "attempt 2 of 3" counter.
  attempt_count        integer     not null default 0 check (attempt_count >= 0),

  -- Severity gates autonomy, and there is no per-workspace toggle (architect decision 3, locked
  -- 2026-08-12). BROKEN heals unattended; DEGRADED waits for a click. Enforced here so that no code
  -- path can quietly write an autonomous DEGRADED episode.
  constraint healing_episodes_severity_gates_autonomy check (
    (trigger_reason = 'BROKEN') = (authorised_by = 'AUTONOMOUS')
  )
);

create index if not exists healing_episodes_collector_idx
  on healing_episodes (collector_id, triggered_at desc);
create index if not exists healing_episodes_open_idx
  on healing_episodes (collector_id) where final_state is null;

-- ============================================================================================
-- healing_attempts -- one row per heal attempt.
--
-- Not merge-able into healing_episodes: a single episode row can only ever record a success. The
-- "attempt 1 rejected, attempt 2 approved" ledger entry -- doc 04 Beat 5e's strongest ten seconds --
-- does not exist without this table (doc 03 section 4).
-- ============================================================================================

create table if not exists healing_attempts (
  id                uuid primary key default gen_random_uuid(),
  episode_id        uuid        not null references healing_episodes (id) on delete cascade,

  attempt_no        integer     not null check (attempt_no >= 1),

  -- The exact diagnosis sent to `scraper heal`, verbatim. Capped at the CLI's own limit
  -- (CLI_INPUT_LIMITS.DIAGNOSIS_CHARS) so an over-long prompt fails here, not at the subprocess.
  description_sent  text        not null check (char_length(description_sent) <= 1000),

  -- The preview_result the CLI returned at the approval gate -- the canary sample.
  canary_sample     jsonb,

  -- The canary's score against the same contract that caught the break: the number that justified
  -- the decision. Null only if the heal call errored before returning a sample.
  canary_fhs        numeric(7, 6) check (canary_fhs >= 0 and canary_fhs <= 1),

  -- ATTEMPT_DECISIONS. Null while the attempt is still at the gate.
  decision          text        check (decision in ('APPROVED', 'REJECTED')),
  rejection_reason  text,

  -- The exact argv with the API key redacted. Reproducibility is the point.
  cli_argv_redacted text        not null,
  stderr_excerpt    text,

  created_at        timestamptz not null default now(),

  unique (episode_id, attempt_no)
);

create index if not exists healing_attempts_episode_idx
  on healing_attempts (episode_id, attempt_no);

-- ============================================================================================
-- Row-level security
--
-- Deliberately NOT enabled. RLS with no policies denies every read, which would silently break the
-- Observation Deck the moment this migration lands. There is no auth and no workspaces table yet,
-- so there is nothing to write a policy against: workspace_id is a bare uuid today.
--
-- The worker connects with the service role / direct connection string and bypasses RLS regardless.
-- Enabling it belongs in the migration that introduces workspace auth, together with its policies.
-- ============================================================================================
