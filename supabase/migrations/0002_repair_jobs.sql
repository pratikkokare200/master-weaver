-- ============================================================================================
-- 0002 — the operator-authorised repair job.
--
-- Doc 01 §2.2: `PENDING_OPERATOR --> DIAGNOSING : operator clicks Repair AND breaker allows`.
--
-- That click has to cross a process boundary. The Observation Deck cannot run a healing episode
-- itself — a full episode takes 30 to 60 seconds and Vercel terminates a request long before that
-- (ADR-001) — so the click has to become work the worker picks up. The queue already exists and
-- already has the right semantics (FOR UPDATE SKIP LOCKED, attempt limits, dead-claim recovery),
-- so the click becomes a job rather than a second mechanism.
--
-- `repair` is the fourth kind. Unlike the other three it does NOT scrape: the rows it needs are
-- already stored on the run sitting in PENDING_OPERATOR, and re-scraping would spend credits to
-- re-derive a break we have already measured, with a real chance of measuring something different.
-- ============================================================================================

alter table jobs drop constraint if exists jobs_kind_check;

alter table jobs
  add constraint jobs_kind_check
  check (kind in ('manual', 'scheduled', 'confirmation', 'repair'));

-- A collector may have at most one repair outstanding. Two operators clicking the same button, or
-- one operator clicking it twice, must not open two episodes against the same collector: the heal
-- calls would race on a single Bright Data collector, and the partial index on
-- `healing_episodes (collector_id) where final_state is null` would reject the second episode
-- halfway through — after the credits were spent.
create unique index if not exists jobs_one_open_repair_per_collector
  on jobs (collector_id)
  where kind = 'repair' and state in ('PENDING', 'CLAIMED');

comment on index jobs_one_open_repair_per_collector is
  'One outstanding repair per collector. The approval route relies on this to make a double click idempotent.';
