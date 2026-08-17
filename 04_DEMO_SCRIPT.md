# Master Weaver — Demo Video Script & Pitch Blueprint

**Document 04 of the Master Weaver planning suite**
Status: DRAFT — planning artifact, written 2026-08-12 (pre-build)
Depends on: `01_HEALING_STATE_MACHINE.md`, `02_AGENT_ALLOCATION_AND_REPO.md`
Target runtime: **3:45–4:00**

> Written before the build on purpose. This document is the feature freeze list. If a feature
> doesn't appear in a shot below, it is not required by Day 6 — and if it isn't working by Day 6,
> the shot gets cut rather than the schedule extended.

---

## 0. Three principles that decide whether this scores

**① The first 60 seconds must stand alone.**
A judge working through thirty submissions does not finish every video. Assume yours gets 60 seconds
of guaranteed attention and everything after is earned. Therefore: problem, product, and proof-of-life
all land before 1:00. No title card, no team intro, no agenda slide. Those cost you the only minute
you're certain to get.

**② Show the mechanism, not the feature list.**
Every hackathon demo is a feature tour. The ones that win show one thing working that shouldn't be
possible. Yours is a scraper repairing itself, unattended, on camera, with the evidence on screen.
That gets 90 of your 240 seconds — more than a third of the video on a single sequence. Everything
else is setup for it or payoff from it.

**③ Narrate the *why*, not the *what*.**
The rules require you to understand and explain your technical decisions, and one judging criterion
is presentation clarity. "Now I click the export button" is worth nothing. "We never pass
`--auto-approve`, because healing rewrites the collector in place — rejection at the gate is the only
real undo" is worth the whole criterion. Every line of narration below is a decision, not a click.

---

## 1. Rubric coverage map

Six equally-weighted criteria. Every one gets a dedicated beat — nothing is left to chance.

| Criterion | Beat | Timecode |
|---|---|---|
| Potential impact & problem-solving | Cold open (the silent break) + closing number | 0:00–0:20, 3:35–4:00 |
| Creativity & innovation | "We refuse `--auto-approve`" + severity triage + the rails | 2:20–2:35, 3:10–3:42 |
| Technical excellence | Diagnosis payload + canary gate + ledger | 2:00–3:10 |
| Use of Scraper Studio | Live `scraper create` → collector ID → rows | 0:40–1:10 |
| Reliability & self-healing | The centerpiece sequence + the degraded-halt | 1:40–3:25 |
| Presentation clarity | Production quality throughout; scripted, not improvised | — |

---

## 2. Pre-production requirements

The demo only works if the app is in a specific state on Day 6. These are build requirements, not
recording requirements — they trace back to specific days in doc 02.

- [ ] **Five days of real price history** on ≥3 tracked products (requires the cron started Day 2 — this is why that task is on Day 2 and not Day 5)
- [ ] **At least 3 completed ledger episodes**, ideally including one where attempt 1 was rejected and attempt 2 approved
- [ ] **At least one episode of each authorisation path** — `AUTONOMOUS` (from a v2 break) and `OPERATOR` (from a v3 break). Beat 5f has nothing to show without the second.
- [ ] **Chaos Lab deployed** with all three layouts (`v1` baseline, `v2` total break, `v3` price-only break) reachable in one click each
- [ ] **A real retail scraper running too** — the demo must not look like it only works on a site you built
- [ ] **Discord webhook live** and the channel visible in a second window
- [ ] **Credit meter** showing a real balance
- [ ] **Aggregate stats computed**: average credits per repair, average seconds per repair
- [ ] Browser at 1440×900, zoom 100%, no bookmarks bar, clean profile, notifications off

---

## 3. Shot list & narration

Timecodes are targets. Record in segments; assemble in the edit.

---

### BEAT 1 · Cold open — the silent break · `0:00–0:20`

**Screen:** A clean data table full of laptop prices. Cut to a browser tab: the source site, visibly
redesigned. Cut back: the same table, price column now empty. No error. Nothing red.

**Narration:**
> "This scraper worked yesterday. The site changed its layout overnight, and this is what breaking
> looks like — nothing errored. No alert fired. The rows just quietly stopped having prices.
> By the time anyone notices, you've lost a week of data."

**Why this opens the video:** it's the problem statement from the hackathon brief, shown rather than
claimed, in twenty seconds. It also plants the exact failure mode your detection layer is built for —
*partial, silent* breakage — so that §5's fill-rate explanation lands later instead of sounding
academic.

---

### BEAT 2 · What it is · `0:20–0:40`

**Screen:** The Master Weaver workspace. Sidebar, workspaces, clean shell.

**Narration:**
> "Master Weaver turns a sentence into a production scraper — and then keeps it alive.
> It runs on Bright Data Scraper Studio. Everything you're about to see is unattended."

*Do not explain the name.* If a judge catches the Spider-Verse reference it lands on its own; if they
don't, the sentence still works. Explaining a reference kills it and costs you five seconds.

**Note:** "and then keeps it alive" is the whole pitch. Say it once here, prove it at 1:40, and never
repeat it — repetition of a claim reads as insecurity about the proof.

---

### BEAT 3 · Build — natural language to Scraper Studio · `0:40–1:10`

**Screen:** Type into the command bar: *"Track laptop prices, specs, and stock from this store."*
Paste a URL. Submit. Show the status transition, then the collector ID appearing, then real rows
landing in the table.

**Narration:**
> "One sentence and a URL. Behind this, we're calling Bright Data's CLI —
> `scraper create` — which builds a real Scraper Studio collector and hands back its ID.
> No selectors, no schema. The rows are live within seconds."

**Critical:** the collector ID must be legible on screen. "Use of Scraper Studio" is a mandatory,
separately-scored criterion, and the cheapest way to lose it is for a judge to be unsure whether you
actually integrated it. Show the ID, say the command name.

---

### BEAT 4 · The data product · `1:10–1:40`

Fast cuts, roughly 10 seconds each. This is the Suit-Up beat.

**Screen A:** Table — sort by price, type a filter, columns respond instantly.
**Screen B:** Chart view — five days of real price history, with a visible drop on one product.
**Screen C:** Chat tab — ask *"which of these dropped the most this week?"* Answer appears **with the
generated SQL visible beneath it.**

**Narration:**
> "Sort it, filter it, chart it. This is five days of real price history — one product dropped
> eleven percent on Wednesday.
> And you can ask it questions. We don't do vector search over rows here — this is structured data,
> so the agent writes SQL and shows you the query. You can check its work."

**Why the SQL is on screen:** it converts a chat feature — which every project has — into a trust
feature, which almost none do. It also pre-empts the obvious judge suspicion that the answer was
hallucinated.

---

### BEAT 5 · THE CENTERPIECE — break it and walk away · `1:40–3:10`

Ninety seconds. One continuous sequence. Do not cut away to another feature.

**5a · The break** `1:40–1:55`
**Screen:** Second window, the Chaos Lab. Click the layout toggle. The page visibly restructures —
table becomes a card grid, prices move and change format.

> "This is a target site I control, so I can break it on demand. Same twelve products, completely
> different DOM — different tags, different class names, price nested two levels deeper.
> A selector written for the old layout cannot survive this.
> Now I'm not going to touch the app. The scheduled run fires on its own."

**5b · Detection** `1:55–2:10`
**Screen:** Health monitor. `Scraping…` → FHS gauge drops → `⚠️ Layout Change Detected`.

> "Notice it didn't wait for a crash. Eleven of fourteen fields still work — price is filling on
> thirty percent of rows instead of ninety-five. That's the failure that normally goes unnoticed,
> because a null check on the first row would say everything's fine.
> We score fill rate per field, not presence. Partial breakage is the common case."

**5c · Diagnosis** `2:10–2:25`
**Screen:** Expand the diagnosis panel. The generated description is on screen, readable.

> "Before healing anything, it checks whether the *page* is fine and only our extraction is broken —
> because healing a scraper because the site was briefly down is how you turn a working scraper into
> a broken one.
> Then it writes this. Bright Data's heal command takes a plain-English problem description, and its
> quality decides whether the fix works. So we build it from evidence — which fields dropped, what
> they used to return, what they return now, and where on the page the value moved to.
> Including one instruction that matters more than it looks: *don't change the fields that still work.*"

**5d · The gate — the line the whole project rests on** `2:25–2:45`
**Screen:** `Healing…` → `Reviewing proposed fix…` → `Verifying fix…` with a canary score animating in.

> "Bright Data ships a flag called `--auto-approve`. We never use it.
> Healing rewrites the collector in place and keeps the same ID — so once you approve, the old
> extraction logic is gone. There is no version rollback. Rejecting at this gate is the only real undo
> we have.
> So we take the sample it proposes, score it against the same contract that caught the break, and it
> has to clear a *higher* bar than the one that triggered the repair. Cheap to reject. Expensive to
> commit something wrong."

**5e · Recovery** `2:45–3:10`
**Screen:** Canary passes → `Committing fix…` → confirmation run against the golden set → `✅ Pipeline
Restored`. Then open the ledger entry: before/after, failed fields, canary score, credits, duration.

> "Canary clears, it approves, and re-runs against three pinned URLs we know the right answers for.
> Restored — no human involved.
> And every step is on the record: what broke, what it wrote, what the fix scored, what it cost,
> how long it took. Not 'trust me, it self-heals.' Here's the receipt."

**If you have a rejection episode in the ledger, show it here.** Ten seconds:
> "Here's one from Tuesday where the first proposed fix didn't clear the bar. It rejected it, rewrote
> the description with what went wrong, and the second attempt passed."

A system that catches its own bad fix is dramatically more convincing than one that always succeeds
on the first try. Judges who have run scrapers in production will notice.

---

### BEAT 5f · It doesn't always decide alone · `3:10–3:25`

Added by architect decision 3 (doc 03 §9.1). Fifteen seconds, and it converts a constraint into the
strongest claim in the video.

**Screen:** Flip the Chaos Lab to `?layout=v3` — visually near-identical to v1, only the price cell
markup changed. The run fires. FHS drops to 0.80, badge goes amber: `⚠️ Degraded — repair needs your
approval`. **No heal is issued.**

The Discord alert arrives carrying the failing field, the health delta, and the proposed fix. **Click
the link in the message** — it lands directly on the collector with the repair confirmation already
open. Click *Repair*, then the same gate sequence runs through to Restored, compressed.

> Film the Discord→dashboard transition as **one continuous click**, not a cut. It reads as a designed
> flow rather than two features stapled together, and it keeps every frame of the payoff inside your
> product — Discord gets three seconds of screen time, your UI gets the rest.

> "That was catastrophic — every selector dead. This one isn't. One field moved, thirteen still work,
> health is at eighty percent.
> So it stops. It doesn't heal, it doesn't guess — it tells me what changed and waits.
> Below sixty percent it repairs itself. Between sixty and ninety-five, a human decides.
> A system that heals everything automatically will eventually automatically heal something it
> shouldn't have."

**Do not cut this beat for time.** The autonomous repair proves capability; this proves *judgment*,
and judgment is what separates a demo from a product. It also pre-empts the sharpest question a
technical judge can ask — *"what stops it from confidently breaking a working scraper?"*

---

### BEAT 6 · The rails · `3:25–3:42`

**Screen:** Circuit breaker config, credit meter ticking, a quarantined scraper. (The Discord shot
already landed in 5f — don't repeat it.)

> "An agent that repairs itself with your money needs limits. Three repair attempts per scraper per
> day, two rejections per episode, a hard credit ceiling, and a global kill switch.
> When it exhausts them it doesn't keep trying — it quarantines the scraper and asks a human.
> That's the part that makes this something you'd actually leave running."

---

### BEAT 7 · Close · `3:42–4:00`

**Screen:** Aggregate stats, then the live URL and repo URL held on screen for the final five seconds.

> "Across this week it repaired itself eleven times without me. Average repair: about forty seconds
> and a few credits.
> Scrapers don't break because scraping is hard. They break because *maintaining* them is, and nobody
> budgets for it. Master Weaver budgets for it.
> It's live at this URL — go break it."

*(Substitute real numbers from the ledger. "Go break it" only if the Chaos Lab toggle is publicly
reachable — if so, it's the strongest possible closing line, because it's an invitation to verify.)*

---

## 4. What to leave out

Cutting these is what makes the four minutes possible:

- **Login / signup.** There isn't one, deliberately. Don't explain the absence.
- **A code walkthrough.** Belongs in the README and `SCRAPER_STUDIO_INTEGRATION.md`, which are
  separately-required submission artifacts. Reading code aloud on camera is the fastest way to lose
  a judge.
- **Architecture diagrams.** Same — they're in the repo. A diagram on screen is a claim; the running
  system is proof.
- **Feature tour of exports, JSON view, discovery search.** They exist, they're in the repo, they add
  nothing to a criterion that isn't already covered. If they must appear, they're B-roll under Beat 4.
- **Roadmap / "what's next".** Zero rubric value.
- **Team intro, title card, outro music sting.** Twenty seconds you cannot spare.

---

## 5. Production notes

- **Script it, read it.** Improvised narration runs long, hedges, and says "um." Read from a script
  just off-camera. This is 1/6 of the score and it's the only sixth you fully control.
- **Record in segments and assemble.** Do not attempt a single live take. A live demo failing on
  camera costs you an evening you don't have on Day 7.
- **Beat 5 must be genuinely unattended.** Don't cut inside 5b–5e in a way that implies you touched
  something. If it's slow, speed up the footage with a visible timestamp — that's honest, and a
  visible clock actually strengthens the claim.
- **Record a full fallback take on Day 6 evening.** Rough is fine. It exists so that a Day 7 disaster
  costs you polish instead of a submission.
- **1440p, 30fps, no cursor hunting.** Know where you're clicking before you record.
- **Audio quality outranks video quality.** Judges tolerate a soft image; they don't tolerate hiss.
- **Captions/subtitles.** Cheap, and many judges watch muted on a first pass.

---

## 6. Pitch copy — LOCKED

Use these verbatim everywhere. Consistency reads as conviction; three near-variants read as
indecision.

**README H1:**
> **Master Weaver turns a sentence into a production scraper — and mends it when the web breaks.**

**README subtitle** (carries the differentiator the headline can't):
> Every repair is verified before it commits — and logged with the evidence.

"When the web breaks" does double duty — the DOM, and the Web of Life and Destiny. It reads as plain
English to someone who misses the reference and as a nod to someone who catches it. That's the only
test a reference has to pass.

| Use | Text |
|---|---|
| Submission form blurb | "A self-healing scraping workspace: describe what you want in a sentence, and Master Weaver builds it, watches it, and repairs it when the target site changes — verifying every fix before it commits." |
| Socials / build-in-public | "Scrapers break when sites redesign. Master Weaver mends its own — and refuses its own bad fixes." |
| Verbal, if asked in one line | "Bright Data ships `--auto-approve`. We don't use it." |

Lead with the socials variant publicly — *"refuses its own bad fixes"* is the most arresting five
words you have, and no other submission will be able to say it. The third is the sharpest of all but
only lands for an audience that already knows the tool: perfect in conversation with Bright Data
judges, wrong as a README's first line.

### 6.1 Naming discipline

Product name and narrative carry the lore. **The UI does not.**

| Layer | Register | Example |
|---|---|---|
| Product name, README, narration, ADR titles | Themed | "the Loom", "mending", "a frayed thread" |
| Every UI label, badge, column, button, error | **Plain English** | `⚠️ Layout Change Detected`, not `⚠️ Thread Frayed` |

The Suit-Up criterion is "finished and **readable**." A judge should never have to translate a label.
Over-themed products read as clever; clever loses to finished on that rubric line.

---

## 7. Common ways this demo could fail

| Failure | Prevention |
|---|---|
| Heal takes 4 minutes on camera | Time it on Day 4. If slow, speed up footage with a visible clock. |
| The break looks staged | Show the real retail scraper too; make the Chaos Lab toggle publicly clickable. |
| Chart is two dots | Cron must start Day 2. This is the one that can't be fixed late. |
| Nothing in the ledger | Run deliberate breaks Days 4–6 to accumulate real episodes. |
| Video runs 6 minutes | Script it. Read it aloud with a timer before recording. |
| Credits exhausted on Day 7 | Circuit breaker + meter + develop against the Chaos Lab all week. |
| Judge can't tell you used Scraper Studio | Collector ID legible on screen; command named aloud; dedicated README section. |

---

## 8. Submission checklist

Required by the rules — all five, none optional:

- [ ] Public repository, clean structure (also the Spider-Sense entry)
- [ ] Clear README with the one-liner, setup, and architecture summary
- [ ] **`docs/samples/` — example structured output** (explicitly required; easy to forget)
- [ ] **`docs/SCRAPER_STUDIO_INTEGRATION.md`** — a written explanation of the integration, which is a
      scored criterion in prose form. Name the commands, show a real collector ID, explain the
      approval-gate decision.
- [ ] Demo video
- [ ] `docs/decisions/` ADRs — your defense against the "entirely AI-generated" disqualification clause
- [ ] Live deployed URL (not required, but "looks finished" is a criterion and a clickable link is
      the cheapest way to prove it)

---

*Next in the suite: 03 — Revised PRD & System Architecture (synthesis of 01, 02, 04).*
