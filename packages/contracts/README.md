# @weaver/contracts

The frozen vocabulary of Master Weaver: run states, thresholds, Zod contract schemas and ledger row
types. Everything else in the monorepo imports from here.

**Frozen Day 2 AM.** After the freeze, changes are additive only — Pro, Flash and the worker all
build against these names.

One runtime dependency (`zod`), no I/O, safe in both the Node worker and the browser bundle.

## What's in it

| Module | Exports |
|---|---|
| `states.ts` | The 17 `RunState` values, legal transitions, public labels, the six-way badge grouping |
| `thresholds.ts` | `FHS_THRESHOLDS`, `GOLDEN_SET_MAX`, breaker limits, CLI input limits, `classifyFhs` |
| `contract.ts` | Zod schemas for the per-collector field contract (doc 01 §3.1) |
| `fhs.ts` | `FhsBreakdown` / `FieldScore` shapes and the `FhsScorer` interface — **implementation lives in `@weaver/validation`** |
| `db.ts` | `Collector`, `GoldenBaseline`, `Job`, `Run`, `HealingEpisode`, `HealingAttempt` |

## Usage

```ts
import {
  RunState, isLegalTransition, classifyFhs, FHS_THRESHOLDS, parseCollectorContract,
} from '@weaver/contracts';

const band = classifyFhs(0.80);                 // 'DEGRADED' → halts at PENDING_OPERATOR
isLegalTransition(RunState.DEGRADED, RunState.DIAGNOSING);   // false — degraded never auto-heals
const contract = parseCollectorContract(llmOutput);          // throws on malformed LLM output
```

`RunState` is a const object plus a union type rather than a TS `enum`, so it survives Node's native
type stripping and `isolatedModules`. `RunState.HEALTHY` and `: RunState` both work.

## Notes for the architect

- **Two enums are assumptions, not spec** — `CollectorStatus` and `JobState` are not enumerated in
  doc 01/03. They are marked `ASSUMPTION` in `db.ts`. Confirm before the freeze.
- **`HealingAttempt.canary_fhs`** follows doc 01 §10 / doc 03 §4. The task brief called the same
  field `canary_score`; the schema docs won. Rename here first if you prefer the other spelling.
- `Collector` is included although the brief listed only five tables — `collectors.contract` is
  where `CollectorContract` is persisted, and leaving it out would force another owner to define it.

## Scripts

```
npm run build       # tsc → dist/
npm run typecheck
npm test            # builds, then runs node --test against dist
```
