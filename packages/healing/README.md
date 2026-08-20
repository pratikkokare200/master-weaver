# @weaver/healing

The engine's brain: **which edge to take, and why.**

`@weaver/contracts` owns the transition *table* — which edges exist. This package owns the decisions
over it, the rails that stop those decisions running away, and the string that decides whether a
repair actually works.

Everything here is pure and synchronous. The entire repair loop can be exercised without a database,
a subprocess, or a Bright Data account — which is the point: this is the last component in the system
that should be hard to test.

```
npm run build
npm test        # 64 tests
```

## What's in it

| Module | Owns |
|---|---|
| `machine.ts` | One function per decision point in doc 01 §2.2, each returning its next state *and its reason* |
| `breaker.ts` | The five rails from doc 01 §9, plus the transient backoff schedule |
| `diagnosis.ts` | The evidence bundle and the ≤1000-character description sent to `scraper heal` |

## The one rule

**`--auto-approve` is never passed.** Every proposed fix is scored at the gate before it is
committed. The flag is absent from `healScraper` and additionally rejected at the spawn boundary by
`assertNoForbiddenFlags`, so it cannot be reintroduced by hand-rolling an argv. See ADR-003, ADR-005,
and doc 01 §1 / §6.1 / §8.

This is not stylistic. `heal` rewrites the collector **in place, preserving the collector id**, and
the CLI exposes no version history. Rejection at the gate is the only true undo the platform offers,
so the architecture follows from the constraint.

## Severity gates autonomy

The tiering *is* the product statement, and there is no toggle (architect decision 3):

| FHS | Reading | Path |
|---|---|---|
| < 0.60 | Catastrophic layout failure | `BROKEN` → repairs **autonomously** |
| 0.60 – 0.95 | Partial breakage, most fields healthy | `DEGRADED` → `PENDING_OPERATOR`, waits for a click |

`decideAfterDegraded()` has exactly one outcome, and the transition table permits exactly one edge
out of `DEGRADED`. A partial break cannot repair unattended even by mistake.

The database enforces the matching invariant as a CHECK constraint, so `authorisedBy()` disagreeing
with the schema fails on write rather than surfacing later as a misleading ledger row.

## Asymmetric thresholds

A break can trigger a repair at 0.59. The canary that proposes to fix it must score **0.90**.

A fix has to be clearly good, not merely better than broken. Rejecting is cheap; committing
something wrong cannot be undone.

## The decisions

```
RUNNING            → decideAfterRun            → VALIDATING | TRANSIENT_RETRY
VALIDATING         → decideAfterValidation     → HEALTHY | DEGRADED | BROKEN
TRANSIENT_RETRY    → decideAfterTransient      → RUNNING | BROKEN | QUARANTINED
DEGRADED           → decideAfterDegraded       → PENDING_OPERATOR        (always)
BROKEN             → decideAfterBroken         → DIAGNOSING | QUARANTINED
PENDING_OPERATOR   → decideAfterOperator       → DIAGNOSING | IDLE | QUARANTINED
DIAGNOSING         → decideAfterDiagnosis      → HEALING
HEALING            → decideAfterHeal           → AWAITING_APPROVAL | QUARANTINED
AWAITING_APPROVAL  → decideAfterGate           → CANARY_VALIDATING
CANARY_VALIDATING  → decideAfterCanary         → APPROVING | REJECTING
REJECTING          → decideAfterRejection      → DIAGNOSING | QUARANTINED
APPROVING          → decideAfterConfirmation   → RESTORED | QUARANTINED
```

Every decision carries a `reason`. It is written to the ledger, shown in the UI, and narrated in the
demo — a machine that can say why it stopped is the difference between a product and a script.

`decide()` throws on an edge the frozen table does not contain. Unreachable by construction, and
thrown rather than logged: a machine that has invented an edge is one whose ledger can no longer be
trusted, and continuing would write that untrustworthy row to an append-only table.

## Transient vs structural

The distinction doc 01 §4.3 calls the most common way naive implementations of this loop fail.

A page that still serves content means our extraction broke → **heal**. A page that blocks, captchas
or 500s means the site is refusing us → **quarantine, not repair**. Healing a scraper because
Cloudflare had a bad afternoon is how a working scraper becomes a broken one.

An *unprobed* failure also quarantines. Refusing to heal on unverified evidence is the whole stance.

## The diagnosis builder

Doc 01 §5 calls this "the core intellectual property of this project", and the reason is that three
structural properties decide whether a repair lands:

1. **Before and after, per field.** "price stopped working" is a complaint. "price was 100% filled
   returning `1299`, now 30% filled returning nothing" is a specification.
2. **Naming the healthy fields.** Unconstrained healing has a habit of "fixing" fields that were
   never broken. Pinning them is free insurance.
3. **Page context.** The ~400 characters around the last-known-good value tell the healer where the
   data *moved to* — the one thing it cannot work out from our side.

The 1000-character budget is spent deliberately. Page context truncates first, before/after examples
last, and the closing instruction never truncates at all — losing it does not merely cost
information, it causes damage.

A real output, 552 characters:

```
The scraper stopped extracting 1 field(s) after a site layout change.

BROKEN: price: was 100% filled, now 30%. Previously returned 1299, now returns nothing.

STILL WORKING: product_name, ram, storage, in_stock

The value now appears on the page near this content:
Product table. AeroBook Pro 14 16 GB 512 GB <div class=pricing><span class=amount>1299</span>…

Please update the extraction logic for the broken field(s) only. Do not change the fields that still work.
```

On rejection, `refineDiagnosis` appends what the last attempt got wrong. Resending an identical
description spends credits to reproduce the fix we just rejected.

## What is deliberately not here

The orchestrator that calls Bright Data and writes the ledger. That belongs to the worker, which owns
the I/O. Keeping the decisions separable from the plumbing is what makes both testable.
