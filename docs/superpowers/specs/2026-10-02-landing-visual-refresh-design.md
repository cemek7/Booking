# Techclave + Booka Landing Visual Refresh — Design

**Date:** 2026-10-02
**Status:** Approved in conversation (3 sections), pending written-spec review
**Scope:** `src/app/page.tsx` (Techclave home) and `src/components/homepage/BookaLanding.tsx` (Booka landing). Visuals plus trim. No new copy direction.
**Governing spec:** `2026-08-29-booka-revenue-front-desk-positioning-design.md`. Its information architecture (§9), proof policy (§7) and pricing rules stay authoritative. This refresh changes presentation and length only.

## 1. Problem

An audit against the installed design skills (taste-skill / redesign-skill) found:

1. Both pages wrap every block in a bordered, shadowed, rounded card. Nothing has hierarchy.
2. Generic three-equal-card rows (Booka: how-it-works, verticals; Techclave: products).
3. Too many words: 20-word Techclave H1, long paragraphs, internal jargon ("ICP focus", "use-case clusters", "operating layer").
4. Brand split: Booka uses a white background and sans H1; Techclave uses brand paper and the Fraunces display face.
5. Smaller issues: pill-shaped everything (nav, buttons, tags), ~15 faded uppercase kickers (`emerald-700/45` fails contrast), busy Booka hero, Booka footer has no legal links.

Already resolved on `staging` and out of scope: unsupported hero metrics (removed under §7 of the positioning spec); Techclave footer legal links.

Customer testimonials are deliberately excluded: positioning spec §7 forbids proof before verified case studies exist.

## 2. Goals and success criteria

- Both pages read as one brand: same background, same headline face, same kicker, same button system.
- Booka goes from 11 content sections to 9, with ~40% fewer words. Headline (`BOOKA_POSITIONING`), offers, prices and plan data are unchanged.
- Box count per page: Booka ≤ 4 boxed surfaces (demo chat, workflow band, pilot panel, pricing plans); Techclave ≤ 2 (featured Booka card, product row for Booka).
- No three-equal-column card rows remain.
- All kickers use a solid colour with WCAG AA contrast on brand paper.
- Existing `BookaLanding.test.tsx` passes unchanged. `typecheck:ci`, `jest`, `next build` pass.
- Desktop (1440) and mobile (390) screenshots of both pages are reviewed by eye before the PR.

## 3. Shared look (both pages)

| Element | Rule |
|---|---|
| Background | `var(--brand-paper)` (`#f6f5ef`). Booka drops `bg-white`. |
| Headlines | H1 and H2 use `techclave-display` (Fraunces). Body stays Mulish. |
| Sections | Sit on the background, separated by spacing and a `--brand-line` hairline. No card by default. |
| Boxes | Only where elevation means something (see §2 limits). Use `Panel`. |
| Buttons | One solid primary per section. Secondary actions are text links with →. Nav links are plain text. |
| Kickers | One per section, `brand-kicker` class, solid `--brand-moss` (dark band: `--brand-gold`). No opacity variants. |
| Accent | Booka: `--booka-green`. Techclave: `--brand-ink` primary, green only for Booka references. One accent per page. |

Existing tokens in `src/app/globals.css` (`--brand-*`, `--booka-*`) are reused. No new colour tokens.

### New shared components (`src/components/homepage/`)

- `SectionHeading.tsx` — props: `kicker`, `title`, `lede?`, `as?: 'h1' | 'h2'`, `tone?: 'light' | 'dark'`. Renders kicker + display-face title + optional one-line lede.
- `CtaLink.tsx` — props: `href`, `children`, `variant: 'primary' | 'text'`, `tone?: 'green' | 'ink' | 'light'`. Primary = solid rounded button with hover lift + `active:scale-[0.98]` + visible focus ring. Text = underline-on-hover link with trailing →.
- `Panel.tsx` — props: `tone: 'paper' | 'dark' | 'green'`, `className?`, `children`. The only boxed surface. Single radius scale (`rounded-[1.75rem]` outer).

Each is a pure presentational server component with no state.

## 4. Booka page (`BookaLanding.tsx`)

Order follows positioning spec §9.

| # | Section | Change |
|---|---|---|
| 1 | Hero | Keep category kicker, `BOOKA_POSITIONING.headline`, subcopy (trim to ≤ 30 words), pilot CTA (primary) + report CTA (text link), `DemoConversation`. Cut the 3 capability tiles and the "Booka by Techclave" pill. `launchNotes` become one muted line separated by `·`. |
| 2 | Workflow band | Keep as the single dark `Panel`. 8 steps in one row (wraps 4×2 on mobile). Takes over `id="how-it-works"` so the nav "How it works" link still resolves. Below the steps: the three channel-rule lines (Instagram, WhatsApp, one view), unchanged in meaning. |
| 3 | How it works ("Set it up once. Let it run.") | **Cut.** Duplicates the workflow band. Its anchor moves to the band. |
| 4 | Capture / Convert / Recover / Grow | 2×2 grid, no boxes. Bold `promise` + one line of `copy` (trimmed). |
| 5 | Verticals | 3 stacked rows (name · one-line positioning · flow tags), not 3 cards. Drop the sales/booking sub-boxes. The Channel strategy panel moves into the workflow band (it carries consent rules and positioning §9 item 2). Kicker "Who it's for". |
| 6 | 14-Day Revenue Pilot | Keep as main `Panel` (paper). Keep `#revenue-pilot` id and link. |
| 7 | Missed Revenue Report | Lighter: no panel, two-column text + text CTA. Keep `#missed-revenue-report` id and link. |
| 8 | Pricing | Keep 4 plans (`data-testid="pricing-plan"`, `usage-policy`). Recommended plan (`front-desk`) gets ink background + "Recommended" label. Other plans get a hairline border only. Usage-policy line pinned to the bottom of each plan so they align. No per-plan buttons added. |
| 9 | Outcome signals | **Cut.** Not in positioning IA; pilot report covers it. |
| 10 | FAQ | Plain 2-column question/answer list, no boxes. |
| 11 | Final CTA + footer | One primary CTA (pilot). Footer adds Privacy and Terms links (`/privacy`, `/terms`). |

Booka nav: plain text links (Techclave, How it works, Pricing, Sign in); "Start onboarding" stays the one primary.

Must remain present: `h1`, links named /revenue pilot/i → `/booka/revenue-pilot`, /missed revenue report/i → `/booka/missed-revenue-report`, ids `#revenue-pilot` and `#missed-revenue-report`, 4 `pricing-plan`, 4 `usage-policy`, `vertical-demo` with `data-default-vertical="beauty"` (inside `DemoConversation`, untouched).

Data removed: `howItWorks` const; the `SIAS_OUTCOME_ATRIBUTION` import if no longer used on this page (the export stays in `sias.ts`). `verticalUseCases` is removed if the row layout no longer renders it.

## 5. Techclave page (`src/app/page.tsx`)

| Area | Change |
|---|---|
| Nav | Plain text links; "Explore Booka" stays as the one primary. |
| Hero | Remove the "AI products for customer operations" pill and the duplicate "Techclave" kicker. H1 shortened to ~12 words, e.g. "AI products that help African businesses sell and book on chat." Subcopy trimmed to ≤ 30 words. Primary "View Booka" + text link "Start onboarding". |
| Hero right | Keep the dark featured Booka card (`Panel tone="dark"`). Cut the 4 filler stat tiles. |
| Products | Booka as one wide row (`Panel tone="paper"`). Managed Ops and More products as two compact text rows below. Remove the 3-colour name pills. |
| Principles | Heading left, numbered list right (01–03), no boxes. |
| Closing | Cream section (no second dark box): heading, one primary CTA ("Open Booka"), text links "Start onboarding", "Talk to us". |
| Footer | Unchanged. |

## 6. Testing

- Existing `src/components/homepage/BookaLanding.test.tsx` passes unchanged.
- Add to it:
  - no text "Set it up once", "Outcome signals" or "ICP focus";
  - channel consent lines still present (text "opted in");
  - `#how-it-works` exists and is the workflow band;
  - footer has links to `/privacy` and `/terms`.
- New `src/components/homepage/SectionHeading.test.tsx` / `CtaLink.test.tsx`: render, heading level, primary vs text variant classes, href.
- New Techclave home test (if none exists): one `h1`, link to `/booka`, legal links still present, filler stat labels ("Product-first") absent.
- Gates: `npm run typecheck:ci`, `npx jest src/components/homepage src/app`, `npm run build`.
- Visual check: run the app, Playwright screenshots of `/` and `/booka` at 1440×900 and 390×844, review by eye (layout bugs are not caught by tests).

## 7. Delivery

- Worktree `Booking/worktrees/landing-refresh`, branch `feat/landing-visual-refresh` off `origin/staging` (1759338).
- Small commits: shared components → Booka page → Techclave page → tests → spec/plan docs.
- Re-fetch and rebase on `origin/staging` before push (staging moves fast).
- Open a PR into `staging` for review. Do not merge.

## 8. Out of scope

- Copy direction or positioning changes beyond trimming.
- `DemoConversation.tsx` internals.
- `/products`, `/showcase`, `/contact`, auth pages.
- Testimonials or numerical proof (forbidden by positioning spec §7 until verified).
- FAQ topic expansion required by positioning spec §9.11 (separate copy task).
