# TechClave Capability System (Showcase) — Handover for Codex

**Last updated:** 2026-08-08 · **Author:** Claude (booking-showcase worktree)
**Purpose:** everything a fresh agent needs to continue the `/showcase` marketing-site build.

---

## 1. What this is
A public marketing/portfolio site — the **TechClave Capability System** — built as isolated
`/showcase/*` routes *inside* the Booka repo. It is **quarantined from Booka's data layer** (no
Supabase, no product code). It ships one corporate site + 8 industry "capability demonstrators"
(fictional client sites) + case studies + a capability deck.

**Spec:** `docs/superpowers/specs/2026-07-30-techclave-capability-system-showcase-design.md`
**Plans:** `docs/superpowers/plans/2026-07-30-techclave-*` (session-1, demonstrator-template,
sessions-2-8-demonstrators, sessions-9-12-finish).

## 2. Where the work lives (branch / worktree / push)
- **Branch:** `feature/techclave-showcase-site` (tracks `origin/`). **Push here.**
- Sessions 1–2 also live on `origin/staging` (they were promoted there earlier). Sessions 3–4
  are on `feature/techclave-showcase-site` only — promote to staging when you/the user decide.
- **Do NOT touch `feature/techclave-showcase`** — despite the name, it holds another session's
  **active Booka commerce work** (POS, payment links, storefront). Repointing it destroys that.
- **Multi-session rules (from repo CLAUDE.md):** one worktree per branch; never `git checkout`
  in a worktree another session shares; `git fetch origin` at the start of every task; push
  small and often; cross-branch promotion uses a throwaway `git worktree add --detach` + push.

## 3. Current state — 4 of 8 demonstrators DONE
Registry `src/showcase/content/demonstrators/index.ts`: **published** = SunGrid, Northstar,
Ember, Haven. **planned stubs** (4) = meridian-legal, forge-build, crestfield-academy, atelier-soso.

| # | Demonstrator | Status | Notes |
|---|---|---|---|
| S1 | SunGrid Energy (solar) | ✅ | + design system, schemas, work grid, deck shell, case study |
| S2 | Northstar Clinic (health) | ✅ | reference pattern to mirror |
| S3 | Ember Table (restaurant) | ✅ | sticky mobile CTA |
| S4 | Haven Realty (real estate) | ✅ | client-side filters + illustrative mortgage estimator |

## 4. GATES — use these EXACTLY (some standard ones are traps here)
- **Tests:** `npm test -- src/showcase/content src/showcase/lib` → must pass.
- **Typecheck:** `npm run typecheck` is a **NO-OP in this repo — do NOT trust it.** Use:
  `npm run typecheck:full 2>&1 | grep -E 'src/showcase/|src/app/\(showcase\)|src/components/capability|src/components/system'`
  Your **source files** must be clean. See §7 for the pre-existing noise you will also see.
- **Lint:** `npx eslint "src/app/(showcase)/showcase/demos/<slug>" src/showcase/content/...` → clean.
- **Isolation:** `git grep -nE "@/lib/supabase|from '@/lib/booking'" -- "src/app/(showcase)" src/showcase src/components/capability` → **must be empty.**
- **`npm run build` FAILS in this environment and that is EXPECTED** — it's a pre-existing,
  environmental Booka failure (`next/font/google` can't fetch Google Fonts offline; Sentry config
  warning). **No showcase path appears in the error.** Don't chase it; it is not a showcase gate here.

## 5. How to build the next demonstrator (the established pattern)
Follow `docs/superpowers/plans/2026-07-30-techclave-demonstrator-template.md` (Tasks A–F) with the
per-session delta in `...sessions-2-8-demonstrators.md`. **Easiest path: mirror an existing
demonstrator** (Northstar/Ember/Haven are complete references). For each `<slug>`:
- **A. Theme** → add `<SLUG>_THEME` to `src/showcase/design-system/themes.ts` (delta gives colors/fonts).
- **B. Content** → `src/showcase/content/demonstrators/<slug>.ts` (full `Demonstrator` record);
  replace the `plannedStub({ slug: '<slug>' … })` in `demonstrators/index.ts` with the real import;
  bump the published/planned counts in `src/showcase/content/content.test.ts`.
- **C. Images** → `curl -fsSL` royalty-free Unsplash photos into `public/images/<slug>/` +
  write `CREDITS.md`. NEVER hotlink. If a fetch fails, use a local SVG placeholder and note it.
- **D. Pages** → `src/app/(showcase)/showcase/demos/<slug>/{layout,page,…}.tsx`. Layout wraps in
  `<div className="sc-root sc-bg sc-body min-h-screen" data-theme="<slug>" style={themeVars(<SLUG>_THEME)}>`
  with `DemoHeader`/`Disclaimer`/`DemoFooter`. Each page: `export const metadata` (unique
  title+desc) + capability components (`Hero`,`Section`,`Card`,`FAQ`,`CTASection`,`LeadForm`).
  Forms use the existing `LeadForm` — **local mock, no network**. Interactive widgets are
  `'use client'` in `src/components/capability/demo-shell/`, backed by a pure tested fn in `src/showcase/lib/`.
- **E. Case study** → `src/showcase/content/case-studies/<slug>.ts` (+ `.test.ts` mirroring
  Haven's); register in the `studies` map in `src/app/(showcase)/showcase/case-studies/[slug]/page.tsx`.
- **F. Gate** → run §4 gates; commit small units.

Component prop shapes (from usage): `DemoHeader{name,links:[{label,href}],cta:{label,href}}` ·
`CTASection{title,subtitle?,cta}` · `FAQ{title,items:[{question,answer}]}` ·
`LeadForm{fields:[{name,label,type?,required?,placeholder?}],submitLabel}` · `Container{width:'wide'|'narrow'}` ·
`Section{tone?:'surface'}` · `Heading{level}` · `Text{size?,tone?:'muted'}` · `Card`.

## 6. Truthfulness — NON-NEGOTIABLE (reviewer scans every string)
Every demonstrator is labelled **"Capability Demonstrator"**. **No fabricated** users, revenue,
testimonials, ratings, reviews, awards, traffic, conversion %, or measured performance. Benefits
are phrased **"Designed to…"**. `disclaimer: DISCLOSURE`; case studies carry `disclosure` and NO
`measuredScores`. Alt text must state images are stock and not the real (fictional) brand. Menu/
listing prices are OK (they're content, not performance metrics). No lorem ipsum.

## 7. KNOWN pre-existing issues — do NOT "fix" these here
- `src/app/(showcase)/showcase/demos/sungrid-energy/solutions/page.tsx` passes `id` to `Heading`
  (not in `HeadingProps`) → a real TS error, but it's **another session's SunGrid file**. Report, don't fix.
- **jest/vitest test-type noise:** every `src/showcase/**/*.test.ts` shows `typecheck:full` errors
  like `Property 'toBe' does not exist on type 'Assertion'`. Root tsconfig picks up vitest's global
  `expect` types, but tests **run and pass under jest** (`npm test`). This affects ALL showcase test
  files identically (Northstar/Ember/Haven) — it is baseline noise, **not** a regression. When you
  filter typecheck:full, ignore `*.test.ts` lines and the sungrid solutions line; only NEW errors in
  **source** files are yours.

## 8. Remaining roadmap
- **Session 5** — Meridian Legal (corporate law; consultation inquiry). Delta in `sessions-2-8`.
- **Session 6** — Forge Build (construction; quote request).
- **Session 7** — Crestfield Academy (education; admission inquiry).
- **Session 8** — Atelier Soso (fashion retail; product inquiry + local wishlist).
- **Sessions 9–12** — corporate showcase pages, export renderers (Upwork/LinkedIn/proposal),
  full capability deck, screenshots + SEO/a11y/perf audits. See `...sessions-9-12-finish.md`.

## 9. Environment notes
- A slow `PostToolUse` `npx tsc --noEmit` hook was removed from user settings (it blocked every
  edit ~50s). If edits feel instant, that's why.
- `node_modules` in this worktree is symlinked to the main checkout — don't `npm install` here.
- SDD ledger (scratch, gitignored): `.superpowers/sdd/progress.md` in the worktree.
