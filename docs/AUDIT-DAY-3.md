# Codebase Audit — Day 3

**Audited:** 2026-08-19 (Day 3) · **Resolutions applied:** 2026-08-20 (Day 4)
**Build window:** Aug 17–23 · **Auditor:** Opus 5 (integration tier)
**Method:** All five planning documents (01–05) read in full and checked against the working tree,
every test suite executed, and the live Supabase instance queried directly.

> This is the pivot-point record. Days 1–2 built the foundation; this document marks the moment the
> work turns to the healing loop. It is a snapshot, deliberately not maintained — later state lives
> in the ADRs and the README.

---

## Verdict

**Days 1–2 are complete and built to a high standard. Day 3 onward has not started.**

Every foundation the specification calls load-bearing exists, is documented, and is tested:
157 tests pass across four packages. The product's actual thesis — standing at the approval gate —
does not exist in code yet. The runner scores a run and deliberately stops before the state machine.

That is the correct position for the end of Day 2, not a shortfall. But it means everything that
scores against the rubric is still ahead, and it is all sequential.

---

## Verified state at time of audit

| Signal | Value |
|---|---|
| Working tree | clean at `8f8ea94` |
| Test suites | 157 pass / 0 fail (contracts 19 · brightdata 31 · validation 50 · worker 57) |
| Live collector | `c_mt006kvtc12l54ywn` — ACTIVE, FHS 1.000000 |
| Real runs recorded | 13, first at 2026-08-19 11:48 UTC |
| Cron | 30 min, wall-clock aligned |

---

## Part 1 — What is built

### Day 1 · CLI verification (architect lane) — COMPLETE

**The load-bearing assumption is confirmed.** `docs/samples/heal_response.json` returns
`status: "awaiting_approval"` together with a machine-readable `preview_result` array. The canary
sample is real, so the degraded fallback path in doc 01 §8 is not needed and the approval gate can be
built as specified. `run_v2_still_broken.json` separately proves `approve --reject` discards cleanly.

All five required sample artifacts are captured.

### `packages/contracts` — COMPLETE

- All **17 states**, plus a legal-transition map, UI labels, and the 17→4 headline collapse
- Zod contract schemas; `goldenSetSize` / `isWeakGoldenSet` implement the amended `min(3, available)` rule
- `thresholds.ts` holds every magic number in one file, exactly as doc 01 §3.2 requires: bands,
  canary gate at 0.90, breaker limits, CLI input caps, field weights, golden tolerances
- Row types for all six tables

### `packages/brightdata` — COMPLETE

All seven commands: `create` · `run` · `heal` · `approve` · `approve --reject` · `scrape` · `budget`.
Spawn with `shell: true`, per-command timeouts, process-tree kill, separately captured stdout/stderr,
ANSI stripping, secret redaction, redacted argv logging.

`--auto-approve` is blocked twice over: absent from `healScraper`, and rejected at the spawn boundary
by `assertNoForbiddenFlags`. A future agent cannot add it by hand-rolling an argv.

### `packages/validation` — COMPLETE

`fill_rate × type_pass`, required-fields-double weighting, row and golden penalties,
`scoreRun` / `scoreCanary` / `scoreFhs`. Correctly unwraps the nested
`price: { value, currency, symbol }` shape that real CLI output returns.

### `supabase/migrations/0001_initial_schema.sql` — COMPLETE

All six tables, including the two that doc 03 §8 flags as previously missing and load-bearing:
`healing_attempts` and `golden_baselines`.

Notably, the architect's severity decision is enforced by the database rather than by convention:

```sql
check ((trigger_reason = 'BROKEN') = (authorised_by = 'AUTONOMOUS'))
```

### `apps/worker` — COMPLETE for its declared scope

Queue with `FOR UPDATE SKIP LOCKED`, dead-claim recovery, exponential backoff, wall-clock-aligned
cron, boot-time config validation that exits 78 rather than starting up misconfigured, graceful
shutdown, structured JSON logging, and Task Scheduler autostart. Tested against real Postgres.

### `apps/chaos-lab` — COMPLETE and deployed

All three layouts live at `master-weaver-theta.vercel.app`. Deterministic price and stock schedules,
server-rendered, zero dependencies beyond Next.

### `apps/web` — shell only, as scheduled

Design tokens, app shell, sidebar, command bar, health badge with the full state mapping, field
health tiles, five panels, and complete empty / loading / error states. All fed by mock seed data.

---

## Part 2 — What is pending

### Critical · the product thesis is unimplemented

**1. `packages/healing` does not exist.** Not a stub — the directory is absent. Missing: the state
machine, the diagnosis builder (doc 01 §5, described there as "the core intellectual property"),
evidence-bundle assembly, transient/structural probe wiring, the canary gate, refinement-on-rejection,
and the circuit breaker.

**2. Golden baselines have no implementation.** Table, types and tolerances exist; nothing captures a
baseline, compares against one, or computes `golden_set_match_rate`. That parameter has no caller, so
`golden_penalty` is permanently 1 and **`RESTORED` is currently unverifiable** — precisely the failure
doc 03 §8 correction #3 was written to prevent.

**3. `healing_episodes` and `healing_attempts` have zero writers.** No ledger content exists, so
doc 04 Beat 5e — the rejected-then-approved episode, called the strongest ten seconds of the video —
has no data path.

**4. Credit accounting is never invoked.** `getBudget` is implemented and exported but called nowhere.
`credits_spent` is always null. The credit-floor breaker rail and the pitch number both depend on it.

**5. Discord webhook — zero references** anywhere in the codebase.

**6. `PENDING_OPERATOR` has a badge but no mechanism.** The health badge links to `?action=repair`,
but there is no confirmation UI, no approval action, and no route to enqueue one. The deep-link
contract in doc 03 §6.3 lands nowhere.

### Layer A ↔ Layer B is entirely unwired

`apps/web` has no Supabase client, no TanStack Table, no Recharts, and no `app/api/` directory. No
Realtime subscription. The chart and table panels are frames awaiting their series.

### Remaining scheduled work

| Day | Outstanding |
|---|---|
| 3 | State machine · diagnosis builder · circuit breaker · Realtime health monitor · CSV/XLSX export · FHS threshold tuning |
| 4 | Approval gate end-to-end · first autonomous heal · ledger timeline · Recharts series · Discord · live credit meter |
| 5 | Text-to-SQL (read-only role + Groq route) · worker deployment to Railway/Fly/Render |
| 6 | Chaos drills v2 and v3 · mandatory review pass |
| 7 | README · `docs/ARCHITECTURE.md` · `docs/SCRAPER_STUDIO_INTEGRATION.md` (required artifact) · ADR-002/003/004 |

---

## Part 3 — Findings from the live system

Five issues found by querying the running instance rather than by reading code. All five are being
addressed before work begins on `packages/healing`.

### F1 · The collector emits every product twelve times

144 rows, 12 distinct product names. FHS reads a perfect 1.000000 because fill rates are perfect —
duplication is invisible to a contract that measures per-field health. It would be visible in the
demo table and would distort the price chart.

**Resolution:** dedupe on the read path. Raw rows stay in the database; the reading layer collapses
them. Scoring is unaffected, which keeps the stored evidence honest.

### F2 · Only three fields are scored

The contract covers `product_name`, `price` and `in_stock`. The current collector returns
`product_page_url` unscored and returns no `ram` or `storage` at all — though the Day-1 sample
`run_v1.json` shows the CLI extracting both. Doc 04 Beat 5's "thirteen other fields still working"
narration has three fields to work with, and an unscored field cannot demonstrate breakage.

**Resolution:** restore a five-field contract — `product_name`, `price`, `ram`, `storage`, `in_stock`.

### F3 · Price history starts on Day 3, not Day 2

First run at 2026-08-19 11:48 UTC. Doc 02 §3 called the cron "the one item that cannot be added late."
By the Aug 22 recording there will be roughly three days of points, not five.

Doc 01 §12.1a explicitly forbids seeding synthetic history, and that rule holds. The honest sparse
chart is worth more than a fabricated dense one.

**Resolution:** halve the cron interval to 15 minutes to double point density, and narrate three days
rather than five.

### F4 · The golden set is a single listing URL

`isWeakGoldenSet` only flags the `detail` shape, so nothing surfaces this in the UI. The regression
test standing behind every `RESTORED` verdict is one page.

**Resolution:** build the baseline capture and comparison logic to handle multiple URLs and both
collector shapes, and widen the set for the live collector.

### F5 · ADR hygiene

`ADR-001` is saved as `.md.txt` and will not render on GitHub. `ADR-005` is still in its pre-build
staging voice, including the instruction to rewrite it before committing. Doc 02 names the ADRs as
the meaningful-human-contribution defense, which makes both of these worth more than their size.

**Resolution:** fix the extension; rewrite ADR-005 as a decided architectural record.

---

## Assessment

The project is **on schedule but at its inflection point.** Everything structural and inexpensive is
finished, and finished well: the database enforces the architect's decisions rather than trusting
code to remember them, the CLI adapter refuses the forbidden flag at two independent layers, and the
scorer is pure, total, and heavily tested.

What remains is the hard, sequential, credit-spending part. Two items carry the longest tails:

1. **`packages/healing` plus golden baselines** — these gate the ledger, the demo centerpiece, and
   both Day-6 chaos drills.
2. **The web-to-Supabase wiring** — this gates every visual beat in the video.

Neither can be parallelised away, and neither should start before the five findings above are closed,
since F1 and F2 both change what a break actually scores.

---

## Addendum — resolutions, 2026-08-20

Applied the morning after the audit, before `packages/healing` was started.

| # | Finding | Outcome |
|---|---|---|
| F1 | 12× duplicate rows | **Closed.** `dedupeRows` / `describeDuplication` in `@weaver/validation`, plus `apps/web/lib/rows.ts` as the single read-path boundary. Raw rows still stored unmodified; the scorer deliberately untouched. |
| F2 | Only three scored fields | **Blocked externally.** Contract staged and tested, not activated — see below. |
| F3 | Sparse price history | **Closed.** Cron halved to 15 minutes after measuring a Chaos Lab run at 0 credits. |
| F4 | Single-URL golden set | **Closed.** Full capture/compare module, written against N URLs and both collector shapes. |
| F5 | ADR hygiene | **Closed.** `ADR-001` renamed to `.md`; `ADR-005` rewritten as a decided record. |

Test count went from 157 to **205**, all passing.

### F2 is blocked on Bright Data account state

`ram` and `storage` are in the v1 markup and the Day-1 sample shows the CLI extracting both, so this
is a collector gap rather than a page gap. Closing it needs either a replacement collector or a heal,
and on 2026-08-20 both are blocked:

- `scraper create` succeeds, but every run of the resulting collector returns
  `error_code: "account_suspended"` — *"Your account is currently suspended, log in to reactivate."*
- `scraper heal` returns HTTP 500 through all four of the CLI's internal retries.
- `scraper run` against the **existing** collector still works, so the price cron is unaffected.

`LISTINGS_CONTRACT_FIVE_FIELD` is therefore defined, documented and covered by tests, but not wired
into the seed. Activating it against a collector that cannot satisfy it would score 5/9 = 0.5556 —
below the 0.60 line — putting every scheduled run into `BROKEN` and ending the healthy price history.
A contract describes what the page carries; it is not a wish list.

**This needs an account reactivation before any healing work can be verified end to end.**

### Two further findings from the fix pass

**F6 · The worker died with Docker and lost 7.6 hours of cron ticks.** Last run before the outage was
2026-08-19 20:30 UTC; the worker was found down at 2026-08-20 04:07 UTC. The Task Scheduler autostart
triggers on logon, so an overnight Docker Desktop stop takes the worker with it and nothing brings it
back. The price history now carries a visible gap. Worth a liveness check that restarts on failure
rather than only at logon.

**F7 · The seed module executed on import.** `import { … } from './seed.js'` opened a pool, wrote
rows, and set a non-zero exit code on any machine without `DATABASE_URL`. Now guarded to run only
when invoked directly; `npm run seed` is unchanged.
