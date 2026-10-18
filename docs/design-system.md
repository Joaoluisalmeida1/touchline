# Touchline design system — "Matchday editorial" (UI v2)

A sports-paper / broadcast-graphic look: calm neutral surfaces, bold condensed headlines and big numbers, one fixed
brand colour, and club colours as the main source of colour. Two themes: **dark (default)** and **light**. No neon,
glows, glass or decorative gradients. Plan and research: the "Touchline — UI Revamp Plan" doc; approved clickable mock:
"Touchline — Hoje & Match Centre mock" (both Claude artifacts).

## Themes and tokens (`src/app/globals.css`)

Raw values live in CSS variables (`--tl-*`) on `:root`/`[data-theme="dark"]` and `[data-theme="light"]`; Tailwind v4
`@theme inline` maps them to the v1 token names, so every utility (`bg-surface`, `text-muted`, `bg-accent/10`…)
follows the active theme. Use `dark:` for the rare theme-specific tweak (`@custom-variant dark` = `[data-theme=dark]`).

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` / `surface` / `surface-2` / `surface-3` | `#111315` → `#2c3137` | `#f4f2ed` → `#e5e1d9` | page, panels, raised controls |
| `paper` | `#1d1e1b` | `#fbf8f1` | newspaper surfaces (O Apito) |
| `line` / `line-strong` | `#2b3036` / `#3a4048` | `#e2ded5` / `#cfcac0` | rules, input borders |
| `ink` / `muted` / `faint` | `#f2f0eb` / `#a39f98` / `#94908a` | `#141414` / `#5f5b55` / `#67635d` | text (all ≥ 4.5:1 on surfaces) |
| `accent` (+ `accent-ink`) | `#7690ff` (+ `#0a0f2e`) | `#3a5bf0` (+ white) | **Touchline blue**: primary buttons, active nav, links, "you" |
| `brand` | `#3a5bf0` | `#3a5bf0` | the fixed brand colour (logo mark, selection) |
| `up` / `down` (= `danger`) | `#3ccb7f` / `#ff7a6e` | `#177a42` / `#b93228` | results, form, money and rating changes |
| `info` / `warn` / `gold` | | | status, deadlines, trophies (sparingly) |
| `pitch` / `pitch-2` / `pitch-line` | | | pitch surfaces |
| `scrim` | | | overlays behind drawers/dialogs |

The dark theme uses the lighter step of the brand blue for `accent` so that both blue text on dark surfaces and dark
text on blue fills pass AA; the light theme uses the brand blue itself with white text.

Club colours (from `game_clubs`) are used in blocks and bars (hero bands, `.club-split` match heroes, crests, table
markers), never as body text, and never instead of the brand colour for actions.

**Preference storage**: `src/lib/prefs.ts`. Theme and "Reduzir movimento" are per device (localStorage), applied to
`<html data-theme data-motion>` by an inline boot script before first paint. Toggles: the sun/moon button (site header
and game context bar) and the command palette. `data-motion="reduce"` disables CSS animations and switches `motion`
to `reducedMotion="always"`; the system setting is always honoured too.

## Type

One family: **Archivo** (variable width 62–125 %, weight 100–900; self-hosted via `@fontsource-variable/archivo`).

- `font-display` / `.headline`: Archivo condensed (74 % / 68 % width), weight 800–900, uppercase for headings, scores,
  OVR and big numbers.
- Body: Archivo at normal width, 14–16 px. Every figure: `tabular`.
- JetBrains Mono only for invite codes.

Helper classes: `.headline`, `.eyebrow` (kicker with a short blue rule), `.surface`, `.pitch-grid` (thin centre line
and circle), `.club-split` (`--home`/`--away`), `.club-band` (`--club`).

## Game shell (`src/components/shell/*`)

- `hubs.tsx` — five hubs + Clube: **Hoje** (Resumo, Semana), **Equipa** (Plantel, Tática), **Jogo** (Jogos, match
  pages), **Mercado**, **Clube** (Clube, Finanças), **Liga** (Tabela, Jornal, Taça, Balneário, História,
  Definições). Routes are unchanged; `locate()` maps a pathname to its hub and sub-tab.
- `game-shell.tsx` — desktop icon rail; sticky context bar (crest → Clube, league · season · round, live deadline,
  ⌘K search, "Por decidir" button with count, theme toggle) with the hub's sub-tabs; five-hub bottom dock on phones
  (Clube from the crest); the **Por decidir** drawer.
- `command-palette.tsx` — Ctrl/⌘ K: screens, pending decisions, own players, theme and motion actions. Accent-
  insensitive search, arrow keys + Enter.
- Data: `src/server/today-queries.ts` (`getTodayItems`, one RLS query: Gabinete, imprensa, patrocínios, renovações,
  propostas recebidas, contrapropostas, formação).

## Components

- `src/components/ui.tsx` — Card, CardTitle, Headline, Button/ButtonLink (flat), Badge, OvrBadge (ink block with a
  gold/silver/bronze tier rule), Meter (up/warn/down), FormArrow, FormStrip (V/E/D), PosPill (theme-aware), Stat,
  Empty, Field, `inputCls`.
- `src/components/fx/*` — MotionProvider, Reveal/Stagger, Bar, PillTabs/NavTabs, AnimatedNumber, CopyButton, Countdown.
- `src/components/squad/avatar.tsx` / `crest.tsx` — generated avatars, crests (plain/stripes/sash/chevron) and shirts.

Icons: `lucide-react`.

## Rules of thumb

- One hero per screen, then panels sized by importance; each fact lives in one place.
- Colour means something: blue = action/you, green/red = up/down, yellow = trophies/deadlines, club colours = clubs.
- Motion explains change (≤ 250 ms for navigation; never blocks input).
- Keep visible labels the E2E tests rely on (e.g. "O meu clube", "Guardar escalação", "Pts", "Estatísticas").
- Game data (crests, avatars, shirts) stays generated — no real crests or photos; no copied FM/EA/broadcaster assets.
- `tests/e2e/screens.spec.ts` sweeps every game route in both themes at 360 and 1440 px (no horizontal scroll, no
  error overlay) and saves screenshots to `test-results/screens/`.

## Credits

Motion patterns for the sliding tabs, copy button and dock are adapted from [Watermelon UI](https://ui.watermelon.sh)
(MIT License, © Watermelon Platform Contributors).
