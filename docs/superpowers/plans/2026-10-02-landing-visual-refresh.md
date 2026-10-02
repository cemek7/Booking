# Landing Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Techclave home (`/`) and Booka landing (`/booka`) read as one calm brand with fewer boxes and fewer words, without changing positioning, offers or prices.

**Architecture:** Three small presentational server components (`SectionHeading`, `CtaLink`, `Panel`) in `src/components/homepage/` carry the shared look. Both pages are rewritten to use them, following the section tables in the spec.

**Tech Stack:** Next.js 16 app router, React server components, Tailwind v4 (`@import "tailwindcss"`), Jest + Testing Library, Playwright for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-02-landing-visual-refresh-design.md`

## Global Constraints

- Background `var(--brand-paper)`; H1/H2 use `techclave-display`; kickers use `brand-kicker` with solid `--brand-moss` (dark: `--brand-gold`). No new colour tokens.
- Booka ≤ 4 boxed surfaces; Techclave ≤ 2. No three-equal-column card rows.
- `BOOKA_POSITIONING`, `SIAS_BILLING_PLANS`, `SIAS_VERTICAL_PACKAGES` data unchanged. No numerical proof, no testimonials.
- Keep: `h1`; links /revenue pilot/i → `/booka/revenue-pilot`, /missed revenue report/i → `/booka/missed-revenue-report`; ids `#revenue-pilot`, `#missed-revenue-report`, `#how-it-works`, `#pricing`; 4× `pricing-plan`, 4× `usage-policy`; `DemoConversation` untouched.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Mobile 390px: the 8-step band and pricing grid must wrap without horizontal scroll. → covered by the screenshot step in Task 4.
2. Keyboard users: every `CtaLink` needs a visible focus ring. → Task 1 test asserts `focus-visible:` classes.
3. Nav anchors (`#how-it-works`, `#pricing`) must still land on a section. → Task 2 test.
4. Dark-tone headings must stay readable (no ink-on-ink). → Task 1 test asserts tone classes.
5. Techclave legal footer links must survive the rewrite. → Task 3 test.

---

### Task 1: Shared components

**Files:**
- Create: `src/components/homepage/SectionHeading.tsx`, `CtaLink.tsx`, `Panel.tsx`
- Test: `src/components/homepage/sharedPrimitives.test.tsx`

**Interfaces — Produces:**
- `SectionHeading({ kicker: string; title: ReactNode; lede?: ReactNode; as?: 'h1' | 'h2'; tone?: 'light' | 'dark'; className?: string })`
- `CtaLink({ href: string; children: ReactNode; variant?: 'primary' | 'text'; tone?: 'green' | 'ink' | 'light'; className?: string })`
- `Panel({ tone?: 'paper' | 'dark' | 'green'; as?: 'div' | 'section' | 'article'; className?: string; children; ...rest })`

- [x] Step 1: Write failing test: heading level from `as`, kicker text, dark tone uses `text-[var(--brand-paper)]`; CtaLink primary has `rounded-full` + `focus-visible:` + href, text variant has `→`; Panel dark tone has `bg-[var(--brand-ink)]`.
- [x] Step 2: Run `npx jest src/components/homepage/sharedPrimitives` → FAIL (module not found).
- [x] Step 3: Implement the three components (see code in commit).
- [x] Step 4: Run again → PASS.
- [x] Step 5: Commit `feat(site): add shared landing primitives`.

### Task 2: Booka landing

**Files:**
- Modify: `src/components/homepage/BookaLanding.tsx` (full rewrite of JSX per spec §4)
- Test: `src/components/homepage/BookaLanding.test.tsx` (append)

**Interfaces — Consumes:** Task 1 components.

- [x] Step 1: Append failing tests: texts "Set it up once", "Outcome signals", "ICP focus", "Channel strategy" absent; `#how-it-works` element contains "Answer" and "Report"; footer links `/privacy` and `/terms`; ≤ 4 `[data-surface]` elements (Panel sets `data-surface`).
- [x] Step 2: Run → FAIL.
- [x] Step 3: Rewrite per spec §4 table (hero trim, band with `id="how-it-works"`, 2×2 problems, vertical rows, pilot Panel, light report, pricing with recommended ink plan, plain FAQ, final CTA, footer legal links). Remove `howItWorks`, `verticalUseCases`, `SIAS_OUTCOME_ATRIBUTION` import.
- [x] Step 4: Run all homepage tests → PASS (old 3 + new).
- [x] Step 5: Commit `feat(booka): calmer landing layout with fewer sections`.

### Task 3: Techclave home

**Files:**
- Modify: `src/app/page.tsx` (rewrite per spec §5)
- Test: `src/components/homepage/TechclaveHome.test.tsx` (imports `@/app/page`)

- [x] Step 1: Failing test: exactly one `h1` with ≤ 14 words; link to `/booka`; `/privacy` and `/terms` present; "Product-first" and "AI products for customer operations" absent; ≤ 2 `[data-surface]`.
- [x] Step 2: Run → FAIL.
- [x] Step 3: Rewrite per spec §5.
- [x] Step 4: Run → PASS.
- [x] Step 5: Commit `feat(site): calmer Techclave home`.

### Task 4: Verify and ship

- [x] Step 1: `npm run typecheck:ci` → exit 0.
- [x] Step 2: `npx jest src/components/homepage` → all pass.
- [x] Step 3: `npx eslint` on changed files → clean.
- [x] Step 4: `npm run build` → success.
- [x] Step 5: Start `next start` on a free port; Playwright screenshots `/` and `/booka` at 1440×900 and 390×844 (full page); view each; fix layout issues; assert `document.documentElement.scrollWidth <= innerWidth` on mobile.
- [x] Step 6: `git fetch && git rebase origin/staging`, re-run tests, push, open PR into `staging` (do not merge).
