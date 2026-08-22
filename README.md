# Master Weaver

**A web scraper that notices it is broken, repairs itself, and refuses its own repair when the
repair is not good enough.**

Built for the WeMakeDevs × Bright Data *Into the Scrape-Verse* hackathon, on the Bright Data Scraper
Studio CLI.

Scrapers do not usually fail loudly. A site moves one element, a field starts returning empty on 70%
of rows, and the collector keeps reporting success while the data quietly goes wrong. The engine
here measures every run against a per-field contract, and when the number drops it opens a repair
episode, asks Bright Data for a fix, **scores the proposed fix before committing it**, and confirms
the result against a golden set captured while the collector was healthy.

The part worth arguing about is the refusal. Anyone can build "it healed itself". The claim only
means something if the system can also say *no*.

---

## What is actually running

Not a prototype path — a live ledger, as of 2026-08-22:

| | |
|---|---|
| Runs since 2026-08-19 | **208**, one every 15 minutes |
| Healing episodes | **5**, every one of them QUARANTINED |
| Bright Data heal attempts | **3**, all scoring 1.000 at the canary gate |
| Repairs committed then reverted by the golden set | **2** |
| Tests | **426**, 0 failing — everything touching the database runs against real Postgres |

Five quarantines and no successes is not the number a demo wants, and it is the honest one. Two of
those episodes were caught by the confirmation step: the repair scored a legitimate 1.0 on the page
Bright Data showed it and had **not** fixed the page that was broken — because `scraper heal` cannot
be pointed at a URL, and our chaos harness had been switching layouts with a query parameter the
healer never saw. The canary was not wrong; we were asking it a narrower question than we thought.
The confirmation caught it, the ledger recorded it, and the harness was fixed.

That is the system working. A pipeline without the confirmation step would have reported RESTORED
twice.

---

## How it works

### Three layers, decoupled on purpose

```
Layer A · apps/web        Next.js on Vercel — read-only observation. Enqueues jobs; never scrapes.
Layer B · Supabase        Postgres as ledger AND queue (SELECT … FOR UPDATE SKIP LOCKED).
Layer C · apps/worker     A long-running Node process. Polls, scrapes, scores, decides, heals.
```

A healing episode takes 30–60 seconds and a serverless function does not live that long, so the
click becomes a job and the worker owns the loop ([ADR-001](docs/decisions/ADR-001-strict-layer-decoupling.md)).

### The measurement

```
fill_rate(f)   = rows with a non-null, non-empty value / total rows
type_pass(f)   = rows whose value parses as the declared type / non-null rows
field_score(f) = fill_rate(f) × type_pass(f)

FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))    weight = 2 required, 1 optional
FHS_final      = FHS × row_penalty × golden_penalty
```

A rate rather than a null check, because the failure that actually happens is *partial*
([ADR-002](docs/decisions/ADR-002-contract-design.md)). Bands: **HEALTHY** ≥ 0.95 · **DEGRADED**
0.60–0.95 · **BROKEN** < 0.60.

### The loop

```
run → score → BROKEN?  → probe → diagnose → heal → CANARY ≥ 0.90? → approve → golden set → RESTORED
                                                          └── no → reject → refine → retry (max 3)
                       → DEGRADED? → PENDING_OPERATOR → wait for a human
```

**Severity gates autonomy, and there is no toggle.** A total break repairs itself; a partial break
stops and waits. The reasoning is asymmetric risk: a collector returning nothing cannot be made
worse by an attempted repair, while one returning 80% good data can. A configuration flag for this
would be the first thing set to "always autonomous" in a hurry
([ADR-005](docs/decisions/ADR-005-no-bypass-override.md)).

**`--auto-approve` is never passed.** The flag surrenders the canary sample — there would be nothing
to score and nothing to record ([ADR-003](docs/decisions/ADR-003-never-auto-approve.md)). It is
forbidden at the spawn boundary, read from the argv, so no caller can reintroduce it.

**Every ledger row is written before the CLI call it describes.** An episode killed mid-flight stays
auditable up to the point of failure.

---

## The repository

```
packages/
  contracts/    frozen types, the 17-state transition table, thresholds        19 tests
  validation/   the FHS scorer, unwrapping, de-duplication, golden baselines   91 tests
  brightdata/   typed CLI adapter, spawn guard, argv redaction                 33 tests
  healing/      state machine, circuit breaker, diagnosis builder              71 tests
  export/       CSV and XLSX writers — one sheet model, no dependencies        42 tests
  textsql/      the text-to-SQL guard, schema description and prompt           35 tests
apps/
  web/          Layer A — the Observation Deck
  worker/       Layer C — the autonomous engine                               135 tests
  chaos-lab/    the target site, with three layouts to break on demand
supabase/migrations/
  0001_initial_schema.sql · 0002_repair_jobs.sql · 0003_readonly_role.sql
```

`contracts` depends on nothing. `healing` depends on `validation` and `contracts` but **not** on
`brightdata` — the decision layer has no idea a CLI exists, which is what lets every healing
decision be tested as a pure function.

---

## Running it

Needs Node 24, pnpm 11, Docker (for local Supabase), and a Bright Data API key.

```bash
pnpm install
supabase start                                  # local Postgres on 54322
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done

cp apps/worker/.env.example apps/worker/.env    # BRIGHTDATA_API_KEY, DATABASE_URL
cp apps/web/.env.example    apps/web/.env.local

pnpm --filter @weaver/worker seed               # creates the collector, captures the baseline
pnpm --filter @weaver/worker dev                # the engine
pnpm --filter @weaver/web    dev                # http://localhost:3000
pnpm --filter @weaver/chaos-lab dev             # the site to break
```

Tests, per package:

```bash
pnpm --filter @weaver/validation test
```

### Breaking it on purpose

The Chaos Lab serves three layouts of the same product page. `CHAOS_LAB_FORCE_LAYOUT=v2` makes the
same URL serve different markup — which is what a real redesign is, and the only shape of breakage
`scraper heal` can be asked to repair.

---

## Documentation

| | |
|---|---|
| [`docs/SCRAPER_STUDIO_INTEGRATION.md`](docs/SCRAPER_STUDIO_INTEGRATION.md) | How every Bright Data CLI command is used, and three API behaviours that changed the design |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What exists, where it is, and where the running system diverged from the plan |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Deploying the worker to Railway, step by step, and what its 30-second stop grace costs |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | Moving the ledger to hosted Supabase without losing the history |
| [`docs/AUDIT-DAY-3.md`](docs/AUDIT-DAY-3.md) | A mid-build audit against the running system, including five findings it produced |
| [`docs/decisions/`](docs/decisions/) | ADRs 001–005 |

---

## What this does not do

Stated here rather than left to be discovered:

- **No authentication.** v1 has none. The repair endpoint, the export endpoint and the text-to-SQL
  endpoint are all unauthenticated; anyone who can reach the page can read the ledger and authorise
  a repair. `authorised_by` records *that* a human authorised a repair, and should one day record
  *which*.
- **No live `RESTORED`.** Every episode so far ended QUARANTINED. The confirmation and quarantine
  paths are therefore much better evidenced than the success path.
- **The rejection path has not fired against real Bright Data output.** All three live heal attempts
  scored 1.0 and were approved. Rejection, refinement and retry are proven against real Postgres with
  a faked CLI.
- **The worker runs on a workstation**, started by a scheduled task. It is containerised and
  Railway-ready ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)) but not yet deployed. Railway's stop
  grace is fixed at ~30 s, so `WORKER_SHUTDOWN_GRACE_MS` is lowered to 25 s there and a deploy that
  lands during a job — about 0.8% of them — abandons it to the stale-claim reaper.
- **Text-to-SQL is unmetered.** The endpoint is not rate limited, so a loop of questions spends Groq
  tokens.
