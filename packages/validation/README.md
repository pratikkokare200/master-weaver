# @weaver/validation

The Field Health Score. `@weaver/contracts` declares the FHS result shapes and the `FhsScorer`
interface but deliberately ships no implementation — this is it.

Pure and synchronous: no I/O, no clock, no network. The same function scores a live run and a canary
sample, which is what makes the canary gate meaningful rather than decorative — a proposed fix is
judged by exactly the measure that caught the break.

One workspace dependency (`@weaver/contracts`), no external runtime dependencies, no test framework
beyond `node --test`.

## What's in it

| Module | Exports |
|---|---|
| `score.ts` | `scoreRun`, `scoreFhs`, `scoreCanary`, `evaluateField`, `coerceField`, `fhsScorer` |
| `values.ts` | `extractFieldValue`, `unwrapScalar`, `readPath`, `isFilled`, `NULLISH_TOKENS` |
| `coerce.ts` | `parseNumber`, `parseBoolean`, `parseText`, `parseUrl`, `normalizeNumericString` |

## Usage

```ts
import { scoreRun, scoreFhs } from '@weaver/validation';
import { classifyFhs } from '@weaver/contracts';

const { fhs, field_scores, failed_fields } = scoreRun(rows, contract);
classifyFhs(fhs);            // 'HEALTHY' | 'DEGRADED' | 'BROKEN'
failed_fields;               // ['price'] — the "what broke" list for the diagnosis prompt

// With run history and a golden-set result, for the penalty-adjusted number and the full breakdown.
scoreFhs(rows, contract, { trailingMedianRowCount: 40, goldenSetMatchRate: 2 / 3 });
```

`scoreRun` applies no run-level penalties — with no history and no golden-set result to pass in, both
are 1 — so its `fhs` is the weighted field score. Use `scoreFhs` when you hold either.

## The formula (doc 01 §3.2)

```
fill_rate(f)   = rows with a non-null, non-empty value / total rows
type_pass(f)   = rows whose value parses as the declared type / non-null rows
field_score(f) = fill_rate(f) × type_pass(f)

FHS            = Σ(weight(f) × field_score(f)) / Σ(weight(f))     weight = 2 if required else 1

row_penalty    = clamp(row_count / trailing_median_row_count, 0, 1)
golden_penalty = golden_set_match_rate
FHS_final      = FHS × row_penalty × golden_penalty
```

## The nested price envelope

The single most important thing this package does. A contract declares
`{ name: "price", type: "number" }`; the CLI returns `price: { value: 1299, currency: "USD",
symbol: "$" }`. Reading `row.price` and asking "is this a number?" answers *no* on a completely
healthy run, so a naive scorer reports FHS 0.71 for a collector that is working perfectly.

`unwrapScalar` reduces every value to its carrying scalar before it is measured — through the
type's wrapper keys (`value` / `amount` / `raw` for numbers, `url` / `href` for links), or through an
object's sole key. Two deliberate non-unwrappings:

- **An object with no carrying key stays an object.** `{ currency: "USD", symbol: "$" }` — the price
  envelope with the price gone — counts as present and fails the number check. Scored as a type
  failure, which is what it is.
- **A multi-element array stays an array.** A scalar field answering with five values means the
  selector widened and matched the whole list. That fails rather than silently taking the first.

`{ value: null }` unwraps to `null`, so it is scored as an **empty** field rather than a wrong type.
The envelope arrived and the price inside it did not, and the fill rate is where that belongs.

## Decisions worth knowing about

These are readings of the spec, not transcriptions of it. Each one is commented at its definition
and pinned by a test.

- **`range` is enforced as part of `type_pass`.** Doc 01 §3.4 leans on numeric sanity to catch `0`,
  `null` and `"$"` in a price — but `0` *does* parse as a number, so a pure type check waves it
  through. A value outside the declared `range` is treated as a type failure, which is what makes
  `range` do the job the contract declares it for.
- **`below_min_fill` compares `field_score`, not `fill_rate`**, per the `FieldScore` doc comment in
  `@weaver/contracts`. It is the stricter test: a field fully populated with garbage fails it, where
  a fill-rate comparison alone would call that healthy.
- **`false` and `0` are filled values.** The two a truthiness check drops — which would read every
  out-of-stock product, and every free item, as a scraping failure.
- **`type_pass` is 1 when nothing was filled.** There is no denominator, so there is nothing to fail,
  and `field_score` is already 0 via `fill_rate`. It keeps the ledger legible:
  `fill_rate 0.00 / type_pass 1.00` reads as "the field came back empty", which is the diagnosis.
- **A contract with no fields scores 0, not a vacuous 1.** It asserts nothing, so a run against it
  has demonstrated nothing (doc 01 §11: never "no data, assume fine"). The schema forbids the shape
  anyway.
- **Booleans read `"In Stock"` / `"Out of Stock"`.** The Chaos Lab and every retail site like it
  render availability as a string, so a `boolean` contract on `in_stock` has to read those or it
  would score 0 on a healthy run.
- **Text accepts numbers and booleans.** One field drifts between `16` and `"16 GB"` across runs
  without anything being wrong; failing a run for that is a false alarm.

### URL coercion

The `absolute` flag on the field contract decides the mode. With `absolute: true` a value must parse
as a full `http(s)` URL with a host — this is what catches a redesign that starts emitting `/p/123`
where a canonical link used to be. Without it, a site-relative reference also passes, provided it
contains a `/` and no whitespace; the `/` requirement is what stops `"1299"` or `"Out of Stock"`
counting as a URL, since without it nearly any string is a valid relative reference. Either way the
scheme must be `http` or `https` — `data:` and `javascript:` are failures, not URLs.

There is no `date` field type in `FIELD_TYPES`, so nothing here parses dates.

### Number coercion

Strict about the tail, lenient about presentation. `parseFloat("1299abc") === 1299` is exactly the
sloppiness that lets a broken run score healthy, so a string is normalised and then matched *whole*
against a numeric pattern. `1299`, `"1299"`, `"$1,299.00"`, `"1299 USD"` and `"1.299,00"` all parse;
`"1299abc"` and `"1299 <span>"` do not. Booleans are not 1 and 0 — a number field answering with a
boolean means the extractor grabbed the wrong node.

Where a single comma is genuinely ambiguous it is resolved by the length of its tail: `1,299` has
three trailing digits so the comma is a group separator (1299), `1,29` has two so it is a decimal
point (1.29).

## Tests

```
pnpm --filter @weaver/validation test
```

50 tests over `node --test`. The arithmetic is hand-computed against the doc 01 §3.1 contract
(weights 2 + 2 + 1 + 2 = 7) so every expected FHS can be checked by reading it. The case to look at
first is the partial break: price empty on 70% of rows, other three fields healthy, giving
`(2×1 + 2×0.3 + 1×1 + 2×1) / 7 = 0.80` — the demo's own break, in the DEGRADED band, which is the
number the whole tiering decision in §3.2 hangs on.

The last test scores `docs/samples/run_v1.json` — 24 rows of real captured CLI output — end to end,
and skips itself if the file is not present.
