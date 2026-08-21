# ADR-002 — The validation contract: per-field fill rates, not a null check

- **Status:** Accepted
- **Decided:** 2026-08-18 · contracts frozen the same morning
- **Affects:** `@weaver/contracts` (`contract.ts`), `@weaver/validation` (the scorer), every collector row
- **Related:** ADR-005 (no bypass override) · doc 01 §3.1–§3.4

---

## Context

The engine has to answer one question before it can do anything else: **is this collector still
working?** Everything downstream — whether to heal, whether a repair may be committed, what the
dashboard shows — is a consequence of that answer.

The obvious implementation is a null check. Run the scraper, look at the first row, see if the
fields are there. It is a few lines and it is wrong about the failure that actually happens.

Real scrapers do not stop returning data. They return *slightly less* of it. A site redesign moves
one element and `price` comes back empty on 70% of rows while thirteen other fields keep working
perfectly. The first row is often one of the 30% that still parse. A null check on it reports
health, the dashboard stays green, and the price series quietly flattens for a week.

That is the failure this product exists to catch, so the measurement had to be designed for it
rather than around it.

## Decision

Every collector carries a **contract**: a declared list of fields, each with a type, a
`required` flag, and a **`min_fill`** — the fraction of rows that must carry a usable value.

```
fill_rate(f)   = rows with a non-null, non-empty value / total rows
type_pass(f)   = rows whose value parses as the declared type / non-null rows
field_score(f) = fill_rate(f) × type_pass(f)

FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))    weight = 2 required, 1 optional
FHS_final      = FHS × row_penalty × golden_penalty
```

The contract also carries a `row_count` rule and the golden set, because both are statements about
what this collector should produce and belong in the same place as the fields.

It is inferred once, by an LLM, from the user's sentence at creation time — and then it is **frozen**
and validated with Zod on every read, because LLM output stays untrusted even after a round trip
through our own database.

## Rationale

**A rate, not a boolean.** `fill_rate` measures every row, so the 70%-empty case scores 0.30 on
that field instead of passing on the strength of one lucky row. This is the whole reason the
contract exists.

**Two factors per field, multiplied.** A field can fail by going missing or by going wrong — an
`in_stock` that starts returning the string `"Currently unavailable"` is present on every row and
useless. `fill_rate` catches the first, `type_pass` the second, and multiplying means a field has to
pass both.

**Required fields weigh double, not infinitely.** Weighting is the honest expression of "a missing
price matters more than a missing RAM spec". Making a required field fatal would mean one flaky
optional selector could not be distinguished from a total collapse, and the severity split (ADR-005)
depends on being able to tell those apart.

**`min_fill` is per field, not global.** Different fields fail at different rates in normal
operation. A product page that legitimately omits a spec on 10% of listings is healthy; a price
missing on 10% is not. One global threshold would have to be set for the noisiest field, which is
the same as not having one.

**The healer cannot edit the contract.** This is the constraint that makes the rest mean anything.
A repair that could lower `min_fill` from 0.90 to 0.30 would always succeed, and the ledger would
fill with green rows describing a collector that had stopped working. The contract is the fixed
point the repair is measured against — *a repair that can lower its own bar is not a repair.*

**Unwrapping is part of the contract, not a hack around it.** `price` arrives from the CLI as
`{ value: 1299, currency: "USD", symbol: "$" }`. A `number` contract that read that object literally
would score 0 on a collector working perfectly. So values are unwrapped to their carrying scalar
before measurement — with two deliberate exceptions, because each is a real break: an object with
**no** carrying key stays an object and fails the type check (the envelope arrived without the
price), and `{ value: null }` unwraps to `null` and scores as empty (the envelope arrived, the value
did not).

## Consequences

**Accepted:**

- Partial breakage has a number, so the DEGRADED band exists and the severity split has something to
  split on.
- The same function scores a live run and a proposed repair's canary sample. The approval gate is
  not a second opinion — it is the same measurement, against the same contract that caught the break.
- `field_scores` is stored per run, so "price is filling 30%" comes out of the ledger rather than
  being recomputed from rows that may since have been superseded.

**Costs:**

- **A contract is only as good as its inference.** A field the LLM did not declare is unscored, and
  an unscored field cannot break. The Day-3 audit found exactly this: the live contract covered
  three fields and the collector was returning five. Nothing was wrong; nothing was watching either.
- Every field needs a `min_fill`, which is a number somebody has to choose. Chosen badly they are
  either noise or blind spots.
- Calibrating against a defect encodes the defect. `row_count.min` was set to 25 while the collector
  was emitting each of 12 products twelve times. When a heal repaired that duplication, 12 real rows
  fell below a floor calibrated on 144 duplicated ones. Fixed by moving it to 5 — but the general
  lesson is that a threshold derived from observed behaviour inherits whatever was wrong with it.

## Alternatives considered

**A · Schema validation only (Zod against a row shape).** Rejected. It answers "is this row
well-formed", which is a different question from "is this collector still working". A perfectly
well-formed row with an empty price passes.

**B · Anomaly detection on the value distribution.** Rejected for the build window, and probably on
the merits too: it needs history before it says anything, it cannot explain itself, and "the price
distribution shifted" is not a diagnosis you can hand to a repair. The contract produces a sentence —
*price is filling 30% of rows, expected 90%* — that goes straight into the heal request.

**C · One global fill threshold instead of per-field.** Rejected. It has to be set for the noisiest
field in the contract, which makes it useless for every other field.

**D · Let the healer propose contract changes for human approval.** Deferred rather than rejected.
There is a real case — a site genuinely stops publishing a field, and the contract is now wrong
rather than the scraper. But it needs its own approval path, its own audit trail, and a way to tell
"the field is gone" from "the selector broke", and none of that fits in the build window.

## If revisited

1. **Infer the contract from more than one page.** One page's structure is not the site's structure,
   and a field that is optional in reality reads as required from a single sample.
2. **Track `min_fill` against observed fill rates** and surface the ones that have never come close
   to failing — those are the thresholds doing no work.
3. **Contract versioning.** Today a contract is frozen; if D above is ever built, a run needs to
   record which version it was scored against, or the historical FHS series becomes meaningless.
