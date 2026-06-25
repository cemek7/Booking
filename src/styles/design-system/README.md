# Boka Design System · v2 (code layer)

Token layer for the reconciled Boka design system. One palette, two contexts
(**marketing** = paper/gold/serif, **app** = near-white/emerald/sans/round). Spec:
`docs/design/boka-design-system-v2-draft.md`.

## Files
- `tokens.css` — plain CSS custom properties (the single source of truth) + surface utilities
  (`.boka-bg`, `.boka-app-bg`, `.boka-hero-green`).
- `theme.css` — Tailwind v4 `@theme` mapping + `bg-boka` / `bg-hero-green` utilities. Values mirror
  `tokens.css` — keep them in sync.

## Wiring it into the app

In `src/app/globals.css`, after the Tailwind import:

```css
@import "tailwindcss";
@import "../styles/design-system/theme.css";   /* Tailwind @theme + utilities */
@import "../styles/design-system/tokens.css";   /* CSS custom properties */
```

`theme.css` powers Tailwind utilities (`bg-green`, `text-ink`, `rounded-card`, `font-display`,
`shadow-card`, `bg-hero-green`…). `tokens.css` exposes the same values as `var(--…)` for inline
styles and non-Tailwind CSS.

> Migration note: the current `globals.css` defines an overlapping `--brand-*` / `--booka-green`
> set and a `.brand-theme` indigo→green override hack. Once components consume these tokens, that
> override block can be deleted — `--green` is a first-class token now, no remapping needed.

## Using the two contexts

| | Marketing | App |
|---|---|---|
| Background | `.boka-bg` / `bg-boka` | `.boka-app-bg` (or `bg-app-canvas`) |
| Headings | `font-display` (serif), tight tracking | `font-sans`, `font-semibold`, tracking-tight |
| Accent | `text-gold` / `bg-gold` (sparing) | `bg-green`, `text-green` |
| Cards | editorial: paper-strong + gold kicker | `rounded-card` (18px) + `shadow-card`; hero: `bg-hero-green rounded-3xl` |
| Buttons | — | **pill** (`rounded-pill`), green fill |

App body text uses `text-moss` / `text-ink-soft` (warm) — **not** slate. Status colors:
`text-confirmed` / `text-pending` / `text-cancelled` / `text-noshow`. No indigo anywhere.
