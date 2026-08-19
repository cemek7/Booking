# TechClave Demonstrator — Reusable Build Template

> **For agentic workers:** This is the shared build pattern referenced by every per-demonstrator plan (Sessions 2–8). Each demonstrator plan supplies only the DELTA (theme, pages, features, content, case study, images); the mechanics below are identical. Follow Session-1's already-implemented components — do NOT rebuild them.

**Prereq:** Session 1 complete (design system, `SiteTheme`/`Demonstrator`/`CaseStudy` types, `themeVars`, capability primitives, `DISCLOSURE`, `DEMONSTRATORS` registry, `LeadForm`, `Disclaimer`, `estimateSolarSavings` pattern, `showcase.css`).

**Global Constraints:** identical to Session 1 — truthfulness/disclosure non-negotiables; no backend (local-mock forms); quarantine from Booka data layer; strict TS; a11y + reduced-motion; ₦ money; only new files under `src/app/(showcase)`, `src/showcase`, `src/components/capability`. **Never** edit Booka's `/`, product routes, backend, or root `CLAUDE.md`.

## Per-demonstrator task sequence (repeat for each `<slug>`)

### Task A: Theme
- **Files:** `src/showcase/design-system/themes.ts` (add `<SLUG>_THEME: SiteTheme`).
- [ ] Write a test asserting `<SLUG>_THEME.id === '<slug>'` and that `themeVars(<SLUG>_THEME)['--sc-primary']` equals its primary. Run FAIL → add the theme record (values from the demo plan's Theme block) → PASS. Commit `feat(showcase): <slug> theme`.

### Task B: Content record + registry status
- **Files:** `src/showcase/content/demonstrators/<slug>.ts`; modify `demonstrators/index.ts` to replace the planned stub with the full record and set `status:'published'`.
- [ ] Update the Task-3 content test count/status expectation (published count +1). Write the full `Demonstrator` record (all fields; `projectType:'Capability Demonstrator'`, `disclaimer:DISCLOSURE`, `designedOutcome` items labeled "Designed outcome …"). Run content test PASS. Commit `feat(showcase): <slug> demonstrator content`.

### Task C: Images (web-sourced, vendored)
- [ ] Source royalty-free images (Unsplash/Pexels license — commercial-safe) matching the demo's industry; **download** into `public/images/<slug>/` with descriptive filenames (e.g. `hero.jpg`, `gallery-1.jpg`). Never hotlink. Record source URLs + license in `public/images/<slug>/CREDITS.md`. Use `next/image` with width/height. Commit `chore(showcase): <slug> imagery`.

### Task D: Demo layout + pages
- **Files:** `src/app/(showcase)/showcase/demos/<slug>/layout.tsx` + one `page.tsx` per route in the demo plan's Pages block.
- [ ] Layout: copy the SunGrid layout pattern, swapping `<SLUG>_THEME`, `data-theme="<slug>"`, brand name, and NAV. Renders `DemoHeader`/children/`Disclaimer`/`DemoFooter`.
- [ ] Each page: `export const metadata` (unique title+description), semantic sections composed from capability primitives (`Hero`, `Section`, `CTASection`, `FAQ`, `ProcessSteps`, `Card`, `LeadForm`, gallery via `next/image`), the demo's Features, and the conversion form (local-mock). Use only `sc-*`/Tailwind classes — no Booka components.
- [ ] Any estimator/interactive widget is a client component with a pure, tested math function in `src/showcase/lib/<slug>-*.ts`, clearly labeled **Illustrative**.
- [ ] Verify at 390/768/1280/1440: no overflow/clipping/broken images; theme applied; disclosure present. Commit `feat(showcase): <slug> demonstrator pages`.

### Task E: Case study
- **Files:** `src/showcase/content/case-studies/<slug>.ts`; register in the `CASE_STUDIES` map used by `/showcase/case-studies/[slug]`.
- [ ] Write a test asserting the record has `projectType:'Capability Demonstrator'`, the disclosure, non-empty `outcomes.designedImpact` + `outcomes.limitations`, and **no** `measuredScores`. FAIL → author the full `CaseStudy` record (real prose per §D field list) → PASS. Verify `/showcase/case-studies/<slug>` renders. Commit `feat(showcase): <slug> case study`.

### Task F: Gate
- [ ] `npm test -- src/showcase src/components/capability && npm run typecheck && npm run lint`. Confirm `/showcase/work` now links the demo as `published`. Commit if any fixes.

**Definition of done (per demonstrator):** distinct theme; all routed pages complete + truthful + responsive; working local-mock conversion form; case study renders; registry shows `published`; all checks green; no placeholders, no fabricated metrics.
