# ADR-005 — No bypass override for the approval gate

- **Status:** Accepted
- **Decided:** 2026-08-12 · reaffirmed 2026-08-19 before `@weaver/healing` was written
- **Affects:** `@weaver/healing` (approval gate), `apps/web` (collector panel)
- **Related:** ADR-003 (why we never pass `--auto-approve`) · doc 01 §3.2, §7 · doc 05 §6

---

## Context

`brightdata scraper heal` accepts `--auto-approve`, which commits an AI-proposed repair without
review. We never pass it (ADR-003). Every proposed fix comes back to us at an approval gate, gets
scored against the same contract that detected the break, and is committed only above a stricter
threshold — or rejected.

The question this ADR settles is a different one: should a user be able to switch that verification
off? Mature developer tooling almost always offers an "ask me / just do it" preference, and IDEs have
trained people to expect an *I know what I'm doing, stop asking* override. The proposal on the table
was a per-workspace **Bypass Approval** toggle behind a warning dialog.

The engine already expresses graded autonomy. Severity is the authorisation signal:

| Field Health Score | Reading | Behaviour |
|---|---|---|
| < 0.60 | Catastrophic layout failure | Repairs autonomously |
| 0.60 – 0.95 | Partial breakage, most fields healthy | Halts, notifies, waits for a human |

So this was never a question about whether the product supports tiered autonomy. It supports it
already. The question is whether the verification step itself should be switchable.

## Decision

**No bypass override in v1.** The two-tier severity policy stays exactly as built. The UI gains a
static, read-only **Collector Policy Block** that states both rules in plain language (doc 05 §6).

## Rationale

**The approval gate is the most load-bearing path in the system.** Every repair — autonomous or
operator-authorised — runs the same sequence: receive the canary sample, score it against the
contract, commit or reject. There is exactly one path. A bypass toggle puts a conditional branch
inside it.

Day 6 is a hard feature freeze, and it is also the day the chaos drills run and the fallback demo is
recorded. A branch added on Day 5 that mis-routes — committing without scoring, or scoring without
logging — would surface during that drill with no schedule left to diagnose it. The risk is not the
cost of building the feature. It is the cost of being wrong about it in the final 48 hours. That
holds even if the change took five minutes, which is the point: implementation cost is not the
variable that matters here.

**The capability was never missing — the explanation was.** Tiered autonomy ships today. A bypass is
a third notch on an axis the product already exposes. What was genuinely absent was anything on
screen telling a user *why* one break healed itself and another stopped and waited. That is a
communication gap, and the Policy Block closes it at zero risk to the gate.

**Deferring is the stronger signal.** An override that turns a verified repair pipeline back into an
unverified one is a real feature with real demand, and it deserves scoping, re-confirmation rules and
audit semantics of its own. Built under time pressure it would be the weak version, and the weak
version of a safety control is worse than none.

## Consequences

**Accepted:**

- The gate keeps one code path through both chaos drills and the recording.
- One ledger invariant holds without exception: **every committed fix carries a canary score ≥ 0.90.**
  Nothing in the audit trail needs an asterisk.
- The Policy Block communicates the tiering without implying a configurability that does not exist.

**Costs:**

- A user who trusts a source and wants raw speed has no escape hatch. Accepted — the autonomous path
  already covers the catastrophic case, which is where speed actually matters.
- Someone may read the Policy Block and expect the thresholds to be editable. Mitigated by rendering
  it as a statement rather than as a disabled control.

## Alternatives considered

**A · Pass `--auto-approve` when bypass is enabled.** Rejected. The flag surrenders the canary sample
entirely — Bright Data commits without returning one. There would be nothing to score and nothing to
record, so bypassed repairs would be invisible in the ledger. That turns an audit trail with a
documented exception into an audit trail with a hole.

**B · Build it, but keep it out of the demo.** Rejected. The cost being avoided is the risk to the
gate, not the hour of implementation. Not filming it removes none of that risk.

**C · A global, account-wide setting instead of per-collector.** Rejected on blast radius. One switch
that silently disables verification across every scraper is the wrong shape for a safety control no
matter when it ships.

## If revisited

Recorded now so the v2 implementation does not relearn it:

1. **Frame it as a trusted-source fast path, not a safety bypass.** Not cosmetic — the framing
   determines the correct default (off), the correct scope (per-collector), and the correct copy.
2. **Still call `heal` without `--auto-approve`.** Receive the canary, score it, write the score to
   the ledger, then commit regardless. The ledger then reads *"scored 0.72, committed under fast
   path"* instead of going silent. A fast path may remove the gate; it may never remove the record.
3. **Scope per-collector**, never globally.
4. **Require re-confirmation after any quarantine.** A collector that has already exhausted its
   repair attempts is the last one that should be committing unverified fixes.
