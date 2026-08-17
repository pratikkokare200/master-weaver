# ADR-005 — No bypass override for the approval gate

- **Status:** Accepted — feature deferred beyond the hackathon window
- **Decided:** 2026-08-12 (pre-build)
- **Affects:** `@weaver/healing` (approval gate), `apps/web` (collector panel)
- **Related:** ADR-003 (why we never pass `--auto-approve`), doc 01 §3.2, §7 · doc 05 §6

> Staged pre-build. Copies to `docs/decisions/` in the repo on Day 7.
> **Edit this into your own voice before committing.** The submission rules reject work with no
> meaningful human contribution, and an ADR is the clearest place to demonstrate the opposite — it
> should read like the person who made the call wrote it, because you did.

---

## Context

Bright Data's `scraper heal` offers `--auto-approve`, which commits an AI-proposed repair without
review. Master Weaver deliberately never passes it (ADR-003). Instead, every proposed fix returns to
us at an approval gate, is scored against the same contract that detected the break, and is committed
only above a stricter threshold — or rejected.

A reasonable product question was raised during planning: mature developer tooling almost always
offers an "ask me / do it automatically" preference, and IDEs in particular have trained users to
expect an *"I know what I'm doing, stop asking"* override. Should Master Weaver ship a per-workspace
**Bypass Approval** toggle, behind a warning dialog?

The system already expresses graded autonomy. Since 2026-08-12 the engine treats severity as the
authorisation signal:

| Field Health Score | Reading | Behaviour |
|---|---|---|
| < 0.60 | Catastrophic layout failure | Repairs autonomously |
| 0.60 – 0.95 | Partial breakage, most fields healthy | Halts, notifies, waits for a human |

So the question is not whether the product supports tiered autonomy — it does. The question is
whether a user should be able to switch the verification step off entirely.

## Decision

**Defer the override. Ship no user-facing bypass in v1.**

Retain the two-tier severity policy exactly as built, and add a **static, read-only Collector Policy
Block** to the UI that states both rules in plain language (doc 05 §6).

## Rationale

**1. The approval gate is the single most load-bearing code path in the architecture.**

Every repair — autonomous or operator-authorised — flows through the same sequence: receive canary
sample, score against contract, commit or reject. There is no second path. A bypass toggle means
introducing a conditional branch into precisely that sequence.

The build window ends with a hard feature freeze on Day 6, which is also the day the chaos drill runs
and the fallback demo is recorded. A branch added on Day 5 that silently mis-routes — committing
without scoring, or scoring but failing to log — would most likely surface during that drill, with no
schedule left to diagnose it. **The risk is not the cost of writing the feature; it is the cost of
being wrong about it in the last 48 hours.** That reasoning would hold even if the change took five
minutes.

**2. The capability is not actually missing.**

Tiered autonomy already ships. A bypass is a third notch on an axis the product already exposes, not
an absent capability. The gap was never in the behaviour — it was that nothing on screen *said* what
the behaviour was. A judge or user watching one break heal itself and another stop had no visible
explanation. That gap is closed by the Policy Block at effectively zero engineering risk.

**3. Deferring is a stronger product signal than shipping it.**

An override that lets a user turn a verified repair pipeline back into an unverified one is a real
feature with real demand, and it deserves a proper design — scoping, re-confirmation rules, audit
semantics. Bolting it on under time pressure would produce the weak version of it.

## Consequences

**Accepted:**
- The gate keeps exactly one code path through the chaos drill and the recording.
- A ledger invariant holds unconditionally: **every committed fix carries a canary score ≥ 0.90.**
  Nothing in the audit trail requires an asterisk.
- The Policy Block communicates tiering without implying configurability that does not exist.

**Costs:**
- A user who trusts a source and wants raw speed has no escape hatch. Accepted; no user has asked,
  and the autonomous path already covers the catastrophic case where speed matters most.
- Someone may read the Policy Block and expect the thresholds to be editable. Mitigated by rendering
  it as a statement rather than a disabled control.

## Alternatives considered

**A. Pass `--auto-approve` when bypass is enabled.** *Rejected.* The flag surrenders the canary sample
entirely — Bright Data commits without returning one. There would be nothing to record, so bypassed
repairs would be invisible in the ledger. That converts an audit trail with a documented exception
into an audit trail with a hole.

**B. Build it, but keep it out of the demo.** *Rejected.* The cost being avoided is the risk to the
gate, not the hour of implementation. Not filming it removes none of that risk.

**C. Global (account-wide) setting rather than per-collector.** *Rejected on blast radius.* A single
switch that silently disables verification across every scraper is the wrong default shape for a
safety control, regardless of when it ships.

## If revisited (v2 design constraints)

Recorded now so the eventual implementation doesn't relearn this:

1. **Frame it as a trusted-source fast path, not a safety bypass.** The distinction is not cosmetic —
   it determines the correct default (off), the correct scope (per-collector), and the correct copy.
2. **Still run `heal` without `--auto-approve`.** Receive the canary, score it, and **write the score
   to the ledger** — then commit regardless. The ledger then reads *"scored 0.72, committed under fast
   path"* rather than going silent. Fast path removes the gate, never the record.
3. **Scope per-collector**, never globally.
4. **Require re-confirmation after any quarantine.** A collector that has already exhausted its repair
   attempts is the last one that should be committing unverified fixes.
