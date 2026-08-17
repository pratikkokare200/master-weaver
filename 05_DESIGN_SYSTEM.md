# Master Weaver — Design System & UI Specification

**Document 05 of the Master Weaver planning suite**
Status: EXECUTION ARTIFACT — written 2026-08-12 (pre-build)
Depends on: `01_HEALING_STATE_MACHINE.md` (state list), `03_PRD_AND_ARCHITECTURE.md` (components)
**Primary consumer: Gemini 3.1 Pro, Day 1.** This is the brief for design tokens and app shell.

> Doc 02 assigns Pro "design tokens, app shell, empty states" on Day 1 with no spec. This is that
> spec. Everything here is decided so Pro executes rather than invents — three models improvising
> visual language independently is how a repo ends up looking like three repos.

---

## 1. Aesthetic direction

Monday.com / Airtable / Notion. Enterprise SaaS. Light-mode default.

**The governing rule: restraint reads as finished.** The "Best UI" criterion is *"looks and feels the
most finished and readable"* — not the most impressive. Every gradient, glow, glassmorphism panel and
animated background you add moves the product away from that word. Hackathon UIs lose this prize by
adding, not by omitting.

Three commitments that produce the look on their own:

1. **One accent, used sparingly.** Indigo for primary action. If everything is indigo, nothing is.
2. **Hairline borders over shadows.** Slate-200 dividers. Shadows only on genuinely floating layers
   (dropdown, modal, tooltip).
3. **Consistent vertical rhythm.** One spacing scale, no ad-hoc pixel values. This is 80% of why
   Notion looks expensive and a bootstrapped dashboard doesn't.

**Light mode is the default and the demo mode.** Monday, Airtable and Notion are all light-default;
light screen recordings read as enterprise, dark ones read as developer-tool. Dark mode is a Day 5
polish item, fully specified below, but it is not what you record.

---

## 2. Tokens

Tailwind scale values, so Pro can use utility classes directly and Flash can match them without a
shared component library.

### 2.1 Surfaces & ink

| Role | Light | Dark | Tailwind |
|---|---|---|---|
| Page plane | `#f8fafc` | `#020617` | slate-50 / slate-950 |
| Card surface | `#ffffff` | `#0f172a` | white / slate-900 |
| Raised surface (dropdown, tooltip) | `#ffffff` | `#1e293b` | white / slate-800 |
| Hairline border | `#e2e8f0` | `#1e293b` | slate-200 / slate-800 |
| Primary ink | `#0f172a` | `#f8fafc` | slate-900 / slate-50 |
| Secondary ink | `#475569` | `#94a3b8` | slate-600 / slate-400 |
| Muted ink (axis, meta, timestamps) | `#94a3b8` | `#64748b` | slate-400 / slate-500 |

### 2.2 Accents

| Role | Hex | Tailwind | Used for — and nothing else |
|---|---|---|---|
| Primary action | `#4f46e5` | indigo-600 | Run button, active nav, focus ring, primary CTA |
| Primary hover | `#4338ca` | indigo-700 | |
| Brand success | `#059669` | emerald-600 | Restored banner, positive delta text |
| Healing / attention | `#f59e0b` | amber-500 | The healing state, and **only** the healing state |

Amber is reserved. The moment amber appears anywhere else in the product, the healing state stops
reading as an event — and that state is the centerpiece of the demo (doc 04 Beat 5).

### 2.3 Geometry

- **Radii:** `6px` controls · `8px` cards · `12px` modals · `9999px` badges. Nothing else.
- **Spacing:** `4 · 8 · 12 · 16 · 24 · 32 · 48`. No other values.
- **Borders:** `1px` always. Never 2px.
- **Shadow:** exactly one — `0 4px 12px rgba(15,23,42,0.08)` — on floating layers only.

### 2.4 Type

`system-ui, -apple-system, "Segoe UI", sans-serif`. No display face, no serif, no webfont
(a webfont is a network request that can fail in a screen recording).

| Role | Size / weight |
|---|---|
| Page title | 20px / 600 |
| Section heading | 15px / 600 |
| Body | 14px / 400 |
| Table cell | 13px / 400, `tabular-nums` on numeric columns |
| Meta, timestamps | 12px / 400, muted ink |
| Stat-tile value | 28px / 600 |

`tabular-nums` on table numerics and axis ticks only. Standalone large numbers (the FHS value, credit
meter) use default proportional figures.

---

## 3. Layout

```
┌────────────┬──────────────────────────────────────────────┐
│            │  Command bar — intent + URL          [Run]   │
│  Sidebar   ├──────────────────────────────────────────────┤
│  240px     │  Collector header · HealthBadge · CreditMeter │
│            ├──────────────────────────────────────────────┤
│ Workspaces │  [ Table | Chart | JSON | Chat | Ledger ]     │
│ Collectors ├──────────────────────────────────────────────┤
│            │                                              │
│            │  Active panel                                │
│            │                                              │
└────────────┴──────────────────────────────────────────────┘
```

Sidebar `240px` fixed, page plane background, hairline right border. Content max-width `1440px`,
centered. Below `768px` the sidebar collapses to a drawer — responsive matters only because a judge
may open the live URL on a tablet, not because mobile is a use case.

**Tabs, not resizable panels.** Your original spec called for resizable panels; they cost half a day,
they're fiddly to record, and they add nothing to "finished and readable." Cut.

---

## 4. HealthBadge — the component the demo lives on

Sixteen internal states (doc 01 §2.1) collapse to **four headline labels**, with the precise state as
a sub-caption. Judges read the headline; the sub-caption proves there's a real machine underneath.

| Headline | Internal states | Dot | Text |
|---|---|---|---|
| `Idle` | IDLE, QUEUED | slate-400 | secondary ink |
| `Scraping…` | RUNNING, VALIDATING, TRANSIENT_RETRY | indigo-600, pulsing | primary ink |
| `⚠️ Layout Change Detected — Healing…` | BROKEN, DIAGNOSING, HEALING, AWAITING_APPROVAL, CANARY_VALIDATING, APPROVING, REJECTING | **amber-500**, pulsing | amber-700 on amber-50 |
| `⚠️ Degraded — repair needs your approval` | DEGRADED, **PENDING_OPERATOR** | amber-500, **static** | amber-700 on amber-50, **+ `Repair` button** |
| `✅ Pipeline Restored` | RESTORED, HEALTHY | emerald-600 | emerald-700 on emerald-50 |
| `🛑 Needs your review` | QUARANTINED | `#d03b3b` | on rose-50 |

Six labels, not four — two were added by architect decision 3 and the quarantine path.

**The degraded label is the only badge that carries an action.** Severity gates autonomy: below
FHS 0.60 the system repairs itself and the badge merely reports; between 0.60 and 0.95 it halts and
the badge *asks*. The visual distinction must be immediate — **the healing dot pulses, the degraded
dot does not.** Motion means "working"; stillness plus a button means "waiting on you." Same hue,
opposite meaning, and a viewer reads the difference in under a second without reading the words.

This badge is filmed twice in the demo (doc 04 Beat 5b autonomous, Beat 5f degraded). The two states
appearing distinguishable on screen is what makes the triage claim legible.

**Requirements:**
- All 16 states render at identical height. **No layout shift on transition** — reserve the sub-caption
  line even when empty. Shift during the Beat 5 sequence is the single most visible polish failure,
  and it happens on the exact shot the video is built around.
- Transitions cross-fade over 200ms. No slide, no bounce.
- Pulse is opacity `1 → 0.55 → 1` over 1.6s on the dot only. Never the text.
- `prefers-reduced-motion`: drop the pulse, keep the color.

---

## 5. Charts

Validated against this product's actual surfaces — white card in light, slate-900 in dark. Both modes
**pass all six checks**; the light mode carries one warning that creates a hard requirement (§5.3).

### 5.1 Categorical palette — max 5 series

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |

Assign **in fixed order, never cycled**. A sixth tracked product does not get a new hue — it folds
into "Other" or the chart facets into small multiples.

Validator results, run against `#ffffff` and `#0f172a`:

```
light  worst adjacent CVD ΔE 9.1 (yellow↔aqua)   normal-vision 19.6   → PASS
dark   worst adjacent CVD ΔE 8.4 (yellow↔aqua)   normal-vision 19.3   → PASS
light  contrast: aqua 2.82, yellow 2.17, magenta 2.69 vs white → WARN, relief required
dark   contrast: all ≥ 3:1 → PASS
```

### 5.2 Status colors — reserved, never a series

| Role | Hex | Use |
|---|---|---|
| good | `#0ca30c` | FHS ≥ 0.95 |
| warning | `#fab219` | FHS 0.60–0.95 (degraded) |
| critical | `#d03b3b` | FHS < 0.60 (broken) |

These never appear as chart series, and a series color never carries status meaning. Note the
collision risk: brand emerald `#059669` and status-good `#0ca30c` are the same hue family — **status
always ships with an icon and a label**, so hue never carries the meaning alone.

### 5.3 The relief rule — non-negotiable in light mode

Three light slots sit below 3:1 against white. That is legal only with relief, so:

> **Every line in the price chart carries a direct label at its right end, and the table view is
> always reachable from the chart panel.**

This isn't a compliance checkbox — direct end-labels are also what makes the Beat 4 chart readable in
a four-second cut, where a legend would force the viewer's eye off the data.

### 5.4 Forms

| Data | Form | Notes |
|---|---|---|
| Price over time, 3–5 products | Multi-line, one y-axis | 2px lines, ≥8px markers on hover only, direct end labels |
| FHS over time | **Separate chart** | See the trap below |
| Per-field fill rate, current run | Horizontal bars | 4px rounded data-ends anchored to baseline, 2px gap between bars |
| Current FHS | **Stat tile, not a chart** | §5.6 |
| Credits remaining | Stat tile + thin meter | |

**The trap:** someone will want to overlay FHS on the price chart to show "the break." **Never build a
dual-axis chart.** Two measures at different scales get two stacked charts sharing an x-axis — which
also demos better, because the FHS collapse and the price-column emptying line up vertically on
screen at the same timestamp. That vertical alignment is a stronger visual argument than an overlay
would have been.

### 5.5 Marks & interaction

- 2px lines, no area fill under multi-series lines, no point marker on every point
- Gridlines: horizontal only, hairline, muted — never vertical, never dark
- Hover is default, not optional: crosshair + tooltip on line charts, per-bar tooltip on bars
- Legend present for ≥2 series; direct labels too at ≤4 series; a single series needs no legend
- Axis labels in muted ink, never in a series color
- **Text never wears a series color.** A colored dot beside the label carries identity.

### 5.6 The FHS gauge is a stat tile

A single current value is a headline number, not a chart. Spec:

```
  Field Health              ← 12px muted label
  0.80                      ← 28px/600, colored by status band
  ▁▁▁▁▁▁▁▓▓▓                ← 4px meter track, rounded ends, status fill
  ⚠ Degraded · price 30%    ← 12px, icon + label — status never color-alone
```

The band boundaries are the doc 01 thresholds — `0.95` and `0.60`. Show them as hairline ticks on the
meter track so a judge can see *where* the value sits relative to the decision points. That single
detail converts a decorative gauge into an explanation of the system's logic.

---

## 6. Other components

**Command bar.** Full-width, card surface, hairline border. Textarea for intent (2 rows, auto-grow),
URL field, indigo Run button. On submit it collapses into a status strip — the input does not sit
there empty while a job runs.

**HealingLedger.** Vertical timeline, newest first. Collapsed row: timestamp · trigger reason ·
`FHS 0.80 → 0.97` · attempt count · cost · outcome pill. Expanded: the generated diagnosis in a mono
block, before/after JSON side by side with changed keys highlighted, canary score per attempt, and the
approve/reject decision with its reason.

Rejected attempts render with a rose left-border and struck-through outcome. **Do not hide them** —
an episode showing "attempt 1 rejected, attempt 2 approved" is the strongest evidence in the product
(doc 04 Beat 5e).

**WorkspaceTable.** TanStack. Sticky header, 36px rows, zebra off, hairline row dividers,
`tabular-nums` on numerics. Null cells render as muted `—`, never blank — a blank cell reads as a
rendering bug; an em-dash reads as "we know this is missing," which is the entire product thesis.

**Deep-link landing — `/c/<id>?action=repair`.** Arrived at from a Discord alert. On load: scroll the
collector into view, render the repair confirmation **already open**, with the generated diagnosis
and the failing-field summary inside it. The amber HealthBadge and the CollectorPolicyBlock must both
be visible behind the dialog — the operator should see *what state it's in* and *why it's asking*
without dismissing anything.

- Strip `?action=repair` from the URL after the dialog opens, so a refresh doesn't re-trigger it.
- If the collector has already been repaired or dismissed by the time the link is clicked, open the
  ledger entry instead with a one-line note: *"Already resolved — repaired 4 minutes ago."* Never a
  dead link and never an error page; a stale alert is normal, not a fault.
- This route is filmed in doc 04 Beat 5f as a single continuous click. It cannot flash, redirect
  twice, or show a loading state longer than a skeleton.

**SQLChat.** Messages above, input below. The generated SQL renders in a collapsed mono block beneath
each answer, expandable, with a copy button. Never hide it.

**CreditMeter.** Sidebar footer. Balance, thin meter, and today's spend. Turns amber below 20%.

**CollectorPolicyBlock.** Static, read-only card in the collector detail panel. States the two
hardcoded autonomy rules in plain language:

```
┌─────────────────────────────────────────────────┐
│  Repair policy                                  │  ← 12px muted label
│                                                 │
│  ●  Catastrophic    health < 60%     Automatic  │  ← critical dot · 13px · value 13px/600
│  ●  Partial         health 60–95%    Ask me     │  ← warning dot
│                                                 │
│  Repairs are always verified before they        │  ← 12px muted, wraps
│  commit, on both paths.                         │
│                                                 │
│  Golden set · 3 URLs            [ⓘ]             │  ← 12px, hairline rule above
└─────────────────────────────────────────────────┘
```

**Requirements:**
- **Read-only. No toggle, no switch, no affordance implying it can be changed.** Text and dots only —
  a disabled-looking control invites a click and then disappoints; a statement doesn't.
- Dots use the §5.2 **status** colors (critical `#d03b3b`, warning `#fab219`), not series colors, and
  each carries its text label — status never rides on hue alone.
- Values (`Automatic`, `Ask me`) in primary ink at 600 weight; thresholds in muted ink.
- Thresholds are read from the same constant as the engine, never retyped. If the numbers in
  `@weaver/contracts` change, this card changes with them — a policy card that drifts from actual
  behaviour is worse than no card.
- Sits directly above the HealthBadge, so the current state is read against the policy that produced it.
- **Golden-set line is required.** Renders `Golden set · N URL` / `N URLs` (singular at 1), taken from
  the collector's actual set — `min(3, available_urls)`, so it legitimately reads `1` for a
  single-URL collector. Append the shape when it is a listing collector: `Golden set · 1 URL (listing)`.
  - At **N = 1**, the row and its `[ⓘ]` tint to muted ink with the tooltip: *"Repairs are verified
    against one reference page. Add more URLs to strengthen verification."* Not a warning colour —
    it's lower confidence, not an error.
  - This is why the line exists: a golden set of 1 is a weaker regression test than one of 3, and the
    honest move is to show that rather than hide it. The canary threshold does **not** change with
    set size (doc 01 §3.4) — raising it would make small collectors harder to repair than large ones,
    which is backwards.

**Why this exists.** The product already implements tiered autonomy (doc 01 §3.2) but nothing on
screen *says so* — a judge sees one break heal itself and another stop, with no visible reason. This
card makes the rule legible before the behaviour is observed, and it's what Beat 5f points at when
the narration says *"below sixty percent it repairs itself, between sixty and ninety-five a human
decides."* It also answers "is this configurable?" implicitly, without claiming a toggle that doesn't
exist. Ten minutes of Flash's time; see ADR-005 for why the toggle itself was deferred.

---

## 7. Dark mode

Day 5. Redefine tokens only — never restyle components. Chart colors switch to the dark column in
§5.1, which is a *selected* set for the dark surface, not a filter or an opacity change on the light
values. Verify the HealthBadge amber and emerald states still clear contrast on slate-900.

---

## 8. The "finished" checklist

This is what the Suit-Up criterion actually measures. Every panel needs all four:

- [ ] **Empty** — no runs yet: an icon, one line of explanation, and the action that fixes it
- [ ] **Loading** — skeleton rows matching final layout, never a centered spinner
- [ ] **Error** — what failed, in plain language, plus a retry
- [ ] **Populated**

Plus globally: focus rings on every interactive element (indigo-600, 2px offset) · 44px minimum touch
targets · `prefers-reduced-motion` honoured · no console errors or warnings on any route · no layout
shift on any state transition.

**A judge forms their impression from the empty state**, because that's what a fresh workspace shows.
Pre-seed the flagship workspace so the landing view is populated — and still design the empty state,
because they will click "new workspace."

---

## 9. Anti-patterns — automatic rejection in review

| Don't | Because |
|---|---|
| Dual-axis chart | The most common chart error; see §5.4 |
| Cycled/generated hues past slot 5 | Breaks CVD validation and identity stability |
| Recoloring series when a filter changes the count | Color follows the entity, never its rank |
| Amber anywhere but the healing state | Destroys the demo's key signal |
| Gradients, glassmorphism, animated backgrounds | Reads as unfinished, not impressive |
| Centered spinners | Skeletons preserve layout; spinners cause shift |
| Blank cells for nulls | Use `—`; a blank reads as a bug |
| A number label on every data point | Selective direct labels only |
| Text in a series color | Text wears ink tokens; a dot carries identity |
| Toast notifications for state changes | The badge is the status surface; toasts compete with it |
| Themed labels anywhere in the UI | The product is **Master Weaver**, but no label says "thread," "loom," "frayed," or "mend." Lore lives in the name, README and narration only — a judge must never translate a label to read the screen (doc 03 §1.1) |

---

*Suite complete: 01 healing spec · 02 agent allocation · 03 PRD & architecture · 04 demo script ·
05 this document.*
