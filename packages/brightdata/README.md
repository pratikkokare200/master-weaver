# @weaver/brightdata

The Bright Data CLI subprocess adapter. The CLI has no Node SDK, so every call to Bright Data in
this product goes through this package: spawning, shell quoting, timeouts, process-tree kills, JSON
parsing and secret redaction.

Verified against `@brightdata/cli@0.3.4`.

## It never passes `--auto-approve`

That refusal is the product, not a preference. `scraper heal` stops at an approval gate and returns
a canary sample of the proposed fix; we score that sample against the same contract that caught the
break and only then approve. `--auto-approve` would consume the sample, leave nothing to validate,
and commit a plausible-but-wrong fix that cannot be rolled back — healing rewrites the collector in
place and Bright Data exposes no version history.

The full reasoning is in the block comment on `healScraper` in `src/commands.ts`. It is enforced
three ways: the flag is absent from the wrapper, `assertNoForbiddenFlags` rejects it (and
`--auto-save`) at the spawn boundary so a hand-rolled argv can't sneak it in, and
`test/commands.test.mjs` fails if it ever appears.

## API

```ts
import { createBrightDataClient, isAwaitingApproval, extractCanarySample } from '@weaver/brightdata';

const bd = createBrightDataClient({ env: process.env, logger });

await bd.createScraper({ url, description });      // scraper create
await bd.runScraper({ collectorId, url });         // scraper run
await bd.runScraper({ collectorId, urls });        // golden-set confirmation (batched --urls)
await bd.healScraper({ collectorId, diagnosis, url }); // scraper heal — stops at the gate
await bd.approveHeal({ collectorId, url });        // scraper approve
await bd.rejectHeal({ collectorId });              // scraper approve --reject — the only rollback
await bd.probeUrl({ url });                        // scrape — transient-vs-structural probe
await bd.getBudget();                              // budget — credits per episode
```

Wrappers **do not throw for CLI failures** — they resolve a `CliResult` with `ok: false` and a
populated `error`, because the worker writes a ledger row for failures too. They throw only for
caller-side mistakes caught before spawning (bad arguments, forbidden flag, missing API key).

`CliResult.argvRedacted` and `.stderrExcerpt` map directly onto `healing_attempts.cli_argv_redacted`
and `.stderr_excerpt`.

## The two Windows hazards, and why the code looks like it does

Both were verified empirically on Windows 11 / Node 24 rather than assumed.

**1. `shell: true` does not escape arguments.** Node concatenates them and hands the string to
`cmd.exe` (it warns about this itself — DEP0190). Spawning a Chaos Lab URL unquoted produces:

```
argv received → ["https://site/?layout=v2"]
stderr        → 'pct' is not recognized as an internal or external command
```

The URL is truncated at `&` and the remainder is *executed*. `src/quote.ts` applies the two-layer
escape `cmd.exe` requires, and `test/quote.test.mjs` proves the round-trip through a real shell for
query-string `&`, spaces, commas, embedded quotes, `%PATH%`, backslashes, `|`, `>`, `&&`, `^`, `!`
and the empty string.

**2. `child.kill()` orphans the real process.** It reaches only the `cmd.exe` shim; the CLI's own
`node` process survives. Measured: a grandchild kept running for the full 60s after `kill()`
returned. Timeouts therefore use `taskkill /pid <pid> /T /F` on Windows, and a detached process
group signalled via negative pid on POSIX.

## Timeouts

`CLI_TIMEOUTS_MS` in `src/config.ts` — heal 300s, run 180s, scrape 60s (doc 01 §6.2); create 600s
and approve 300s are chosen, not specified. Each is enforced twice: passed to the CLI as
`--timeout <seconds>` so it gives up cleanly and returns parseable JSON, and as a hard tree-kill at
`timeout + KILL_GRACE_MS` as a backstop.

> If real heals start exceeding 300s on Day 4, raise `CLI_TIMEOUTS_MS.heal` — both layers read it.

## Auth

`BRIGHTDATA_API_KEY` from the environment, never in argv, never an interactive login on the server
(doc 01 §6.2). A missing key fails fast with a clear error instead of hanging until the deadline.
Pass `allowStoredCredentials: true` for local dev against `brightdata login`.

Auth failures are surfaced as `error.kind === 'auth'` — doc 01 §11 requires those to quarantine
immediately rather than trigger a heal.

## Scripts

```
npm run build
npm test            # builds, then 31 tests including an end-to-end run through a real .cmd shim
```
