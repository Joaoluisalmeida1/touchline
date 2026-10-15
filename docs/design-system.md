# Touchline design system — "Matchday broadcast"

Dark-only UI inspired by TV match graphics: near-black stage, one electric-lime accent, condensed display type for
anything you'd read on a scoreboard (scores, ratings, headings).

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| `bg` / `surface` / `surface-2` / `surface-3` | `#07090b` → `#1e232a` | page, cards, raised controls |
| `line` / `line-strong` | `#232931` / `#343c47` | hairlines, hover borders |
| `ink` / `muted` / `faint` | text hierarchy | |
| `accent` (+ `accent-ink`) | `#d4ff3a` | primary actions, active states, "you" highlights |
| `info` / `warn` / `danger` / `gold` | status colours | |
| `pitch` | `#0d2a1c` | pitch surfaces |

Fonts (self-hosted via `@fontsource`, no network at build): **Barlow** (body), **Barlow Condensed** (`font-display`,
`.headline`), **JetBrains Mono** (invite codes). Helper classes: `.headline`, `.eyebrow`, `.surface`, `.pitch-grid`.

## Components

- `src/components/ui.tsx` — Card, CardTitle, Headline, Button/ButtonLink (shimmer sheen), Badge, OvrBadge (tiered
  gradients), Meter, FormArrow, FormStrip (V/E/D pills), PosPill, Stat, Empty, Field, `inputCls`.
- `src/components/fx/*` (client, `motion`):
  - `motion.tsx` — MotionProvider (respects reduced motion), Reveal, Stagger/StaggerItem, Bar.
  - `tabs.tsx` — PillTabs (sliding pill) and NavTabs (route tabs with animated underline).
  - `animated-number.tsx` — scoreboard count-up (`int`, `eur`, `dec1`…).
  - `copy-button.tsx` — icon morph + per-letter label swap.
  - `countdown.tsx` — kickoff/deadline countdown.
- `src/components/crest.tsx` — generated club crest from any query row.
- `src/components/game-nav.tsx` — desktop tab bar + mobile bottom dock with "Mais" sheet.

Icons: `lucide-react`.

## Credits

Motion patterns for the sliding tabs, copy button, dock, shimmer button and blur-in entrances are adapted from
[Watermelon UI](https://ui.watermelon.sh) (MIT License, © Watermelon Platform Contributors).

## Rules of thumb

- Keep visible labels the E2E tests rely on (e.g. "O meu clube", "Guardar escalação", "Pts", "Estatísticas").
- Only one lime element should shout per view; everything else is neutral.
- Game data (crests, avatars, shirts) stays generated — no real crests or photos.
