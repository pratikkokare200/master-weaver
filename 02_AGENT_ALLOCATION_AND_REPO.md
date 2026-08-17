# Master Weaver — Agent Allocation, Repo Ownership & Prompt Library

**Document 02 of the Master Weaver planning suite**
Status: DRAFT — planning artifact, written 2026-08-12 (pre-build)
Build window: 2026-08-17 → 2026-08-23. **Nothing here is committed before Aug 17.**
Depends on: `01_HEALING_STATE_MACHINE.md`

---

## 0. The allocation principle

Do not route work by "which model is smartest." Route it by **cost of being wrong × time to detect
wrongness**, with a second axis for **context breadth**.

```
                    │ Wrong is detected in seconds  │ Wrong is detected in days
────────────────────┼───────────────────────────────┼──────────────────────────────
Blast radius: 1 file│  FLASH  (volume tier)         │  PRO    (taste / UX tier)
Blast radius: system│  OPUS   (integration tier)    │  OPUS   (integration tier)
```

**Second axis — context breadth.** If a task requires holding invariants that live in files it is
*not editing*, it is an Opus task regardless of where it lands in the grid. A component that renders
a table is self-contained. A function that decides whether to commit a heal is not.

This heuristic is deliberately model-agnostic. If 3.6 Flash turns out to be stronger than expected,
you promote individual tasks up a tier without redrawing the map. See §9 (escalation).

---

## 1. Agent roster

### Opus 5 — *Integration tier* (via Claude Code)

**Owns:** anything where a mistake is expensive, silent, or cross-cutting.

- The healing state machine, circuit breaker, diagnosis builder
- The Bright Data CLI subprocess adapter (Windows `.cmd` shim, timeouts, stderr, secret redaction)
- Database schema and migrations — schema is a contract, not a file
- The text-to-SQL chat path (untrusted input reaching a database is a security surface)
- Anything touching credits or `approve` / `--reject`
- **Final integration.** Only Opus merges.
- Code review of everything in §8's mandatory-review list, regardless of author

**Not for:** high-volume component generation, copy, fixtures, repetitive CRUD. Slower and more
expensive per unit; spending it on a table cell is a waste of the week's most constrained resource.

### Gemini 3.1 Pro — *Taste tier* (via Antigravity)

**Owns:** the surfaces where "wrong" means *looks unfinished* — which is exactly the Suit-Up criterion,
and it's the failure mode you can't unit-test.

- App shell, layout, design tokens, spacing rhythm
- Multi-component composition: workspace view, health monitor, ledger timeline, charts view
- Empty / loading / error states (the single biggest "finished vs. student project" signal)
- Responsive + dark mode pass
- **The browser-verification loop.** Antigravity can drive and screenshot the running app —
  that closed loop is Pro's real advantage, and it should own it. Nobody else screenshots.

**Not for:** subprocess handling, the healing loop, migrations. Not because it can't — because those
files have one owner and it isn't Pro.

### Gemini 3.6 Flash — *Volume tier* (via Antigravity)

**Owns:** work that is fully specified by its own brief and verifiable in seconds.

- The Chaos Lab target site (v1/v2 layouts) — self-contained, instantly verifiable, unblocks everyone
- Pure functions from a written formula: the FHS scorer, type coercers, drift calculators
- Unit tests against a spec
- Export engine (CSV/XLSX), JSON viewer, Discord webhook payload
- Leaf components against a frozen prop interface
- Fixtures, seed data, sample outputs, README scaffolding

**Not for:** anything requiring judgment the brief didn't supply. Flash's failure mode is confidently
filling a gap in an under-specified brief. The fix is brief quality (§6), not model choice.

---

## 2. Repo structure with hard ownership

**One file, one owner, for the whole week.** This is the rule that makes three agents faster than one
instead of slower.

```
master-weaver/                             # product: Master Weaver · package scope: @weaver/*
├── README.md                              OPUS (Day 7)
├── docs/
│   ├── ARCHITECTURE.md                    OPUS
│   ├── SCRAPER_STUDIO_INTEGRATION.md      OPUS   ← required submission artifact
│   ├── decisions/ADR-*.md                 YOU    ← the "meaningful contribution" defense
│   └── samples/*.json                     FLASH  ← required "example structured output"
│
├── packages/
│   ├── contracts/         types, zod schemas, state enum, FHS thresholds   OPUS · FROZEN Day 2 AM
│   ├── brightdata/        CLI subprocess adapter                           OPUS
│   ├── healing/           state machine, breaker, diagnosis builder        OPUS
│   └── validation/        FHS scorer, contract eval, drift                 FLASH (Opus specs)
│
├── apps/
│   ├── web/
│   │   ├── app/           routes, layouts, shell                           PRO
│   │   ├── app/api/       route handlers                                   OPUS
│   │   ├── components/ui/ leaf components                                  FLASH
│   │   ├── components/*/  composed views                                   PRO
│   │   └── lib/           client helpers                                   FLASH
│   ├── worker/            job queue runner, cron                           OPUS
│   └── chaos-lab/         the mutating target site                         FLASH
│
└── supabase/migrations/                                                    OPUS
```

Five deployable units, four packages. Resist adding more — every boundary is coordination cost.

### Why `packages/contracts` is frozen

Everything depends on it and nothing else may edit it. It contains the state enum from doc 01, the
contract shape, the FHS thresholds, and the row/ledger types. Freeze it **Day 2 morning**. After that,
changes go through Opus only, and get announced before they land — a silent contract change is how
you get three agents building against three different realities.

---

## 3. Day-by-day allocation

Three lanes running in parallel. Read down a column for one agent's week; read across for a day.

| Day | Opus 5 (integration) | Gemini 3.1 Pro (taste) | Gemini 3.6 Flash (volume) | You |
|---|---|---|---|---|
| **1 · Aug 17** | **`packages/contracts` first**, then `brightdata` adapter (`create`/`run`/`scrape`/`budget`). Heal/approve path waits on the green light — doc 01 §12.2. Also: pin the **complete** dependency set. | Design tokens, app shell, sidebar, empty states (doc 05) | **Chaos Lab v1/v2/v3 + deploy** | **Run doc 01 §12 CLI verification personally** (~3h, terminal) → green-light Opus. Register, redeem `wemakedevs`, Supabase + Vercel projects, ADR-001 |
| **2 · Aug 18** | Worker + job queue; first real end-to-end scrape. **Start the 30-min price cron.** Freeze contracts AM. | Workspace shell + TanStack table view | `validation` package from Opus's formula spec + unit tests | Verify first real rows; ADR-002 (contract design) |
| **3 · Aug 19** | Healing state machine, diagnosis builder, circuit breaker | Health monitor + state badges + Supabase Realtime subscription | Export engine (CSV/XLSX), JSON view, fixtures | Tune FHS thresholds against Chaos Lab |
| **4 · Aug 20** | Ledger persistence + approval gate wired end-to-end; **first autonomous heal** | Charts view (Recharts) + ledger timeline UI | Discord webhook, credit meter, `docs/samples/` | Watch a real heal; ADR-003 (why not `--auto-approve`) |
| **5 · Aug 21** | Text-to-SQL chat (read-only role, query validation) | Discovery/search screen + polish pass | README scaffolding, error/loading states, bug queue | Draft demo script |
| **6 · Aug 22** | **Chaos drill**: break the site, verify unattended recovery, tune. Then review pass over §8 list. | Visual polish, responsive, dark mode, screenshots | Bug queue only — no new surface | **Record fallback demo take** |
| **7 · Aug 23** | README + `SCRAPER_STUDIO_INTEGRATION.md` + ADR cleanup. Freeze. | Final screenshots | Frozen | Record final demo, submit |

**Day 6 is a freeze day for new features.** Anything not working on the morning of Day 6 gets cut,
not finished. Protect the demo day; presentation is a full sixth of the score and it's the thing
every team under-budgets.

Note Day 2's cron: it's the difference between a time-series chart with five days of real price
history and one with two dots on it. Twenty minutes of work, enormous demo payoff, and it only works
if you start it on Day 2.

---

## 4. What only Opus can do here

Worth stating plainly, because it drives the sequencing: Opus is running inside Claude Code with a
terminal and the filesystem, which makes it the only agent that can **actually execute the Bright Data
CLI and see what it returns.**

That's why Day 1 opens with the §12 verification checklist and nothing else. The entire product rests
on one assumption — that `heal` returns a machine-readable canary sample at the approval gate — and no
amount of UI built in parallel matters if that assumption is false. Pro and Flash work Day 1 on things
that are useful under either outcome (the shell, the Chaos Lab).

---

## 5. Contracts-first sequencing

The dependency order that lets three agents run without blocking each other:

1. **Opus writes `packages/contracts` first** — types, state enum, thresholds, ledger shapes.
2. Pro and Flash import from it and build against types that exist but have no implementation yet.
3. Opus fills the implementations behind those types.

Consequence: Pro can build the health monitor on Day 3 against the state enum *before* the state
machine that emits those states is finished. That parallelism is the entire reason to have three
agents. Without it, Pro and Flash idle waiting for Opus.

---

## 6. The handoff brief format

Every task handed to Pro or Flash uses this. The template is the reusable artifact — more valuable
than any individual prompt below.

```
## OBJECTIVE
One sentence. What exists when this is done.

## FILES YOU OWN (exclusive — do not touch anything else)
- path/one.tsx
- path/two.ts

## INPUTS
- Import types from @weaver/contracts. Do NOT modify that package.
- [paste the exact relevant type definitions here — do not make the agent go find them]

## ACCEPTANCE
- Runnable check: `pnpm --filter X test` passes / route renders at /path with no console errors
- [specific observable behaviours, numbered]

## FORBIDDEN
- Do not add dependencies not listed here.
- Do not modify packages/contracts, migrations, or any file outside FILES YOU OWN.
- Do not run `pnpm install` with new packages.

## STOP AND ASK IF
- The brief doesn't specify a behaviour you need
- You need to change a shared type
- An acceptance criterion appears impossible as written
```

`STOP AND ASK IF` is the highest-value block. Flash's characteristic failure is confidently inventing
an answer to a question the brief didn't address, and an explicit permission-to-stop converts that
into a question you can answer in ten seconds.

`FORBIDDEN: do not add dependencies` matters more than it looks — three agents independently running
`pnpm install` is a lockfile conflict on Day 4 and an hour you don't have.

---

## 7. Anti-collision protocol

1. **One file, one owner, all week.** No exceptions, including "just a small fix."
2. **Contracts frozen after Day 2 AM.** Opus-only, announced before landing.
3. **No agent adds dependencies** unless the brief names them.
4. **Each agent commits only its owned paths.** Never `git add -A`.
5. **Only Opus integrates and merges.** Pro and Flash never resolve conflicts.
6. **Pro and Flash never touch `supabase/migrations/`.** Schema drift is unrecoverable mid-week.
7. If an agent needs a file it doesn't own: stop, escalate, Opus makes the edit.
8. **All dependencies are declared once, on Day 1, by Opus.** Pro and Flash never run `pnpm add` or
   `pnpm install` with a new package — they run `pnpm install` against a lockfile that already has
   everything. Pin the full set up front: Next, Tailwind, Shadcn, TanStack Table, Recharts, SheetJS,
   Zod, the Supabase client, and the `openai` SDK (pointed at Groq's base URL — no separate Groq
   package needed). Adding one later is an Opus task, done between agent turns.
   Env vars pinned the same day: `BRIGHTDATA_API_KEY` (worker), `GROQ_API_KEY` (web),
   `DISCORD_WEBHOOK_URL` (worker), Supabase URL + keys.
9. **Port allocation** — web `3000`, Chaos Lab `3001`, worker `3002`. Two concurrent panes each
   starting a dev server on 3000 is a silent half-hour of confusion.

Rails 8 and 9 exist because Pro and Flash now run **concurrently in separate panes** (decision locked
2026-08-12). Concurrency makes one-file-one-owner load-bearing rather than merely tidy, and it makes
the lockfile the single most likely collision point in the week.

---

## 8. Mandatory Opus review — regardless of author

Cross-model review, not self-review. Anything in these categories gets read by Opus before it counts
as done:

- Subprocess spawning, argv construction, timeout/kill handling
- Anything calling `scraper heal`, `scraper approve`, or reading `budget`
- Generated SQL, and the database role it runs as
- Environment variables and anything that could log an API key
- The FHS scorer (Flash writes it, but it's the number every decision depends on)
- Migrations

Everything else — components, exports, styling, the Chaos Lab — ships on its author's verification.
Reviewing all of it would spend Opus's week on the cheap 80%.

---

## 9. Escalation rules

**Promote a task up a tier when:**
- An agent has asked two clarifying questions on one brief → the task needs judgment; move it up
- Flash produces a third failing attempt at the same acceptance criterion → Opus takes it
- A task turns out to need context from files outside its ownership → it was mis-scoped; Opus takes it

**Demote down a tier when:**
- Opus is writing something fully specified with an instant test → hand the *spec* to Flash instead
- You're waiting on Opus while Flash idles → find the volume slice and split it

The three-strikes rule matters most: two agents ping-ponging a failing task is the single most common
way multi-agent setups end up slower than one agent working alone.

---

## 10. Prompt exemplars

Three full briefs, one per tier. Adapt the template for everything else.

### 10.1 FLASH — Chaos Lab (Day 1, first task)

```
## OBJECTIVE
A deployable Next.js page listing 12 fake laptop products, which renders in two structurally
different DOM layouts controlled by a ?layout= query param. This is a scraping target we control
so we can trigger a realistic site-redesign break on demand.

## FILES YOU OWN
- apps/chaos-lab/** (entire app, yours alone)

## INPUTS
- 12 products: name, base_price (900–2400), ram_gb, storage_gb, in_stock (bool), image url placeholder.
  Hardcode them in one file.
- A hardcoded PRICE SCHEDULE: a list of { product_id, date, multiplier } entries covering
  Aug 17–23 2026. Rendered price = base_price × (product's most recent multiplier on or before today),
  computed server-side from the current date.
  Include at minimum:
    · product 3  — 0.89 from Aug 19  (an 11% drop, the one the demo points at)
    · product 7  — 1.06 from Aug 20  (a rise, so the chart isn't all one direction)
    · product 5  — in_stock flips false on Aug 21, true again on Aug 22
  Everything else stays flat.

## ACCEPTANCE
1. /?layout=v1 renders a <table> with <td class="product-name">, <td class="price"> showing "$1,299.00"
2. /?layout=v2 — TOTAL BREAK. The SAME 12 products as a CSS-grid of <div> cards, price nested inside
   <div class="pricing"><span class="amount">1299</span><span class="currency">USD</span></div>.
   Shares NO class names and NO tag structure with v1. EVERY v1 selector must fail.
3. /?layout=v3 — PARTIAL BREAK. Identical to v1 in every respect EXCEPT the price cell, which becomes
   <td class="price"><span class="cur">$</span><span class="val">1299</span><span class="cents">.00</span></td>.
   Product name, RAM, storage and stock keep their v1 markup exactly. Only the price extraction breaks.
4. All three render server-side (no client-only hydration of product data).
5. Prices are DETERMINISTIC, not random: the same date always renders the same price. Two requests
   one minute apart return identical values; a request on Aug 19 returns product 3 at 0.89× its base.
   No randomness, no per-request jitter, no database.
6. Deploys to Vercel with no env vars required.

## WHY THE PRICE SCHEDULE (context, not a task)
The demo shows five days of price history scraped from live sites. Real retailers may not move a
price all week, which would leave the chart flat with nothing to narrate. The Chaos Lab is a public
site we own, so making its prices genuinely move means the scraper collects REAL data through the
REAL pipeline and the chart has guaranteed, known-in-advance movement.
Determinism is the requirement that makes this honest rather than theatrical: the price on Aug 19 is
what it is because the site published that price on Aug 19, and anyone can re-request it and get the
same answer. Do NOT randomize — a chart that can't be reproduced is a chart nobody can verify.

## WHY THREE LAYOUTS (context, not a task)
The engine treats severity differently: a total break auto-heals unattended, a partial break halts and
asks a human. v2 produces the first, v3 the second. Both are filmed. If v3 breaks more than the price
field, the partial path can't be demonstrated — keep the rest of v3 byte-identical to v1.

## FORBIDDEN
- No dependencies beyond what Next.js ships with. No UI library.
- Do not touch anything outside apps/chaos-lab/.

## STOP AND ASK IF
- Anything above is ambiguous about the DOM structure. The DOM structure is the product here;
  do not improvise it.
```

Why this is the right Day-1 Flash task: fully specified, verifiable in ten seconds by eye, zero
shared context, and it unblocks Opus's entire healing loop. It's also cheaper to develop against all
week than burning Bright Data credits on real sites.

### 10.2 PRO — Health Monitor (Day 3)

```
## OBJECTIVE
The live scraper health panel: a headline status badge, a sub-caption exposing the fine-grained
state, an FHS gauge, and an episode-in-progress strip. Updates live via Supabase Realtime.

## FILES YOU OWN
- apps/web/components/health/**

## INPUTS
- Import RunState (16 values) and FieldHealthScore from @weaver/contracts. [paste enum here]
- Four HEADLINE labels only: Idle · Scraping… · ⚠️ Layout Change Detected — Healing… · ✅ Pipeline
  Restored. Every one of the 16 states maps to one of these four, plus a sub-caption showing the
  precise state. [paste the mapping table from doc 01 §2.1]
- Realtime: subscribe to `runs` rows filtered by collector_id. Assume the row shape in contracts.

## ACCEPTANCE
1. All 16 states render without layout shift — verify by driving a state-cycling storybook route
2. Transition Scraping→Healing→Restored animates; it must not flash or jump
3. FHS gauge is colour-coded at the doc-01 thresholds (0.95 / 0.60) and readable in dark mode
4. Loading, empty (no runs yet), and error (realtime disconnected) states all designed
5. Screenshot every state at 1440px and 390px and attach them

## FORBIDDEN
- Do not modify contracts, do not write the realtime client (it exists in lib/), do not touch
  anything outside components/health/.

## STOP AND ASK IF
- A state has no sensible visual treatment — that's a design gap in doc 01, flag it.
```

Note what this brief does: it hands Pro the *complete* state list up front. The most expensive Pro
failure is designing four states beautifully and discovering twelve more on Day 5.

### 10.3 OPUS — Healing worker (Day 3–4)

Not a paste-prompt; this is Opus working from doc 01 directly. Scope boundary:

```
Implement docs 01 §2 (state machine), §4.3 (transient probe), §5 (diagnosis builder),
§7 (approval gate), §9 (circuit breaker), §10 (ledger writes).

Owns: packages/healing/**, apps/worker/**, app/api/**, supabase/migrations/**
Consumes: packages/validation (Flash) via the frozen interface — do not reimplement the scorer.
Hard rule: --auto-approve is never passed. Leave a comment saying so where it would go.
Every state transition writes a ledger row before the next call is made — the audit trail must
survive a crash mid-episode.
```

---

## 11. Winning Spider-Sense as a side effect

The clean-code prize is a third prize you're not currently targeting, and this structure earns most
of it for free:

- Clear package boundaries with single owners → the repo *reads* as designed rather than accreted
- `docs/decisions/` ADRs → visible human architecture, which is also the defense against the
  "entirely AI-generated" disqualification clause
- One config object holding the FHS thresholds instead of magic numbers scattered across files
- Consistent handoff briefs → consistent code style across three different models

Add to every brief: *"Match the existing file's comment density and naming. Do not add a header
comment block."* Three models left to their own conventions produce a repo that looks like three
repos, and that's exactly what a clean-code judge is scanning for.

---

## 12. Open questions for the architect

1. ~~Does Antigravity run both models in one workspace?~~ **RESOLVED 2026-08-12** — Pro and Flash run
   **concurrently in separate panes**, with one-file-one-owner strictly enforced and rails 8–9 (§7)
   guarding the lockfile and ports. Escape hatch if context-switching becomes the bottleneck: demote
   Flash to **pure-function bug fixes only** — no new files, no new surface — and let Pro carry the
   remaining UI. Trigger that demotion the moment you're spending more time routing than reviewing.
2. **Who writes tests?** Recommendation: Flash writes tests for pure functions from a spec; Opus
   writes the one integration test that matters (full break→heal→restore against the Chaos Lab).
   Nobody writes component tests — no payoff in seven days.
3. **Rate limits.** If Opus throughput becomes the bottleneck mid-week, the release valve is §9's
   demote rule: hand Flash the spec instead of the implementation.
```

*Next in the suite: 03 — Revised PRD & System Architecture · 04 — Demo Script.*
