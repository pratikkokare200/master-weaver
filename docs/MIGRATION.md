# Moving the ledger to hosted Supabase

The local ledger is not test data. It holds every run since 2026-08-19, five healing episodes, three
Bright Data heal attempts with their canary scores and their verdicts, and two golden baselines. That
history is the evidence — a dashboard with an empty ledger demonstrates a schema, not an engine.

So this is a migration, not a re-seed. **Do not run `pnpm --filter @weaver/worker seed` against the
cloud database.** Seeding creates the collector rows fresh, and `collectors.collector_id` is unique:
the restore would then fail on a conflict, or worse, succeed against a different collector id than
every run in the history points at.

---

## What moves

| Table | Rows | What it is |
|---|---:|---|
| `collectors` | 2 | `marketplace-listings` (ACTIVE) and `product-reviews` (PAUSED, seeded, never run) |
| `golden_baselines` | 2 | the regression set behind every RESTORED verdict |
| `jobs` | 165 | queue history, all DONE |
| `runs` | 165 | the run ledger, including the full CLI payload per run |
| `healing_episodes` | 5 | 5 QUARANTINED |
| `healing_attempts` | 3 | 3 APPROVED at canary 1.0 |

Counts as of 2026-08-21 16:34 UTC; the script reports its own.

Not moved: nothing else in the database belongs to us. `auth`, `storage` and `realtime` are
Supabase's own schemas and already exist on the destination.

---

## Before you start

**Stop the local worker.** Two workers against one queue is safe for correctness — the claim is
`FOR UPDATE SKIP LOCKED` — but each one bills for its own scrapes, and a local worker still writing
into the local database after the dump means the cloud ledger silently falls behind from the moment
it is created.

```powershell
Get-Process node | Where-Object { $_.Path -like '*Master Weaver*' } | Stop-Process
```

**Pick the right connection string.** Supabase offers three, and they are not interchangeable here:

| | Use it for | Why |
|---|---|---|
| **Session pooler** `aws-…pooler.supabase.com:5432` | the restore, and the worker | IPv4, and it keeps session state |
| **Direct** `db.<ref>.supabase.co:5432` | the worker, if your host has IPv6 | Fly does; a local Docker container usually does not |
| **Transaction pooler** `…:6543` | **neither** | it breaks `FOR UPDATE SKIP LOCKED` claims and prepared statements |

The transaction pooler is the one that looks right and is wrong. The queue claim holds a row lock
across statements inside one transaction, and transaction pooling can hand those statements to
different backends.

---

## 1 · Apply the schema

Every file in `supabase/migrations`, in filename order. They are idempotent (`create table if not
exists`), so re-running one is safe.

```bash
for f in supabase/migrations/*.sql; do
  docker exec -i supabase_db_Master_Weaver \
    psql "$CLOUD_URL" -v ON_ERROR_STOP=1 --single-transaction < "$f"
done
```

`docker exec … psql` rather than a local `psql` for a specific reason: the dump in step 2 is written
by pg_dump 17.6, whose output opens with the `\restrict` meta-command added in the 17.6 security
release. An older psql fails on it with `invalid command \restrict`. The container has a client that
matches its server, so using it removes the version question entirely.

Set `CLOUD_URL` in the shell first, and note that Supabase passwords routinely contain characters
that need percent-encoding in a URI — `@`, `/`, `#`, `?`.

**One migration does not finish by itself.** `0003_readonly_role.sql` creates `weaver_readonly` — the
role text-to-SQL runs on — without a password and unable to log in, because a password does not
belong in a public repository. Give it one, once, per environment:

```sql
alter role weaver_readonly with login password '<generated>';
```

Then set `DATABASE_URL_READONLY` in Vercel to that role's connection string. Until you do, the Chat
panel says it is not configured; it never falls back to `DATABASE_URL`, which is the point (ADR-004).
Through Supavisor the username takes the form `weaver_readonly.<project-ref>`.

## 2 · Dump

```bash
sh scripts/dump-ledger.sh          # -> .scratch/ledger-<utc>.sql
```

Data only, one `pg_dump` invocation, six tables. One invocation because it is one snapshot: six
separate dumps would be six snapshots, and with the cron writing every fifteen minutes a torn dump
can hold a `runs` row whose `job_id` points at a job that had not been captured yet.

The file it writes ends with a row-count assertion generated from its own `COPY` blocks. That check
travels with the file, so verification happens on the destination rather than depending on someone
remembering to count rows afterwards.

## 3 · Restore

```bash
docker exec -i supabase_db_Master_Weaver \
  psql "$CLOUD_URL" -v ON_ERROR_STOP=1 --single-transaction < .scratch/ledger-<utc>.sql
```

`--single-transaction` is not optional. With it, the assertion at the end of the file is inside the
same transaction as the load: a short or duplicated restore rolls back completely, and a failed
migration leaves an empty database rather than a plausible-looking partial one.

Expect six `COPY` lines and a final `DO`. The success notice is suppressed by pg_dump's own
`SET client_min_messages = warning`; silence from the `DO` is the pass. A failure is loud:

```
ERROR:  runs: expected 165 rows, found 164
```

## 4 · Verify

Counts are already asserted, so check the thing counts cannot see — that the values survived:

```bash
docker exec supabase_db_Master_Weaver psql "$CLOUD_URL" -At -c "
  select 'runs ' || md5(string_agg(t::text, '|' order by id)) from runs t
  union all
  select 'episodes ' || md5(string_agg(t::text, '|' order by id)) from healing_episodes t"
```

Run the same query against `postgres` in the local container and compare. The two hashes match
column-for-column, jsonb included.

## 5 · Point the apps at it

```bash
fly secrets set DATABASE_URL="$CLOUD_URL" --config apps/worker/fly.toml
```

And in Vercel, set `DATABASE_URL` for the web app to the same string, then redeploy. The web pool
enables TLS with full verification for any non-local host and does not fall back — which is what you
want against Supabase, and the reason `DATABASE_SSL=false` exists only for a local database reached
through a Docker hostname.

Two more Vercel variables, both for text-to-SQL and both optional — the Chat panel reports itself
unconfigured without them and everything else works:

| | |
|---|---|
| `DATABASE_URL_READONLY` | the `weaver_readonly` connection string from step 1 |
| `GROQ_API_KEY` | https://console.groq.com/keys |

The worker needs neither. It never runs generated SQL.

## 6 · Settle the queue, if the dump warned about it

Every job in the current ledger is `DONE`, so this step is usually a no-op — the dump script prints a
warning at capture time if it is not.

A job captured `PENDING` or `CLAIMED` arrives on the destination as work, and the first cloud worker
to poll will run it: real scrapes, real credits, replaying a backlog that already happened.

```sql
update jobs
   set state = 'FAILED', error = 'abandoned by database migration'
 where state in ('PENDING', 'CLAIMED');
```

`FAILED` rather than deletion, because `runs.job_id` references these rows and the run history should
keep pointing at the job that produced it.

---

## Verified, not asserted

The sequence above was run end to end on 2026-08-21 against a scratch database in the local
container: both migrations applied, the dump restored under `--single-transaction`, and all six
tables compared by `md5(string_agg(row::text))` against the source. **Identical, every table.**

The assertion was then tested by deleting one row and re-running it, which failed as intended:

```
ERROR:  runs: expected 165 rows, found 164
```

What that does **not** prove: nothing here has run against hosted Supabase. Two differences are
plausible and worth watching for — a server version newer than 17.6 (fine; the dump loads forward),
and a role that is not `postgres` (the dump is `--no-owner --no-privileges`, so it adopts whichever
role runs it).

## If it goes wrong

Nothing here is destructive to the source. The local database is untouched by every step — the dump
reads, the restore writes elsewhere. If the cloud restore fails, fix and repeat; the assertion
guarantees you are never left with a partial ledger to reason about.

To start the destination over:

```sql
truncate collectors cascade;   -- every other table cascades from it
```
