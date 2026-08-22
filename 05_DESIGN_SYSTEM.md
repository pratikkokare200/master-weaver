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

1. **One accent, used sparingly.** Charcoal for primary action. If everything is accented, nothing is.
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

| Role | Light | Dark | Note |
|---|---|---|---|
| Page plane | `#f6f8fa` | `#14171d` | soft off-white, a hair cool so the charcoal reads as slate |
| Card surface | `#ffffff` | `#1b1f27` | |
| Raised surface (dropdown) | `#ffffff` | `#232833` | |
| Hairline border | `#e3e7ec` | `#2b303c` | every border, always 1px |
| Primary ink | `#1c2430` | `#f1f4f7` | dark slate · 15.6:1 on card surface |
| Secondary ink | `#4a5462` | `#a8b0c0` | 7.7:1 on card surface |
| Muted ink (axis, meta, timestamps) | `#68717f` | `#7f8898` | 4.9:1 on surface, 4.6:1 on plane |
| Tooltip plane / ink | `#1c2430` / `#f1f4f7` | inverted | 14.6:1 |
| Tour scrim | `rgb(28 36 48 / 0.45)` | same | the one translucent surface in the system |

The dark column is indicative until Day 5 actually builds it; only the light column is shipped.

Muted ink was slate-400 (`#94a3b8`) through Day 4, which measured 2.6:1 on white — below AA for the
12px meta text it is used on. The pastel pass darkened it to clear 4.5:1 on both surfaces.

### 2.2 Accents

Every **status** hue exists twice: as a **pastel plane** — the wash you read as colour — and as a
**readable ink** drawn on it. That split is the whole trick. A single mid-tone cannot be both a soft
fill and legible text, so neither job is asked of one value: the fill stays genuinely pastel and the
label on it goes dark, rather than the fill darkening until white text survives (which is how a
pastel turns back into a saturated mid-tone).

**The accent is charcoal because it is the only value that cannot collide.** Status owns mint at
162°, apricot at 33° and rose at 349°. Any accent near one of them makes "primary action" and
"system state" the same signal, which is the one confusion this palette exists to prevent — a peach
primary button sits 11° from the healing apricot and would kill the healing state as an event.

Cerulean at 208° was the widest gap on the wheel and it held that argument for four days, but the
gap was the *only* thing recommending it: at 60% saturation it read as the default blue of every
dashboard shipped since 2015, which is the opposite of what a premium surface wants. The two hues
usually reached for instead are worse than cerulean, not better — **terracotta at ~20° is 13° from
the healing apricot** and **clay runs into rose at 349°**; both re-open the exact collision the
reserved-hue rule closes.

A neutral ends the argument. Charcoal has no hue to collide with, so hue is left to mean status and
nothing else, and the accent asserts itself through weight and contrast instead. Chroma is held at
**10% saturation** — below roughly 15% the eye stops naming a hue and reads "graphite", and a slate
blue at 30% is still a blue.

The accent is also the one member of the palette with **no pastel/ink split**: the primary button is
a solid charcoal fill carrying a white label. The split exists to protect legibility on saturated
mid-tones, and charcoal has no such problem — white sits on it at 11.6:1, where the deepest label
the old pastel cerulean fill could carry managed 7.0:1. Going solid buys contrast rather than
spending it, which matters more in a system with no shadows to fall back on.

| Role | Hex | Used for — and nothing else |
|---|---|---|
| Accent ink | `#37393d` | link text, active nav, focus ring, logo mark, chart series · 11.6:1 on surface |
| Accent ink hover | `#24262a` | 15.2:1 on surface |
| Accent fill | `#37393d` | the primary button's surface · **solid**, not a wash |
| Accent fill hover | `#24262a` | |
| Accent border | `#2c2e32` | the primary button's 1px edge — a shade **deeper** than the fill |
| Accent label | `#ffffff` | the label **on** accent fill · 11.6:1 |
| Accent plane | `#dfe3e8` | active nav wash, tour chip · accent ink reads 9.0:1 on it |
| Accent plane strong | `#d2d7de` | the tour chip's pulse peak only · accent ink 8.0:1 |
| Accent plane border | `#c4cbd4` | the tour chip's edge · 1.54:1 on plane |

A neutral wash cannot separate itself from a neutral plane by hue, so the active-nav and tour-chip
washes separate by **lightness** instead — `#dfe3e8` is a full step darker than the page plane
(1.21:1) where the old cerulean wash was nearly flat against it (1.12:1) and relied on hue to read.
| Brand success | `#317b64` | pastel mint ink · restored, positive delta · 5.1:1 |
| Success ink / plane | `#2c7159` / `#e6f7ef` | 5.2:1 |
| Healing / attention | `#c6883a` | The healing state, and **only** the healing state |
| Healing ink / plane | `#8d5a19` / `#fdf3e6` | 5.3:1 |

The healing hue is reserved. The moment apricot appears anywhere else in the product, the healing
state stops reading as an event — and that state is the centerpiece of the demo (doc 04 Beat 5). It
was amber-500 (`#f59e0b`) through Day 4; the pastel pass darkened it so the healing **dot** clears
3:1 as a graphical object, which amber-500 never did (2.1:1).

### 2.3 Geometry

- **Radii:** `6px` controls · `8px` cards · `12px` modals · `9999px` badges. Nothing else.
- **Spacing:** `4 · 8 · 12 · 16 · 24 · 32 · 48`. No other values.
- **Borders:** `1px` always. Never 2px.
- **Shadow:** none, anywhere. Every layer — card, drawer, tooltip, chart callout — is a solid fill
  plus a 1px border. A tooltip separates itself from the plane by *inverting* (dark slate on pastel),
  which is why no floating layer needs a blur to be legible. If you want a shadow, the layer needs a
  different background.

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
│ Take a tour│  [ Table | Chart | JSON | Chat | Ledger ]     │
│ Workspaces ├──────────────────────────────────────────────┤
│ Collectors │                                              │
│            │                                              │
│            │  Active panel                                │
│            │                                              │
└────────────┴──────────────────────────────────────────────┘
```

Sidebar `240px` fixed, page plane background, hairline right border. Content max-width `1440px`,
centered. Below `768px` the sidebar collapses to a drawer — responsive matters only because a judge
may open the live URL on a tablet, not because mobile is a use case.

**The tour launcher is the first item in the rail**, above the workspace list — see ProductTour in
§6. It was previously the last item in the footer, in the same muted grey as the inert labels around
it, and in practice nobody found it.

**Tabs, not resizable panels.** Your original spec called for resizable panels; they cost half a day,
they're fiddly to record, and they add nothing to "finished and readable." Cut.

---

## 4. HealthBadge — the component the demo lives on

Sixteen internal states (doc 01 §2.1) collapse to **four headline labels**, with the precise state as
a sub-caption. Judges read the headline; the sub-caption proves there's a real machine underneath.

| Headline | Internal states | Dot | Text |
|---|---|---|---|
| `Idle` | IDLE, QUEUED | muted ink | secondary ink |
| `Scraping…` | RUNNING, VALIDATING, TRANSIENT_RETRY | accent ink, pulsing | primary ink |
| `⚠️ Layout Change Detected — Healing…` | BROKEN, DIAGNOSING, HEALING, AWAITING_APPROVAL, CANARY_VALIDATING, APPROVING, REJECTING | **healing apricot**, pulsing | healing ink on healing plane |
| `⚠️ Degraded — repair needs your approval` | DEGRADED, **PENDING_OPERATOR** | healing apricot, **static** | healing ink on healing plane, **+ `Repair` button** |
| `✅ Pipeline Restored` | RESTORED, HEALTHY | pastel mint | success ink on success plane |
| `🛑 Needs your review` | QUARANTINED | `#bb4459` | on the critical plane `#fdeef1` |

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
| good | `#317b64` | FHS ≥ 0.95 |
| warning | `#c6883a` | FHS 0.60–0.95 (degraded) |
| critical | `#bb4459` | FHS < 0.60 (broken) |
| critical plane | `#fdeef1` | pastel rose wash behind critical text |

These never appear as chart series, and a series color never carries status meaning. Status-good and
brand success are now deliberately the *same* value rather than two greens a shade apart — one mint,
used for both, removes a distinction no reader was ever going to make. **Status always ships with an
icon and a label**, so hue never carries the meaning alone.

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
- Dots use the §5.2 **status** colors (critical `#bb4459`, warning `#c6883a`), not series colors, and
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

### ProductTour

Four stops — the command bar, the collector summary, the tab strip, the Chat tab — triggered by
**Take a tour** at the top of the sidebar nav. Steps bind to the DOM through `data-tour` attributes,
so a restyle cannot silently break the tour, and a step whose target is missing is dropped before
the tour starts rather than presenting an empty frame.

**The launcher.** A chip carrying accent ink on the accent plane, with a visible border and a §4
dot: the only filled, bordered element in a rail that is otherwise plain text, which is what makes
it findable without making it loud. It is deliberately **not** the solid `primary` treatment — §1
allows one primary on screen and the Run button is it, so a second charcoal block would make "what
do I do here" ambiguous. It appears only on collector routes, since every stop targets one.

The chip **pulses on arrival and then stops**: background and border cycle to `--accent-plane-strong`
and `--accent` over 1.8s, four times, and it settles into an ordinary button. Three constraints
make that legitimate rather than a blinking control:

- **It ends.** Four iterations, ~7s, and it is over. A cue with no end state never stops asking and
  so stops being asked about — see §9.
- **It never animates the label.** Background and border only. §4's dot rule exists because pulsing
  text is unreadable, and it applies here for the same reason.
- **Interaction cancels it,** on hover or focus, and `AppShell` drops the class outright once the
  tour has been opened — so it never replays for someone who has already taken it. That flag is
  session state, not `localStorage`: the cue exists for a first-time viewer, and a flag persisted
  during a rehearsal is exactly how it would fail to appear on the take that counts.

Under `prefers-reduced-motion` the pulse is dropped and the chip keeps its resting fill and border,
which is what carries the "find me" job for anyone who never sees the animation.

Built rather than installed. driver.js and react-joyride each ship a visual language — rounded
popovers, drop shadows, a glow around the cutout — and matching this system would have meant
overriding nearly all of it, which is more code than writing the overlay *plus* a dependency whose
next release can restyle the demo. The same argument `lib/cn.ts` makes about `clsx`, with more at
stake.

Three rules it inherits from the rest of the system:

- **Flat.** The spotlight is a hard-edged mask cut with a 1px accent stroke. No glow, no blur. The
  popover is the standard card — surface, hairline, 8px radius — and the progress meter is the same
  4px track as the credit meter and the health tile.
- **The scrim is the one translucent surface.** Dimming the page is literally what a scrim is for,
  and it uses the same ink-at-low-alpha as the existing mobile drawer scrim. Nothing behind it is
  blurred.
- **Nothing auto-starts.** The tour is opt-in. An overlay that appears unbidden on the landing
  screen is guaranteed to land in the middle of a demo recording (doc 04), and §8's whole point is
  that the first screen should be populated and quiet.

Scrolling frames the target *and* its popover as one unit rather than centring the target alone —
the summary card is 353px tall beside a 315px popover, and splitting the leftover space in two
leaves neither half big enough. Where the pair genuinely cannot fit, the popover overlays the target
and drops its arrow, because an arrow that no longer touches what it points at is worse than none.

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

Plus globally: focus rings on every interactive element (accent charcoal, 2px offset) · 44px minimum touch
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
| An attention cue that never ends | The tour chip's pulse is bounded to four iterations and dies on interaction. A control that blinks forever stops reading as a cue and starts reading as a defect — and it is the one thing that turns "animated background" from a ban into an accusation |
| A chromatic accent that lands near a reserved status hue | §2.2. Terracotta is 13° from the healing apricot, clay runs into rose. The accent is a neutral so this argument never has to be had |
| Centered spinners | Skeletons preserve layout; spinners cause shift |
| Blank cells for nulls | Use `—`; a blank reads as a bug |
| A number label on every data point | Selective direct labels only |
| Text in a series color | Text wears ink tokens; a dot carries identity |
| Toast notifications for state changes | The badge is the status surface; toasts compete with it |
| Themed labels anywhere in the UI | The product is **Master Weaver**, but no label says "thread," "loom," "frayed," or "mend." Lore lives in the name, README and narration only — a judge must never translate a label to read the screen (doc 03 §1.1) |

---

*Suite complete: 01 healing spec · 02 agent allocation · 03 PRD & architecture · 04 demo script ·
05 this document.*
