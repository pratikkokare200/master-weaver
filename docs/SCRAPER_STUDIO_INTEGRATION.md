# Scraper Studio Integration

How Master Weaver uses Bright Data Scraper Studio, what each call is for, and what we learned by
running the integration against the live API rather than a mock.

Everything below is drawn from the ledger of a running system. Where a number appears, it was
measured; where a limitation appears, we hit it.

---

## 1. The surface we use

Seven commands, wrapped one-to-one in [`@weaver/brightdata`](../packages/brightdata). Each wrapper
is a thin, typed adapter — argv construction, a subprocess deadline, JSON parsing and secret
redaction — with no business logic. Decisions live in `@weaver/healing`; this package only knows how
to talk.

| Command | Wrapper | Deadline | What it is for |
|---|---|---|---|
| `scraper create <url> <description>` | `createScraper` | 600 s | Build a collector from a natural-language intent. Run once per collector, by hand. |
| `scraper run <collector_id> [url]` | `runScraper` | 180 s | Every scheduled collection, every canary check, every post-repair confirmation. |
| `scraper heal <collector_id> <prompt>` | `healScraper` | 300 s | Repair a collector in place from a generated diagnosis. |
| `scraper approve <collector_id>` | `approveHeal` | 300 s | Commit a proposed fix that cleared our own gate. |
| `scraper approve --reject` | `rejectHeal` | 300 s | Discard a proposed fix that did not. The primary rollback. |
| `scrape <url> --format markdown` | `probeUrl` | 60 s | Fetch the page as text, through Web Unlocker. Two jobs — see §4. |
| `budget` | `getBudget` | 30 s | Credit balance, read before and after every episode. |

`zones` is used operationally rather than in code; §6 explains why it matters.

The depth is the point. A repair touches `budget → scrape → heal → run → approve → run` in one
episode, and every one of those calls has a distinct job. Using `run` alone would be a scraping
script; using the healing surface without `scrape` and `budget` would be a healing loop that cannot
tell a site redesign from a network blip and cannot say what a repair cost.

---

## 2. The one flag we never send

`scraper heal --auto-approve` would let a collector rewrite itself and ship the result unattended.
We refuse it, and the refusal is enforced twice: `healScraper` never constructs it, and
`assertNoForbiddenFlags` rejects it at the spawn boundary so no future caller can reintroduce it by
hand-rolling an argv.

This is the product thesis, not a safety default. An AI that repairs a scraper without review is a
demo. An AI that repairs a scraper, scores the repair against a contract it cannot edit, and stands
at a gate holding the evidence is a system you would let near production data.

Between the heal and the approval sits our own canary check (§3). Bright Data's `preview_result`
tells us what the proposed template extracts; we score that against the collector's contract and
approve only above `CANARY_GATE = 0.90`.

**`--auto-save` is a different flag and is permitted on exactly one command.** See §5 — this
distinction cost us a working repair before we understood it.

---

## 3. One episode, call by call

The sequence for an autonomous repair, as `apps/worker/src/episode.ts` runs it:

```
budget                    balance before, for credits_spent and the breaker's floor
  ↓
scrape <target>           is the page reachable and does it carry content?
  ↓                       transient failure → back off. Structural → repair.
heal <collector> <diag>   the diagnosis, built from evidence (§7)
  ↓                       returns status=awaiting_approval + preview_result
[our canary gate]         score preview_result against the contract
  ↓                       ≥ 0.90 → approve.  < 0.90 → reject, refine, retry
approve --auto-save       commit the template
  ↓
run <collector> <golden>  confirmation against the golden set
  ↓                       full match → RESTORED.  anything less → QUARANTINED
budget                    balance after
```

Every ledger row is written **before** the call it describes. A `healing_attempts` row that appeared
only after `scraper heal` returned would leave the most expensive and least reversible call in the
system with no record that it was made. An episode killed mid-flight is still auditable up to the
point of failure.

### The gate, and what has actually exercised it

Being precise about which parts have run against the live API matters more than the story sounding
complete, so:

**Live.** Three heal attempts have been sent to Bright Data. All three returned a
`preview_result` that scored **1.0000** against the contract, cleared the 0.90 gate, and were
approved. The gate has therefore been exercised live only in the direction of passing.

**Tested, not yet live.** The rejection path — canary below the gate → `approve --reject` → a
refined diagnosis on the next attempt → a second attempt that clears it — is proven against real
Postgres with a faked CLI, including that the two attempts send *different* descriptions and that
`--auto-approve` never reaches the client on any path. What has not happened is a real Bright Data
heal that scored badly enough to be rejected.

Rejected attempts are kept in `healing_attempts` with their `rejection_reason` and rendered in the
ledger panel. A system that shows you the fix it refused to ship is more convincing than one that
only ever reports success — but at time of writing it has not had cause to refuse one.

**The breaker, however, has fired for real.** Two of the five episodes in the ledger carry
`attempt_count = 0`: the circuit breaker refused them before a single call was made, because the
collector had already used its three heal attempts in a rolling 24 hours.

```
ep 166fa3df · 10:15 · QUARANTINED · attempts 0   ← breaker refused
ep eb9b86dd · 10:17 · QUARANTINED · attempts 0   ← breaker refused
```

Those two episodes cost nothing and are recorded anyway, which is the behaviour we wanted: a repair
that was declined is as much a part of the audit trail as one that ran. The rail was measuring
something true — the three attempts it counted were real calls that really did mutate the collector.

---

## 4. `scrape` does two jobs, and the second is the important one

The obvious use is page context for the diagnosis. The load-bearing use is telling a **transient
failure** apart from a **structural change**, which is the difference between backing off for sixty
seconds and spending credits rewriting a collector that was never broken.

- `run` fails **and** `scrape` fails → the site or the network is unwell. Back off, retry, spend
  nothing.
- `run` returns garbage **and** `scrape` returns a healthy page → the page changed. Repair.

Without this, every ambiguous failure resolves the same way. We shipped that state briefly without
realising: before the Web Unlocker zone existed, `scrape` failed unconditionally, so the probe was a
silent no-op and every ambiguous failure would have quarantined instead of healing. The code was
correct; the account was not provisioned for it. That is §6.

---

## 5. `approve` without `--auto-save` does not save

The most expensive thing we learned, and it is not in any error message.

`scraper approve` returns `{"status":"done"}` whether or not the healed template is persisted.
Without `--auto-save`, the AI job is marked approved and **the collector keeps serving the old
template**. Two runs after our first "successful" approval came back with the pre-heal fields.

The tell is in the response, if you know to look:

| | `completed_steps` ends with |
|---|---|
| `approve` | `… "user_approval"` |
| `approve --auto-save` | `… "user_approval", "save_new_template"` |

This fails closed rather than dangerously — the confirmation run scores a scraper that was never
changed, the golden set fails, and a perfectly good repair quarantines. Safe, but healing would
never once have succeeded.

We had originally banned `--auto-save` alongside `--auto-approve`, and that was over-broad. The two
are not a pair:

- On `scraper heal`, `--auto-save` commits the template as part of the heal itself. That skips the
  review, which is the product. **Still forbidden.**
- On `scraper approve`, the review has already happened — the canary was scored against the contract
  and cleared the gate. `--auto-save` is what makes that approval take effect. **Required.**

The ban is now scoped by command at the spawn boundary, read from the argv rather than passed in as
a parameter, because an `allowAutoSave` argument is one more thing a caller could set by hand.
`--auto-approve` remains unconditionally forbidden, so the dangerous combination cannot form.

---

## 6. The AI pipelines need a Web Unlocker zone

`scraper create` succeeded and its collector returned `error_code: "account_suspended"` on every
run. `scraper heal` returned HTTP 500 through all four of the CLI's internal retries. The dashboard
showed no suspension, no billing issue, nothing.

The account had one `dc` zone and no Web Unlocker zone:

```
$ brightdata zones --json
[{"name":"chaos_lab_proxy","type":"dc"}]

$ brightdata scrape https://example.com
✗ No Web Unlocker zone specified.
```

Provisioning `chaos_lab_unlocker` (type `unblocker`) cleared the 500s on the first attempt. The
generation and healing pipelines run through Unlocker infrastructure; an account without a zone gets
failures that look like account problems and are not.

Two things worth passing on:

- **`account_suspended` and HTTP 500 are both misleading here.** Neither names the missing
  prerequisite. If the AI endpoints fail on a healthy account, check `zones` first.
- **Authentication failures are 401, not 500.** We confirmed this by accident with a mangled key.
  A 500 is never a token problem, so rotating credentials is wasted effort.

`BRIGHTDATA_UNLOCKER_ZONE` is read from the environment by the CLI itself; no flag is threaded
through our wrappers.

---

## 7. What we send to `heal`

`scraper heal` takes one plain-language description capped at 1000 characters, and its quality
decides whether the repair works. Generating a good one from evidence is the core of the project.

Three things make a description work, all structural rather than stylistic:

1. **Before and after, per field.** "price stopped working" is a complaint. "price was 100% filled
   and returned 1299, now 0% filled and returns nothing" is a specification.
2. **Naming the healthy fields.** Unconstrained healing has a habit of "fixing" fields that were
   never broken. Pinning them is free insurance.
3. **Page context.** ~400 characters of the page around where the value used to be — the one thing
   the healer cannot work out from our side.

The budget is spent deliberately: when the description is too long, page context truncates first and
the before/after examples last, because the examples are the part the healer cannot reconstruct. The
closing instruction is never truncated.

A real diagnosis, from the ledger:

```
The scraper stopped extracting 5 field(s) after a site layout change.

BROKEN: product_name: was 100% filled, now 0%. Previously returned "AeroBook Pro 14", now returns nothing.
BROKEN: price: was 100% filled, now 0%. Previously returned 1299, now returns nothing.
BROKEN: ram: was 100% filled, now 0%. Previously returned "16 GB", now returns nothing.

The value now appears on the page near this content:
AeroBook Pro 14 16GB 512GB 1299USD Available Zenith Precision 16 32GB 1024GB 1899USD Available …

Please update the extraction logic for the broken field(s) only. Do not change the fields that still work.
```

### Strip inline binary before slicing the context

Our target page renders each product image as an inline SVG data URI, and **those SVGs carry the
product name as label text**. The naive context extractor searched the raw markdown for the
last-known-good value, found the copy buried inside the image payload — which appears first — and
centred its 400-character window there. The healer received `rx='2' fill='%230f172a'/%3E%3Cpolygon
points='20,126 220,126…` as its description of where the data went.

Stripping data URIs, inline SVG and long percent-encoded runs takes that page from **7,788
characters to 830, 89% removed**, and the context becomes five complete product rows.

The stripping runs **before the anchor search**, not just before the slice. Cleaning only the output
produces a tidy prompt still aimed at the wrong part of the page.

One implementation note: matching a data URI with `[^\s)"']*` does not work, because an SVG payload
contains spaces and quotes — the match stops a few characters in and leaves the body behind. Match
to the closing paren instead; the payload is percent-encoded, so a literal `)` would be `%29` and
cannot terminate the match early.

---

## 8. `heal` does not accept a URL

The single most consequential thing we learned, and it changed our test harness rather than our code.

```
Usage: brightdata scraper heal [options] <collector_id> <prompt>

  --url <url>   Verify target woven into the next-step hint.
                Not sent to the heal call; heal only mutates the scraper.
```

A heal always works against whatever target the collector already holds. We had been simulating a
site redesign with a query parameter — `?layout=v1` healthy, `?layout=v2` broken — and passing the
broken URL via `--url`. The healer never saw it. It previewed against the collector's own target,
where every field is present, scored a legitimate 1.0, and saved a template for the healthy layout.

Our canary was not fooled. It answered *"does this template work on the collector's target?"* — and
it did. We were asking the wrong question, and our own golden-set confirmation is what caught it:

```
canary_fhs 1.000  decision APPROVED
match_rate 0.000  final_state QUARANTINED
failures: row_count, field_shape, sample:AeroBook Pro 14…
```

**This is the argument for the confirmation step existing at all.** Trusting the heal response would
have had us reporting a successful self-heal that fixed nothing.

The fix is on our side: a breakage has to happen at the URL the collector already scrapes. Our Chaos
Lab now takes a server-side layout override, so the same URL starts serving different markup — which
is what a real redesign is, and the only shape of breakage this API can be asked to repair.

---

## 9. Cost, measured

| Call | Credits |
|---|---|
| `scraper create` | 0 |
| `scraper run` (12 products, one page) | 0 |
| `scraper heal` + `approve` | 0 |
| `scrape` (Web Unlocker) | not separately itemised |

Balance held at 55 across 54 runs and 5 healing episodes. We report `credits_spent` per episode as a
`budget` difference rather than an estimate, so the demo line "this repair cost N credits and M
seconds" is measured rather than modelled — and on this account, at this scale, the honest answer is
that the healing loop is close to free.

The breaker's `accountCreditFloor = 10` is set against an observed balance of 55 rather than a round
number pulled from the air.

---

## 10. Operational notes

**Secrets never reach a command line.** `BRIGHTDATA_API_KEY` is read from the environment; a launcher
loads `.env` in-process rather than writing the key into the process table via `cmd /c "set KEY=…"`.
Every logged argv is redacted through `formatArgvRedacted`, and the diagnosis is elided as
`<diagnosis>` so the ledger's `cli_argv_redacted` is copy-pasteable without leaking anything or
burying the row in 900 characters of prompt.

**The CLI retries; we do not wrap it in another retry.** `heal` retries internally four times on the
AI-Flow concurrency cap with exponential backoff (20 s → 33 s → 66 s → 191 s). Adding our own layer
on top would multiply the deadline without improving the odds. Our subprocess deadline sits
comfortably outside the CLI's own, with a 15-second grace before a tree kill.

**Every run's output is stored verbatim.** `runs.rows` is exactly what the CLI returned, duplication
and all — our collector emits each product once per discovered item, so 12 products arrive as 144
rows. We do not normalise on write. Readers de-duplicate; the ledger keeps the truth.

**One byte of that truth had to be dropped.** Postgres stores no NUL in `text` or `jsonb` at any
depth, and a scraped page is free to serve one. Values are stripped of NULs at the database seam,
because the ledger write is the last thing an episode does — by then the credits are spent and the
collector is mutated, so it is the worst possible place to discover unstorable input.

---

## 11. Summary of what we would tell the next team

1. Check `zones` before debugging anything else. The AI endpoints need Web Unlocker, and they fail
   in ways that name the wrong cause.
2. `approve` needs `--auto-save` or it silently does not save. Check `completed_steps` for
   `save_new_template`.
3. `heal` cannot be pointed at a URL. It repairs the collector's own target, and your test harness
   has to break that target rather than a different one.
4. `preview_result` is real and useful, and it answers a narrower question than it appears to.
   Confirm independently against something you captured yourself.
5. Strip inline binary from page text before you use it as prompt context, and strip it before you
   search that text, not after.
6. 500 is not authentication. 401 is.
