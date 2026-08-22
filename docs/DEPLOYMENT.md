# Deployment

**§1–8 are the worker (Layer C) on Railway. §9 is the web app (Layer A) on Vercel.** They share a
database and nothing else — neither deploy can break the other, and the worker keeps collecting
through a failed web deploy.

## The worker

Layer C is a long-running Node process with no HTTP surface. It polls a Postgres queue, runs a
wall-clock-aligned cron, and spawns the Bright Data CLI as a subprocess. That shape rules out
serverless entirely — a heal can take 300 seconds and the process must survive between jobs.

**Target: Railway.** The image is a plain Dockerfile with nothing platform-specific in it, so §7
covers Fly and Render if that ever changes.

---

## 1 · Railway, and what it costs

Fly was the recommendation on one axis: `kill_timeout` goes to 300 seconds, and Railway's stop grace
is fixed at roughly 30. Railway was chosen for operational familiarity, which is a real
consideration — the platform you already know is the one where you can diagnose a bad deploy at
midnight.

Here is exactly what the shorter grace costs, so the trade is a known one rather than a vague one.

The worker's contract on `SIGTERM` is: stop claiming new work, let the job already in flight finish,
then exit. `WORKER_SHUTDOWN_GRACE_MS` is how long it waits before forcing that exit. The default,
240 seconds, outlasts the CLI's own 180-second run timeout, so an in-flight job always finishes.

On Railway that default is worse than useless. The platform sends `SIGKILL` about 30 seconds after
`SIGTERM`, so a worker still waiting out its 240 is killed outright — **with no shutdown log line at
all**. A forced exit at least records that it happened; a `SIGKILL` records nothing.

So the grace is set to **25 seconds**, inside Railway's window, and the worker exits on its own
terms and says so.

### What actually happens when a deploy interrupts a job

| | |
|---|---|
| Nothing in flight | The loops drain immediately. **Measured: 695 ms, exit 0.** |
| A scrape in flight | Abandoned at 25 s. `runs` stuck RUNNING, `jobs` stuck CLAIMED, recovered by the stale-claim reaper after 600 s |
| A heal in flight | Same, and worse: the credit is spent and the episode has no verdict until the reaper |

**How often is that?** The cron fires every 15 minutes and a run takes about 7 seconds, so a deploy
lands during a scrape roughly 0.8% of the time. Heals are rarer still. Most deploys will look like
the first row.

Nothing is silently lost in any of them — every ledger row is written before the call it describes,
so an interrupted episode stays auditable up to the point of failure. "Recoverable" and "correct"
are still different standards, and this is the one place we accept the weaker one.

### The worker warns if you forget

Because the whole trade-off rests on one environment variable, forgetting it is the expensive
mistake. The worker detects Railway from the variables the platform injects and says so at boot,
before anything else competes for the log:

```
{"level":"warn","msg":"WORKER_SHUTDOWN_GRACE_MS is 240000ms, but Railway sends SIGKILL about 30s
after SIGTERM. The in-flight job will be killed without a shutdown log line. Set
WORKER_SHUTDOWN_GRACE_MS=25000 so the worker exits on its own terms inside that window."}
```

A warning rather than a refusal to start: the worker still runs correctly, only its shutdown is
worse than it thinks.

---

## 2 · What is in the repo

```
apps/worker/Dockerfile     multi-stage, provider-neutral, builds from the REPO ROOT
railway.toml               build and deploy config, at the root because that is where Railway looks
apps/worker/fly.toml       the alternative, kept — see §7
.dockerignore              secrets and host node_modules excluded from the build context
```

### Verified

| | |
|---|---|
| Image | **85 MB**, 7 layers |
| Runtime dependencies | `@brightdata/cli`, `@weaver/*`, `pg` — nothing else |
| Bright Data CLI | 0.3.5, pinned exactly, runs inside the image |
| Boot | connects to Postgres, schedules the cron, starts the poll loop |
| `SIGTERM` at 25 s grace | graceful shutdown runs, **exit 0 in 695 ms** |
| The Railway warning | fires in the container, first line |

`docker images` reports 361 MB for this image. That is the manifest list plus build attestations,
not the runtime image; `docker image inspect --format '{{.Size}}'` gives the real 85 MB.

### Two build details worth knowing

**`pnpm deploy --legacy`, not `pnpm install --prod`.** A `--prod` install unlinks dev dependencies
but leaves their contents in the virtual store — 90 MB here, most of it PGlite, the WASM Postgres the
tests run against. Unreachable from the worker, still in every layer. `deploy` writes a
self-contained tree instead: what comes out is what the process can actually load.

**Exec-form `CMD`.** So node is PID 1 and receives `SIGTERM` directly. Wrapped in a shell it would
not, and the graceful shutdown would never run — which on a 30-second platform means every deploy
becomes a hard kill.

---

## 3 · Deploy, step by step

### Before you start: stop the local worker

Two workers against one queue is safe for correctness — the claim is `FOR UPDATE SKIP LOCKED` and
the cron's `INSERT` is guarded by `NOT EXISTS` — but each one bills for its own scrapes, and if they
point at different databases the two ledgers diverge silently.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*Master Weaver*worker*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId }
```

Confirm it is down before continuing — the local worker writes to the **local** database, and
anything it records after your dump never reaches the cloud.

### 1 · Create the service

Railway dashboard → **New Project** → **Deploy from GitHub repo** → select this repository.

Railway reads `railway.toml` from the repository root and configures itself: Dockerfile builder,
`apps/worker/Dockerfile`, one replica, restart always, no health check.

**Leave the service's Root Directory unset (`/`).** The worker depends on four workspace packages by
`workspace:*`, so the build context has to be the repo root or the Dockerfile cannot see them. This
is the single most likely way to get a build that fails with `COPY packages/…: not found`.

**Do not generate a domain.** This process opens no port. A domain is harmless but implies an
inbound surface that does not exist.

CLI equivalent, from the repo root:

```bash
railway login
railway init                 # or: railway link   (to an existing project)
```

### 2 · Set the variables

Service → **Variables** → **Raw Editor**, and paste:

```
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
BRIGHTDATA_API_KEY=...
BRIGHTDATA_UNLOCKER_ZONE=chaos_lab_unlocker
WORKER_SHUTDOWN_GRACE_MS=25000
```

Four things about that block:

**The variable is `BRIGHTDATA_API_KEY`,** one word, no underscore between BRIGHT and DATA. The
worker exits **78** at boot on a missing key with a readable message, so a typo here fails
immediately rather than quietly — but it does fail.

**Use the session pooler or the direct connection, never the transaction pooler** (port 6543). The
queue claim holds a row lock across statements inside one transaction, and transaction pooling can
hand those statements to different backends.

**`WORKER_SHUTDOWN_GRACE_MS=25000` is not optional here.** It is the whole of §1.

**The worker needs neither `DATABASE_URL_READONLY` nor `GROQ_API_KEY`.** Those are the web app's, for
text-to-SQL. The worker never runs generated SQL.

Optional, if you want them: `DISCORD_WEBHOOK_URL` and `APP_BASE_URL` for alerts, and
`WORKER_HEALING_ENABLED=false` as a kill switch that leaves collection running.

CLI equivalent — the flag spelling has changed between CLI versions, so check `railway variables
--help` if it rejects this:

```bash
railway variables --set "WORKER_SHUTDOWN_GRACE_MS=25000"
```

### 3 · Deploy

Railway deploys on push once the repo is connected. `railway.toml`'s `watchPatterns` limit that to
commits touching `apps/worker/**`, `packages/**` or the lockfiles — a commit to `apps/web` will not
redeploy the engine, which on a 30-second stop grace matters more than it sounds.

To deploy immediately, from the repo root:

```bash
railway up
```

### 4 · Confirm it is one machine

Service → **Settings** → **Replicas** should read **1**. `railway.toml` sets `numReplicas = 1`, but
check it after the first deploy: two workers double the scrape bill without breaking anything, which
is exactly the kind of problem that goes unnoticed.

---

## 4 · Verifying the deploy

Expected first output, in this order:

```
worker starting … cron_interval_ms=900000 healing_enabled=true
cron scheduled … first_tick_at=…:00:00.000Z
poll loop started … poll_interval_ms=10000
```

If a `warn` line about `WORKER_SHUTDOWN_GRACE_MS` appears above those, step 2 did not take.

Then confirm the thing that actually matters — that the ledger is advancing. Within 15 minutes:

```sql
select max(finished_at), count(*) from runs;
```

A worker that is up but not collecting looks identical to a healthy one from outside. Only the
ledger tells them apart.

**Exit 78** is `EX_CONFIG`: configuration was wrong at boot and the message names the variable.
Restarting will not fix it, and `restartPolicyMaxRetries = 10` means Railway stops trying after ten
attempts and leaves it visibly down rather than looping forever.

---

## 5 · TLS is on by default, and it caught itself

Running the container against a database through `host.docker.internal` failed immediately:

```
cannot reach the database … "The server does not support SSL connections"
```

That is correct behaviour, not a bug. `resolveSsl` turns TLS on with full chain verification for
anything that is not `localhost` or `127.0.0.1`, and it **refused to fall back to plaintext** for a
host it did not recognise as local. A real Supabase URL supports TLS, so Railway is unaffected; only
a local database reached through a Docker hostname needs `DATABASE_SSL=false`.

The general point: a worker that silently downgrades to an unencrypted connection when TLS fails is
worse than one that refuses to start. This one refuses, and says which host it refused.

---

## 6 · Building and running it locally

```bash
docker build -f apps/worker/Dockerfile -t weaver-worker .
```

From the repository root, not from `apps/worker` — same reason the Root Directory has to stay `/`.

To reproduce the Railway environment exactly, including the warning:

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:54322/postgres" \
  -e DATABASE_SSL=false \
  -e BRIGHTDATA_API_KEY="$BRIGHTDATA_API_KEY" \
  -e RAILWAY_ENVIRONMENT=production \
  -e WORKER_SHUTDOWN_GRACE_MS=25000 \
  --name weaver-local weaver-worker
```

`docker stop --timeout 30 weaver-local` in another shell is a faithful rehearsal of a Railway deploy:
same signal, same window.

---

## 7 · If Railway turns out to be wrong

The image is provider-neutral. What changes per host:

**Fly** — `apps/worker/fly.toml` is already written and is the only one of the three that can honour
the full 240-second grace (`kill_timeout` goes to 300 s). Drop `WORKER_SHUTDOWN_GRACE_MS` entirely to
get the default back.

```bash
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
fly secrets set DATABASE_URL=… BRIGHTDATA_API_KEY=… BRIGHTDATA_UNLOCKER_ZONE=…
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly scale count 1 --config apps/worker/fly.toml
```

`--no-deploy` matters: launching and deploying in one step starts a worker before its secrets exist,
and it exits 78.

**Render** — create a **Background Worker**, not a Web Service; a Web Service waits for a port that
never opens. Docker runtime, Dockerfile path `apps/worker/Dockerfile`, build context the repo root.
Keep `WORKER_SHUTDOWN_GRACE_MS=25000` — Render's grace is also about 30 seconds, and the worker warns
there too.

**Anywhere else** — the image needs `DATABASE_URL` and `BRIGHTDATA_API_KEY`, a stop grace as long as
you can get, and a restart-on-exit policy. It writes nothing to disk except stdout, so it needs no
volume.

---

## 8 · Liveness

There is no `HEALTHCHECK` and no `EXPOSE`, deliberately. A worker's health is not a port answering.

What to watch instead:

- **The process is running.** `restartPolicyType = "ALWAYS"` handles the rest; a worker that exits
  has stopped collecting whatever its exit code.
- **The ledger is advancing.** The real health check is a `runs` row every 15 minutes.
  `select max(finished_at) from runs` is the query that matters, and no platform can run it for you.
- **Exit 78** means configuration, not crash. The message says which variable.

---

## 9 · The web app, on Vercel

Layer A is a Next.js App Router build. Every route is `force-dynamic`, so there is no static
prerender and **the build never touches the database** — a missing `DATABASE_URL` fails at request
time, not at build time. Useful to know when reading a red build log: it is never the database.

### Why the default build fails

`apps/web` depends on four workspace packages by `workspace:*`, and each resolves through
`main: ./dist/index.js`:

```
@weaver/contracts     threshold constants        (also in transpilePackages)
@weaver/validation    field scoring
@weaver/textsql       the generated-SQL guard
@weaver/export        CSV and XLSX writers
```

`dist/` is gitignored and no built output is committed, so a bare `next build` in `apps/web` resolves
four imports to files that do not exist. `transpilePackages` does not rescue this — it compiles a
package Next has already resolved, and resolution is what fails.

### The fix

[`apps/web/vercel.json`](../apps/web/vercel.json) overrides the build command:

```json
{
  "framework": "nextjs",
  "buildCommand": "pnpm --filter @weaver/web... build"
}
```

The `...` suffix means "and everything it depends on". pnpm builds the four in topological order and
then runs `next build`, in one command, with no hand-maintained list to drift — add a fifth workspace
dependency and it is picked up automatically. It also excludes `@weaver/brightdata` and
`@weaver/healing`, which are the worker's and would only slow the build.

The filter is deliberately **unquoted**: it contains no shell-special characters, and single quotes
would break `pnpm build:web` on Windows, where npm scripts run through `cmd.exe` and single quotes
are literal characters rather than quoting.

`installCommand` is deliberately **not** set. Vercel detects `pnpm-workspace.yaml` at the repository
root and installs from there, which is correct; overriding it is how that gets broken.

### Dashboard settings

| Setting | Value |
|---|---|
| Root Directory | **`apps/web`** |
| Include files outside the Root Directory | **on** (the default) — the workspace packages live outside it |
| Framework Preset | Next.js (auto-detected) |
| Build / Install / Output | leave blank — `vercel.json` supplies the build, Vercel handles the rest |

### Environment variables

Settings -> Environment Variables. All three are server-side; **none takes a `NEXT_PUBLIC_` prefix**,
which would inline it into the browser bundle.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | session pooler, `postgres.<project-ref>` |
| `DATABASE_URL_READONLY` | Chat only | session pooler, `weaver_readonly.<project-ref>` |
| `GROQ_API_KEY` | Chat only | mark Sensitive |
| `GROQ_MODEL` | no | defaults to `llama-3.3-70b-versatile` |

Through Supavisor the project ref is a suffix on the **role name**, not part of the hostname:

```
postgresql://weaver_readonly.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

Port **5432**, session mode. Not 6543 — see `docs/MIGRATION.md`. Copy the host from Dashboard ->
Connect rather than typing it; the `aws-0` / `aws-1` prefix varies per project and a wrong guess
gives a DNS failure that reads like an auth failure.

Set the pair for **Production and Preview**. Production-only leaves preview deployments reporting
Chat as unconfigured, which during a demo looks like a bug. `isTextSqlConfigured()` requires both, so
one without the other configures nothing.

**Vercel binds environment variables at deploy time.** Saving one changes no running deployment —
redeploy after any edit.

### Verifying

```bash
pnpm build:web        # from the repo root: the same command Vercel runs
```

Then against the deployment:

```bash
curl -X POST https://<app>.vercel.app/api/collectors/<uuid>/ask \
  -H 'Content-Type: application/json' -d '{"question":"how many runs are there?"}'
```

| Response | Meaning |
|---|---|
| `501` | `DATABASE_URL_READONLY` or `GROQ_API_KEY` missing from this environment |
| `NotConfiguredError` naming a superuser | the read-only URL points at `postgres`, not `weaver_readonly` |
| an answer plus a `sql` field | configured |

### Known risk: the pnpm version

`packageManager` pins `pnpm@11.9.0`, and `pnpm-workspace.yaml` uses the `allowBuilds:` key, which is
pnpm 11 syntax. If Vercel's Corepack does not offer 11.x the install step fails there — before any
of the above matters. The fix is to pin `packageManager` to the newest pnpm Vercel does support and
convert `allowBuilds:` to that version's spelling. Not changed pre-emptively: the lockfile is
`lockfileVersion: 9.0` and downgrading it blind is the worse trade.
