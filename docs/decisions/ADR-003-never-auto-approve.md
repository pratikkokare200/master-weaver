# ADR-003 — We never pass `--auto-approve`

- **Status:** Accepted
- **Decided:** 2026-08-17, before the heal path was written · revised 2026-08-20 after the first live heal
- **Affects:** `@weaver/brightdata` (`config.ts`, `spawn.ts`, `commands.ts`), `@weaver/healing`, `apps/worker`
- **Related:** ADR-005 (no bypass override) · ADR-002 (the contract the canary is scored against) · doc 01 §1, §6.1, §8

---

## Context

`brightdata scraper heal` accepts `--auto-approve`. With it, the CLI repairs the collector and
commits the new template in one call. Without it, the call stops at an approval gate and returns a
**canary sample** — the rows the proposed repair actually produces — and waits.

The flag is the difference between a scraper that fixes itself and a scraper that *proposes* a fix.
It is also, in a hackathon with a demo to record, an extremely tempting three seconds of saved
latency and one fewer state in the machine.

The thing worth being precise about: `--auto-approve` does not merely skip a confirmation step. It
**surrenders the canary sample**. There is no repair to score, because the repair has already
shipped. Whatever the new template does, we would find out on the next scheduled run, from
production, alongside the users.

## Decision

**We never pass `--auto-approve`.** Not behind a flag, not in tests, not for the demo.

`heal` is always called in its gated form. The canary sample comes back, gets scored by
`@weaver/validation` against the same contract that detected the break, and is committed only above
a **stricter** threshold than the one that raised the alarm — 0.90 against a break declared below
0.60 — or rejected, refined and retried.

Enforcement is at the spawn boundary rather than at the call site:

```ts
export const FORBIDDEN_FLAGS = ['--auto-approve'] as const;

export function assertNoForbiddenFlags(argv: readonly string[]): void { … }
```

`assertNoForbiddenFlags` reads the **argv**, not a parameter. Every CLI call in the system goes
through one spawn function, and that function inspects the arguments it is about to execute. A
caller that hand-rolls an argv still hits it; there is no `allowAutoApprove` option to set.

## Rationale

**The approval gate is the product.** "It fixed itself" is a claim anybody can make. "It fixed
itself, scored the fix at 1.000 against the contract that caught the break, confirmed it against a
golden set, and here is the ledger row" is a different claim, and the gate is the only reason the
second one is available. Removing it does not make the system faster; it makes it unfalsifiable.

**A committed repair is not reversible.** `--auto-approve` mutates the collector's template on Bright
Data's side. The gate is the only real undo the platform offers — refusing a bad repair costs a
credit, discovering one after it has shipped costs a scraping window and every row collected in it.

**We could not have caught what we caught.** Two of the five live episodes were quarantined by the
confirmation step because the repair scored a legitimate 1.0 on the page it was shown and had not
fixed the page that was broken. With `--auto-approve` those two templates would have been committed,
the ledger would have said RESTORED twice, and the collector would have been quietly serving a
template for a layout that was never broken. **The verification did not just gate the repair; it
found a bug in our own test harness.**

**The gate is what makes the failure legible.** A rejected attempt is a ledger row with a diagnosis,
a canary score and a reason. An auto-approved bad repair is a run that started returning worse data
at some point.

## The 2026-08-20 revision: `--auto-save` was banned too broadly

`--auto-save` was originally forbidden alongside `--auto-approve`, as a pair. That was right for
`scraper heal`, where `--auto-save` commits the template as part of the heal and skips the review
that is the entire product — and **wrong for `scraper approve`**, where the review has already
happened and the flag is what makes the approval take effect.

Without it, `approve` returns `{"status":"done"}` and the collector keeps serving the old template.
A success message, a spent credit, and no change. The tell, when we found it, was in the response
itself: `completed_steps` ended at `user_approval` instead of reaching `save_new_template`.

The ban is now **scoped by command**, read from the argv:

```ts
export const AUTO_SAVE_ALLOWED_ON: readonly string[] = ['scraper', 'approve'];
```

`--auto-save` is permitted only when the argv begins `scraper approve`, and `--auto-approve` remains
unconditionally forbidden — so the dangerous pair cannot form, while the flag that makes a reviewed
approval real is allowed exactly where the review has already happened.

Worth stating plainly: **the original decision was correct and its implementation was too coarse.**
The fix narrowed the ban rather than weakening it.

## Consequences

**Accepted:**

- One invariant holds without exception across the whole ledger: **every committed fix carries a
  canary score ≥ 0.90.** Nothing in the audit trail needs an asterisk.
- The rejection path exists, which means refinement-on-rejection exists, which means "attempt 1
  rejected at 0.71, attempt 2 approved at 0.98" is a thing the ledger can show.
- A heal that goes wrong costs a rejected attempt, not a broken collector.

**Costs:**

- A healing episode takes 30–60 seconds instead of ~20, and the extra CLI round trip is a real
  credit.
- More states, more code, more to get wrong — the state machine carries `AWAITING_APPROVAL`,
  `CANARY_VALIDATING`, `APPROVING` and `REJECTING` because of this decision.
- A repair that is genuinely correct can still be refused if the canary sample is unrepresentative.
  Accepted deliberately: refusing a good fix costs a retry, accepting a bad one costs data.

## Alternatives considered

**A · `--auto-approve` when the break is total (FHS < 0.60).** Superficially reasonable — a collector
returning nothing cannot be made worse. Rejected because it confuses two different questions.
Severity decides *whether a human must authorise the repair* (ADR-005); it says nothing about whether
the repair should be *verified*. Verification is cheap and always worth it. What autonomy buys is
skipping the human, not skipping the check.

**B · Auto-approve above a canary threshold, gate below it.** Circular: the canary sample is what the
threshold would be applied to, and `--auto-approve` is precisely the flag that means no canary sample
is returned. There is nothing to threshold on.

**C · Auto-approve in tests, gated in production.** Rejected. The test suite would then exercise a
path production never takes, and the one that production does take would be the untested one.

## If revisited

1. **Keep the canary regardless.** If a fast path is ever wanted, call `heal` without
   `--auto-approve` anyway, score the sample, write the score to the ledger, and *then* commit
   unconditionally. The ledger reads *"scored 0.72, committed under fast path"* instead of going
   silent. A fast path may remove the gate; it may never remove the record.
2. **Any new flag is forbidden until it is understood.** The `--auto-save` episode cost a spent
   credit and an unexplained no-op. `FORBIDDEN_FLAGS` should stay a deny list read from the argv,
   because that is the only place a flag cannot be hidden from.
