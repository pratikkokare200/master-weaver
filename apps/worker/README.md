# @weaver/worker

Layer C, the autonomous engine. A standalone long-running Node process with a queue poller and a
30-minute cron, and no inbound HTTP surface at all.

**Not a Next.js route handler**, deliberately. A healing episode runs 30 to 60 seconds and Vercel
terminates a serverless function well before that, so a repair interrupted halfway would leave a
collector in an unknown state (ADR-001). Having no HTTP surface also makes this the easiest possible
thing to deploy: one process, one command, on Railway, Fly or Render.

## What it does today

```
poll loop   every 10s   claim a due job with FOR UPDATE SKIP LOCKED, run it, write the ledger row
cron loop   every 30m   enqueue one `scheduled` job per ACTIVE collector
```

One job is: **run the scraper, score the result, record the run**.

```
RUNNING --> VALIDATING --> HEALTHY | DEGRADED | BROKEN
RUNNING --> TRANSIENT_RETRY                       (the CLI call itself failed)
```

**And it stops there.** Nothing here diagnoses, heals, approves or opens a healing episode. A run
that lands in DEGRADED or BROKEN is written to the ledger, logged at `warn`, and left alone. That is
not an oversight to be filled in passing: DEGRADED must never trigger a repair unattended (architect
decision 3, locked 2026-08-12), and the gate that decides otherwise belongs to the healing layer.

## Running it

```bash
cp .env.example .env          # DATABASE_URL and BRIGHTDATA_API_KEY are the only required values
pnpm --filter @weaver/worker build
pnpm --filter @weaver/worker start
```

Apply `supabase/migrations/0001_initial_schema.sql` first — `supabase db push`, or paste it into the
SQL editor. It is idempotent (`create table if not exists` throughout).

Exit codes: `0` clean shutdown · `78` EX_CONFIG, bad environment · `69` EX_UNAVAILABLE, database
unreachable at boot · `1` crash, or a shutdown that had to be forced.

## Why node-postgres and not supabase-js

The queue claim is `SELECT ... FOR UPDATE SKIP LOCKED`, and PostgREST cannot express a locking
clause. Doc 03 section 3.4 and ADR-001 specify Postgres-as-queue, so the worker speaks Postgres
directly. The web app is free to use supabase-js for its reads; it never claims a job.

## The claim

The one piece that has to be exactly right under concurrency, so it is one statement:

```sql
update jobs as j set state = 'CLAIMED', attempts = j.attempts + 1, ...
 where j.id = (select id from jobs
                where state = 'PENDING' and scheduled_for <= now()
                order by scheduled_for, id
                  for update skip locked
                limit 1)
returning j.*
```

`FOR UPDATE` locks the row inside the subquery; `SKIP LOCKED` makes a second worker step over it
rather than block. Two workers polling the same instant claim two different jobs and neither waits.
A `SELECT` followed by a separate `UPDATE` would let both read the same id in the gap between the
statements, and both would run the scrape.

Three things fall out of the same design:

- **Backoff is `scheduled_for`.** A transient failure pushes the job into the future, and it is
  simply not due yet. No separate retry table, no in-memory timer to lose on restart.
- **Stale claims are recovered.** A hard kill mid-scrape — an OOM, a redeploy — would otherwise
  strand a job in CLAIMED forever and silently stop monitoring that collector. The reaper requeues
  claims older than `WORKER_CLAIM_TIMEOUT_MS`, or fails them if their attempts are spent.
- **The cron is idempotent.** `NOT EXISTS` means a collector that already has a scheduled job
  outstanding does not get another. If the worker is down for two hours it gets *one* catch-up run,
  not four queued back to back — a history with a gap beats a burst that bills four times.

## Design notes

- **The ledger row precedes the subprocess.** `runs` is inserted in RUNNING *before* the CLI is
  spawned (doc 03 section 4), so a crash mid-scrape is still auditable, and the dashboard can show a
  scrape in progress rather than only its result.
- **Transitions are checked twice.** `isLegalTransition` rejects an edge the frozen state machine
  does not have, and the `where run_state = $from` predicate makes the write conditional on the row
  still being where we think it is.
- **The cron aligns to the wall clock**, not to process start: ticks land on :00 and :30 whether the
  worker booted at 14:03 or 14:29. Doc 03 section 8 lists a gap-free five-day price history as
  demo-critical, and a restart should not shift the whole series.
- **The golden penalty is omitted, not zeroed.** There is no golden-set confirmation run yet, and
  `goldenSetMatchRate: 0` would score every healthy run at 0. Absent means "not measured".
- **The trailing median comes from HEALTHY runs only.** Folding in the runs where a collector
  returned three rows would drag the baseline down to meet the breakage — the same self-lowering bar
  doc 01 section 3.4 warns about for golden baselines.
- **An unparseable contract fails the job before the CLI is called.** Running would still cost
  credits for rows that could not be validated against anything.

## Tests

```bash
pnpm --filter @weaver/worker test
```

57 tests. The database is real: PGlite is Postgres compiled to WASM, so the migration and the SQL in
`src/queue.ts` are executed by an actual Postgres parser and planner rather than compared against
expected strings. The tests import the compiled `dist/` modules, so what they prove correct is what
the worker ships. Only the Bright Data client is faked — a real one spawns a subprocess and bills
credits.

The one thing this cannot prove is concurrency: PGlite is single-connection, so `SKIP LOCKED` parses
and executes but never actually skips a peer's lock. That behaviour is Postgres's; what is ours is
the shape of the statement.

### The smoke test

```bash
pnpm --filter @weaver/worker smoke
```

The unit suite proves each module. This proves the *program*: it serves PGlite over a TCP socket so
node-postgres connects by the real wire protocol, points `BRIGHTDATA_CLI_BIN` at a fake shim so the
adapter spawns a real subprocess without spending credits, launches `dist/index.js` as a separate
process, and then reads the ledger to see what the worker actually did — cron tick, claim, run,
score, `jobs.state = 'DONE'`, and no API key anywhere in the logs.

Graceful shutdown is covered by `test/lifecycle.test.mjs` rather than by the smoke test: Windows has
no real POSIX signals, and `child.kill('SIGTERM')` there terminates the process without running its
handler, so a signal-based assertion would prove nothing on this machine.

## Autostart

`scripts/boot-worker.ps1` brings the worker up after a reboot, registered as a Scheduled Task. It
waits for the Docker daemon, confirms Postgres answers, and then runs the worker in the foreground
so the task's lifetime *is* the worker's lifetime — which is what makes Task Scheduler's
restart-on-failure meaningful. A task that spawned the worker detached and exited would report
success while the worker was dead.

Two things it deliberately does not do:

* **It does not run `supabase start` unconditionally.** Docker Desktop restarts its containers at
  logon, so the usual case needs no intervention. The CLI responds to one unhealthy container by
  stopping the entire stack, database included — so running it against a healthy stack risks
  destroying the thing the script exists to guarantee. It runs only if `pg_isready` fails.

* **It does not spawn via WMI.** `Win32_Process.Create` is the way to escape a *calling shell's*
  Job Object; Task Scheduler imposes no such constraint, and spawning that way would hand back a
  process Task Scheduler could neither stop nor restart.

The trigger is **logon, not startup**. Docker Desktop runs in a user session, so a boot-triggered
task would wait for a daemon that is not coming until someone logs in. For the same reason the task
runs as the interactive user rather than `SYSTEM`: `SYSTEM` cannot reach Docker Desktop's per-user
named pipe. Registration therefore needs no elevation.

Requires *Start Docker Desktop when you log in* to be enabled (Docker Desktop → Settings → General).

Logs land in `.logs/` (gitignored): `boot.log` for the startup sequence, `worker.log` and
`worker.err.log` for the worker itself.
