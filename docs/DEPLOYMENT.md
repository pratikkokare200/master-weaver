# Deploying the worker

Layer C is a long-running Node process with no HTTP surface. It polls a Postgres queue, runs a
wall-clock-aligned cron, and spawns the Bright Data CLI as a subprocess. That shape rules out
serverless entirely — a heal can take 300 seconds and the process must survive between jobs — and it
makes the hosting requirements unusually specific.

Everything here has been built and run. The image is verified; the Fly deploy is not, because it
needs an account and a cloud database (§5).

---

## 1. Why Fly

The requirement that decided it is **shutdown grace**.

The worker's contract on `SIGTERM` is: stop claiming new work, let the job already in flight finish,
then exit — with a 240-second grace, because `scraper heal` has a 300-second deadline and being
killed between the approval and the golden-set confirmation is the worst possible place to lose the
process. The credits are spent, the collector is already mutated, and the episode has no verdict.

| | Grace between SIGTERM and SIGKILL |
|---|---|
| **Fly** | `kill_timeout`, configurable to **300 s** |
| Render | fixed, ~30 s |
| Railway | fixed, ~30 s |

Fly is the only one of the three that can honour the shutdown we already implemented. On Render or
Railway we would have to lower `WORKER_SHUTDOWN_GRACE_MS` to ~25 s and accept that a deploy during a
repair abandons it.

That is survivable — every ledger row is written before the call it describes, and the claim reaper
recovers an abandoned job after 600 seconds — but "recoverable" and "correct" are different
standards, and this one is available for free.

Two lesser points in the same direction: Fly needs no HTTP port (Render's Background Worker also
handles this correctly; Railway is happiest with a listener), and `auto_stop_machines = false` keeps
a worker always-on rather than scaling to zero, which for a cron worker is the whole job.

**The decision is reversible.** The image is a plain Dockerfile with nothing Fly-specific in it. §6
covers what Render or Railway would need instead.

---

## 2. What is in the repo

```
apps/worker/Dockerfile     multi-stage, provider-neutral, builds from the REPO ROOT
apps/worker/fly.toml       machine size, restart policy, kill_timeout
.dockerignore              secrets and host node_modules excluded from the build context
```

### Build

```bash
docker build -f apps/worker/Dockerfile -t weaver-worker .
```

From the repository root, not from `apps/worker` — the worker depends on four workspace packages by
`workspace:*`, and a context rooted at `apps/worker` cannot see them.

### Verified

| | |
|---|---|
| Image size | **81 MB** |
| Runtime dependencies | `@brightdata/cli`, `@weaver/*`, `pg` — nothing else |
| Bright Data CLI | 0.3.5, pinned exactly, runs inside the image |
| Boot | connects to Postgres, schedules the cron, starts the poll loop |
| `SIGTERM` | graceful shutdown runs, **exit code 0** |

The CLI is now a real dependency rather than something `npx` fetches at runtime, and it is pinned to
an exact version rather than a range. Our integration knowledge is version-specific — `--auto-save`
on `approve`, `--url` not reaching `heal` — and a CLI that silently moves under a long-running worker
is exactly the failure this project has spent two days learning to avoid.

### Two build details worth knowing

**`pnpm deploy --legacy`, not `pnpm install --prod`.** A `--prod` install unlinks dev dependencies
but leaves their contents in the virtual store — 90 MB here, most of it PGlite, the WASM Postgres the
tests run against. Unreachable from the worker, still in every layer. `deploy` writes a
self-contained tree instead: what comes out is what the process can actually load. `--legacy` avoids
setting `inject-workspace-packages` workspace-wide, which would make local installs copy workspace
packages instead of symlinking them and break the edit-and-see-it loop.

**Exec-form `CMD`.** So node is PID 1 and receives `SIGTERM` directly. Wrapped in a shell it would
not, and the graceful shutdown would never run — which is the whole reason for choosing Fly.

---

## 3. What I need from you

Three things, and the second is the real blocker.

### a. A Fly account

```bash
fly auth login          # opens a browser — I cannot do this
fly launch --no-deploy --copy-config --config apps/worker/fly.toml
```

`--no-deploy` matters: launching and deploying in one step would start a worker before its secrets
exist, and it would exit 78 on missing configuration.

### b. A cloud-reachable Postgres — **this is the blocker**

`DATABASE_URL` currently points at `127.0.0.1:54322`, a Supabase stack in local Docker. A worker in
Fly cannot reach it. Deploying needs a hosted Supabase project, and then:

1. Apply both migrations (`supabase/migrations/0001_…`, `0002_…`) to it.
2. Run `pnpm --filter @weaver/worker seed` against it.
3. Use the **direct connection or session pooler** URI, not the transaction pooler — the queue claim
   holds a row lock for the duration of a statement and transaction pooling breaks session state.

Worth deciding deliberately: moving to a hosted database moves the run history with it, or leaves it
behind. The 60-odd runs and 5 healing episodes in the local ledger are the evidence the demo shows.
If they should survive, dump and restore before switching — I can do that once the project exists.

### c. Secrets

```bash
fly secrets set \
  DATABASE_URL="postgresql://…" \
  BRIGHTDATA_API_KEY="…" \
  BRIGHTDATA_UNLOCKER_ZONE="chaos_lab_unlocker"
```

`fly secrets set` rather than `[env]` in `fly.toml` — that file is committed to a public repository.
Set these yourself; I have not put a key on any command line and would rather keep it that way.

Optional: `DISCORD_WEBHOOK_URL` and `APP_BASE_URL` for alerts, `WORKER_HEALING_ENABLED=false` as a
kill switch.

---

## 4. TLS is on by default, and it caught itself

Running the container against a database through `host.docker.internal` failed immediately:

```
cannot reach the database … "The server does not support SSL connections"
```

That is correct behaviour, not a bug. `resolveSsl` turns TLS on with full chain verification for
anything that is not `localhost` or `127.0.0.1`, and it **refused to fall back to plaintext** for a
host it did not recognise as local. A real Supabase URL supports TLS, so production is unaffected;
only a local database reached through a Docker hostname needs `DATABASE_SSL=false`, and that override
exists for exactly that case.

The general point: a worker that silently downgrades to an unencrypted connection when TLS fails is
worse than one that refuses to start. This one refuses, and says which host it refused.

---

## 5. Deploy

```bash
fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile
fly logs   --config apps/worker/fly.toml
fly scale count 1 --config apps/worker/fly.toml
```

**Exactly one machine.** Two workers against one queue is safe for correctness — the claim is
`FOR UPDATE SKIP LOCKED` and the cron's `INSERT` is guarded by `NOT EXISTS` — but each one bills for
its own scrapes. `fly scale count 1` is worth running explicitly after the first deploy, because
Fly's default for a new app is not always one.

Also: **stop the local worker before deploying**, or two workers will sweep the same collectors.

Expected first output:

```
worker starting … cron_interval_ms=900000 healing_enabled=true
cron scheduled … first_tick_at=…:00:00.000Z
poll loop started … poll_interval_ms=10000
```

---

## 6. If Fly turns out to be wrong

The image is provider-neutral. What changes per host:

**Render** — create a Background Worker (not a Web Service; a Web Service waits for a port that
never opens). Docker runtime, Dockerfile path `apps/worker/Dockerfile`, build context the repo root.
Set `WORKER_SHUTDOWN_GRACE_MS=25000` so the process exits on its own terms inside Render's ~30 s
window rather than being killed at it.

**Railway** — deploy from the repo, Dockerfile path `apps/worker/Dockerfile`. Same
`WORKER_SHUTDOWN_GRACE_MS` change. Railway may expect a listening port for health checks; there is
none, so disable health checks rather than adding an HTTP server the worker does not need.

**Anywhere else** — the image needs `DATABASE_URL` and `BRIGHTDATA_API_KEY`, a stop grace as long as
you can get, and a restart-on-exit policy. It writes nothing to disk except stdout, so it needs no
volume.

---

## 7. Liveness

There is no `HEALTHCHECK` and no `EXPOSE`, deliberately. A worker's health is not a port answering.

What to watch instead:

- **The process is running.** `restart.policy = "always"` handles the rest; a worker that exits has
  stopped collecting whatever its exit code, including the deliberate exit 78 on bad configuration.
- **The ledger is advancing.** The real health check is a `runs` row every 15 minutes. A worker that
  is up but not collecting looks identical to a healthy one from outside, and only the ledger
  distinguishes them. `select max(finished_at) from runs` is the query that matters.
- **Exit 78** is `EX_CONFIG` — configuration was wrong at boot, and the message says which variable.
  Restarting will not fix it.
