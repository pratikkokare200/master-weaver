# @weaver/web

The observation deck. Next.js App Router, Tailwind v4, light-mode default.

Read-only plus job enqueueing. No scraping logic, no CLI calls, no healing decisions live here.

```
npm run dev        # http://localhost:3000
npm run build
npm run typecheck
```

`@weaver/contracts` must be built first — `npm run build` inside `packages/contracts` — because this
app imports the engine's real threshold constants rather than retyping them.

## Design tokens

All of them live in [`app/globals.css`](app/globals.css) — Tailwind v4 configures the theme in CSS,
so there is no `tailwind.config.ts`. Tokens are declared as plain custom properties on `:root` and
referenced through `@theme inline`, which means the Day 5 dark mode (doc 05 §7) is a token swap:
redefine the values under a `.dark` selector and restyle nothing.

| Role | Token | Value |
|---|---|---|
| Page plane | `bg-plane` | `#f8fafc` |
| Card surface | `bg-surface` | `#ffffff` |
| Hairline border | `border-hairline` | `#e2e8f0` — 1px, always |
| Primary / secondary / muted ink | `text-ink` · `text-ink-secondary` · `text-ink-muted` | `#0f172a` · `#475569` · `#94a3b8` |
| Primary action | `bg-accent` / `hover:bg-accent-hover` | `#4f46e5` / `#4338ca` |
| Success | `text-success` | `#059669` |
| Healing / attention | `bg-healing` | `#f59e0b` |
| Status good / warning / critical | `--status-*` | `#0ca30c` · `#fab219` · `#d03b3b` |

Radii: `rounded-control` 6px · `rounded-card` 8px · `rounded-modal` 12px · `rounded-badge` 9999px.
Spacing: 4 · 8 · 12 · 16 · 24 · 32 · 48 only — Tailwind steps `1 2 3 4 6 8 12`.
Type: `text-title` 20 · `text-section` 15 · `text-body` 14 · `text-cell` 13 · `text-meta` 12 · `text-stat` 28.

**Amber is reserved.** `--healing` marks the healing state and the low-credit warning, and nothing
else. Errors use `--status-critical`, never amber — the moment amber appears elsewhere the healing
badge stops reading as an event, and that state is the centerpiece of the demo.

## Reviewing the four states

Every panel implements populated, empty, loading and error (doc 05 §8). Append `?state=` to any
collector route to see one without waiting for the matching real condition:

```
/c/hardware-catalog                  # populated
/c/hardware-catalog?state=empty
/c/hardware-catalog?state=loading    # skeletons, never a spinner
/c/hardware-catalog?state=error
```

It is a review affordance, not product UI, so it deliberately adds no on-screen control.

Other routes worth looking at:

```
/                                    # 307 → the flagship collector, so the landing view is populated
/c/competitor-laptops                # degraded: amber badge, static dot, Repair action, 1-URL golden set
/c/marketplace-listings              # idle: no runs yet
/c/does-not-exist                    # 404
```

## Layout

240px fixed sidebar (drawer below `md`) · command bar · collector header · tabbed observation panel,
content capped at 1440px. Tabs, not resizable panels.

The header puts `CollectorPolicyBlock` directly above `HealthBadge`, as doc 05 §6 requires, so the
current state is read against the policy that produced it.

## Scope notes

- **`HealthBadge` is presentational.** It takes a `RunState` and renders it; Day 3 wires Supabase
  Realtime. The geometry is already fixed — identical height in every state, sub-caption line always
  reserved — so that swap moves nothing on screen.
- **`ChartPanel` renders the frame, not the series.** Recharts lands Day 3. The axis gutter,
  horizontal-only gridlines and the right-hand rail for direct end-labels are already reserved, and
  two doc 05 §5 rules must survive that work: never a dual-axis chart, and direct end labels rather
  than a legend.
- **`lib/seed.ts` is placeholder data**, shaped like real `scraper run` output — `price` is a nested
  `{ value, currency }` object and nulls are seeded on purpose to exercise the em-dash rule.
