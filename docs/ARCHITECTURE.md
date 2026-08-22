# Architecture (as built)

The designed architecture lives in [`03_PRD_AND_ARCHITECTURE.md`](../03_PRD_AND_ARCHITECTURE.md).
This document is its companion: what actually exists, where the code is, and — the part worth
reading — the places where the running system diverged from the plan and why.

Last verified 2026-08-22 against a live database with 208 runs and 5 healing episodes.

---

## 1. Shape

A pnpm workspace. Four libraries, three apps, one database.

```
packages/
  contracts/     types, the frozen state table, thresholds     6 src ·  1 test file
  validation/    the FHS scorer, coercion, golden baselines    6 src ·  6 test files
  brightdata/    typed CLI adapter, spawn, redaction           7 src ·  3 test files
  healing/       state machine, circuit breaker, diagnosis     4 src ·  3 test files
  export/        CSV and XLSX writers, one sheet model         5 src ·  3 test files
  textsql/       SQL guard, lexer, schema description          5 src ·  3 test files
apps/
  web/           Layer A — the Observation Deck (Next 16)
  worker/        Layer C — the autonomous engine (Node 24)   15 src · 13 test files
  chaos-lab/     the target site under test (Next 14)
supabase/migrations/
  0001_initial_schema.sql
  0002_repair_jobs.sql
  0003_readonly_role.sql
```

**426 tests, 0 failing.** Everything touching the database runs against real Postgres (PGlite), not
a mock — a decision that has paid for itself repeatedly, most sharply in §5.

### The dependency rule

```
contracts  ←  validation  ←  healing
     ↑             ↑            ↑
     └─────── brightdata ───────┘
                    ↑
              worker · web
```

`contracts` depends on nothing. `healing` depends on `validation` and `contracts` but **not** on
`brightdata` — the decision layer has no idea a CLI exists, which is what lets every healing
decision be tested as a pure function. The worker is the only place where deciding and doing meet.

---

## 2. The three layers

### Layer A — Observation Deck (`apps/web`)

Next.js 16, React 19, Tailwind v4. Reads Postgres directly through a small pooled `pg` client
(`lib/db.server.ts`, `import 'server-only'` at the top so a client import is a build error rather
than a runtime leak).

Layer A is **read-only with exactly one exception**: the repair route inserts a `jobs` row. It never
calls the Bright Data CLI, never scores a run, and never decides anything. All reads live in
`lib/queries.server.ts` so that claim is checkable by opening one file.

Three route handlers: `repair` (the one write), `export` (CSV/XLSX of the rows, the run ledger or the
healing ledger), and `ask` (text-to-SQL). `status` is the polled endpoint behind the live badge.

Three decisions worth naming:

**The approval route enqueues; it does not repair.** A healing episode runs 30–60 seconds and Vercel
terminates a request well before that. A repair driven from inside the handler would be killed
mid-episode, quite possibly between the approval and the confirmation — the worst possible place to
lose the process. The click becomes a job; the worker owns the loop. A partial unique index makes a
double-click idempotent rather than racing two episodes onto one collector.

**Generated SQL runs on a different connection from everything else.** The Chat panel's queries go
through `weaver_readonly` — SELECT on six tables, inside a transaction Postgres has marked read-only
— rather than the pool that renders the pages. The guard in `@weaver/textsql` is the first defence
and the role is the second, on the assumption that the first one fails (ADR-004).

**Live status polls rather than subscribing.** Supabase Realtime would mean a websocket, a second
client library, and reconnect behaviour that is its own bug surface — to watch a table that changes
once every fifteen minutes and a handful of times during a repair. The poll adapts: 2 s while a run
is in flight, 15 s once settled, 60 s after three consecutive failures, and it says on screen when
it has stopped getting through rather than continuing to render numbers that have stopped being
true.

### Layer B — Persistence & queue (Supabase Postgres)

Postgres is the database *and* the queue. Claims are `SELECT … FOR UPDATE SKIP LOCKED`, which
PostgREST cannot express — hence node-postgres rather than `supabase-js` in the worker (ADR-001).

Seven tables: `collectors`, `runs`, `jobs`, `healing_episodes`, `healing_attempts`,
`golden_baselines`, plus the enum CHECK constraints that keep the state names honest. The database
enforces what it can: `healing_episodes` has a CHECK asserting `trigger_reason = 'BROKEN'` if and
only if `authorised_by = 'AUTONOMOUS'`, so a caller that got the severity gate wrong fails at the
write rather than putting a misleading row in the audit trail.

### Layer C — Autonomous engine (`apps/worker`)

A long-running Node process: a poll loop, a wall-clock-aligned cron, and a claim reaper. One job at
a time. The cron ticks every 15 minutes and enqueues one `scheduled` job per ACTIVE collector.

```
poll → claim job → run collector → score against contract → dispatch on band
                                                              ├── HEALTHY  → refresh baseline
                                                              ├── DEGRADED → PENDING_OPERATOR
                                                              └── BROKEN   → heal autonomously
```

---

## 3. The measurement

```
fill_rate(f)   = rows with a non-null, non-empty value / total rows
type_pass(f)   = rows whose value parses as the declared type / non-null rows
field_score(f) = fill_rate(f) × type_pass(f)

FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))    weight = 2 required, 1 optional
FHS_final      = FHS × row_penalty × golden_penalty
```

Bands: HEALTHY ≥ 0.95, DEGRADED 0.60–0.95, BROKEN < 0.60. Canary gate 0.90.

**Severity gates autonomy, with no toggle.** A total break repairs itself; a partial break halts at
`PENDING_OPERATOR` and waits for a human. The reasoning is asymmetric risk: a collector returning
nothing cannot be made worse by an attempted repair, while one returning 80% good data can. There is
no configuration flag for this, deliberately — a flag would be the first thing set to "always
autonomous" in a hurry, and the judgement is the product.

### Unwrapping is load-bearing

`price` arrives as `{ value: 1299, currency: "USD", symbol: "$" }`. A `number` contract that read
that object literally would score 0 on a collector working perfectly, so every value is unwrapped to
its carrying scalar before it is measured. Two non-unwrappings are deliberate, because each is a
real break: an object with no carrying key stays an object and fails the type check, and
`{ value: null }` unwraps to `null` — the envelope arrived and the value did not.

---

## 4. The healing loop

`packages/healing` is three pure modules, each testable without a network:

- **`machine.ts`** — one function per decision point, each returning `{ from, next, reason }` and
  each validating against the frozen transition table. An illegal transition throws rather than
  being written.
- **`breaker.ts`** — five rails checked before *every* heal, in order: kill switch → account credit
  floor → heal attempts per 24 h (3) → rejections per episode (2) → credits per episode.
- **`diagnosis.ts`** — evidence bundle to ≤1000-character description, with a defined truncation
  order: page context first, broken-field blocks next, closing instruction never.

The orchestrator (`apps/worker/src/episode.ts`) is the only thing that both decides and acts. Its
one rule: **every ledger row is written before the call it describes.** An episode killed mid-flight
is auditable up to the point of failure.

`SCRAPER_STUDIO_INTEGRATION.md` documents the Bright Data side of this in detail, including three
API behaviours that changed the design.

---

## 5. Where the running system diverged from the plan

These are the changes that came from firing the loop at the real API rather than from reading the
spec again. Each cost something to learn.

### `approve` needs `--auto-save`, and the ban on it was over-broad

We had forbidden `--auto-save` alongside `--auto-approve`. That was right for `scraper heal`, where
it commits a template as part of the heal and skips the review that is the entire product — and
wrong for `scraper approve`, where the review has already happened and the flag is what makes the
approval take effect. Without it, `approve` returns `{"status":"done"}` and the collector keeps
serving the old template.

The ban is now scoped by command at the spawn boundary, read from the argv rather than passed as a
parameter, because an `allowAutoSave` argument is one more thing a caller could set by hand.
`--auto-approve` remains unconditionally forbidden, so the dangerous pair cannot form.

### A NUL byte could end an episode, and the damage was disproportionate

`rowIdentity` joined its parts with `\0`. Those keys surface as a failed golden check's aspect,
travel into `snapshot_after`, and hit a `jsonb` column — and Postgres stores no NUL in `text` or
`jsonb` at any depth. The first autonomous episode reached its verdict and died writing it down.

Losing the verdict was worse than losing the repair. `healing_episodes_open_idx` is a plain partial
index, not a unique one, so nothing stopped a second episode: the run stayed BROKEN, the ledger held
no evidence that a repair had already been tried and failed, and the next cron tick repeated the
whole thing fifteen minutes later.

Fixed at two layers, because they defend different things: the separator is now U+001F, and `pgSafe`
strips NULs at the database seam. Only the second matters in general — `runs.rows` is raw CLI output
and a site is free to serve a NUL in a product name. The ledger write is the last thing an episode
does, so it is the worst possible place to discover unstorable input.

*This is the clearest argument for testing against real Postgres.* A mock would have accepted the
NUL and proved nothing.

### The row penalty could not recover from an improvement

`row_penalty = row_count / trailing_median_row_count` exists to catch a collector that quietly
starts returning three products instead of three hundred.

A heal we asked for `ram` and `storage` also repaired a duplication defect nobody had mentioned:
12 products emitted 12 times became a flat 12. Every field scored 1.0 and the run landed at **FHS
0.083**, because the penalty read 12/144 as a 91% collapse. And it could not clear — only HEALTHY
runs feed the median, the penalty guaranteed no run was HEALTHY, so the collector sat below the
BROKEN line by arithmetic until the breaker stopped it.

The window now stops at the last committed heal. `healing_attempts.decision = 'APPROVED'` is the
exact moment the template changed, so earlier runs measured a different extractor. After a heal the
median is null and the penalty is skipped until fresh runs re-establish it, which is the honest
position: we just changed the thing being measured and do not yet know what normal looks like.

The contract's `row_count.min` moved 25 → 5 for the same reason. A floor calibrated against a defect
goes quietly wrong the moment the defect is repaired.

### `heal` cannot be pointed at a URL

`scraper heal` takes a collector id and a prompt; `--url` is documented as not being sent. A heal
always repairs the collector's own target. Our test harness had been switching layouts with a query
parameter, so the healer never saw the broken page — it previewed against the healthy one, scored a
legitimate 1.0, and saved a template for the layout that was never broken.

The golden-set confirmation caught it and quarantined. **The canary was not wrong; we were asking it
a narrower question than we thought.** The fix was to the harness: `chaos-lab` now takes a
server-side layout override, so the same URL starts serving different markup — which is what a real
redesign is, and the only shape of breakage this API can be asked to repair.

---

## 6. Deliberate constraints

| Constraint | Why |
|---|---|
| Never `--auto-approve` | The approval gate is the product, not a safety default. |
| Contracts are not editable by the healer | A repair that can lower its own bar is not a repair. |
| Golden baselines refresh only on RESTORED | Refreshing from a degraded run is a self-lowering bar. |
| Stored rows are never normalised | The ledger keeps what the CLI returned; readers de-duplicate. |
| Rejected attempts are never hidden | A system that shows the fix it refused is more convincing. |
| Ledger rows precede their CLI call | An interrupted episode stays auditable. |
| Status colours are never a chart series | Green/amber/red mean a health band; a line that borrows them competes for the same meaning. |
| Amber is reserved for healing | The moment it appears elsewhere, the healing state stops reading as an event. |

---

## 7. Known gaps

Stated plainly rather than left for someone to discover:

- **No authentication.** v1 has none (doc 03 §2.3). The repair, export and ask routes are all
  unauthenticated, and nothing about any of them should be described as a security control. Anyone
  who can reach a collector page can read its whole ledger and authorise a repair. `authorised_by`
  records *that* a human authorised a repair and should one day record *which*.
- **Text-to-SQL is unmetered.** `/ask` is not rate limited, so a loop of questions spends Groq
  tokens. The read side is bounded — a 5-second statement timeout and a 200-row cap — but the
  spending is not.
- **The rejection path has not run live.** All three real heal attempts scored 1.0 and were
  approved. Rejection, refinement and retry are proven against real Postgres with a faked CLI; no
  Bright Data heal has yet scored badly enough to be refused.
- **No live RESTORED yet.** Every episode so far ended QUARANTINED — twice because the confirmation
  correctly caught a repair that had not fixed the right page, twice because the breaker refused,
  once on the NUL crash. The confirmation and quarantine paths are therefore better evidenced than
  the success path.
- **A collector with no golden baseline can never reach RESTORED.** Conservative in the right
  direction, but a collector that breaks before its first healthy run has nothing to regress
  against.
- **The worker runs on a workstation**, started by a Scheduled Task, not on a deployed host. The
  image and its Railway configuration are in the repo and verified; the deploy itself has not run.
