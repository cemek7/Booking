# TechClave Capability System — Sessions 9–12 (Corporate, Exports, Deck, QA)

> **For agentic workers:** Sessions after the 8 demonstrators. Same global constraints as the template (truthfulness/disclosure, no backend, quarantine, strict TS, a11y). Build in order. Prereq: Sessions 1–8 complete.

---

## Session 9 — Corporate showcase pages
Adds the north-star spec's §A corporate pages under `/showcase` (the Home stays Booka's `/` — do NOT rebuild it).

**Files:** `src/app/(showcase)/showcase/{services,methodology,capabilities,contact}/page.tsx`; content in `src/showcase/content/{services.ts, methodology.ts, capabilities.ts}`.

- [ ] **Task 1 — Services.** Content record: 7 services (business websites/landing, redesign & CRO, full-stack web apps, API/integration, workflow automation, AI-assisted features, technical audits) each with `problemSolved`, `deliverables`, `suitableBuyer`, `engagementShape`, `cta`. Test the record shape (7 entries, all fields non-empty). Page composes `ServiceCard`s. Commit.
- [ ] **Task 2 — Methodology.** 8 steps (Discover→Improve) each `{objective, outputs, clientInvolvement, qualityGate}`. Test shape. Page renders a `Timeline`/`ProcessSteps`. Commit.
- [ ] **Task 3 — Capabilities.** Organized by outcomes (customer acquisition, booking/lead flows, business websites, internal workflows, API integration, secure product engineering, AI-assisted experiences). Page renders outcome groups. Commit.
- [ ] **Task 4 — Contact.** Fields: name, email, company, website, service needed, budget range, timeline, project summary — **local mock submit** via `LeadForm`. Commit.
- [ ] **Task 5 — Nav + `/showcase` index polish.** Corporate header/nav across `/showcase/*` (not demo routes); index links Work/Services/Methodology/Capabilities/Contact. Verify responsive + a11y. Commit.
**Gate:** all corporate pages truthful, responsive, CTA present; typecheck/lint/build green.

---

## Session 10 — Export renderers (from canonical case-study data)
Generates channel copy from each `CaseStudy` record — no duplicated claims, disclosure preserved.

**Files:** `src/showcase/lib/renderers/{upwork.ts, linkedin.ts, proposal.ts}` (pure fns) + `src/app/(showcase)/showcase/case-studies/[slug]/export/page.tsx` (view/copy panel).

- [ ] **Task 1 — Upwork renderer.** `renderUpwork(cs: CaseStudy): string` → 300–600 words: title, overview, problem, solution, capabilities, role, stack, disclosure. Test: length band + contains disclosure + no `measuredScores` leakage. Commit.
- [ ] **Task 2 — LinkedIn renderer.** `renderLinkedIn(cs): string` → hook, problem, three decisions, result, disclosure, link. Test shape. Commit.
- [ ] **Task 3 — Proposal one-pager.** `renderProposal(cs): { problem, relevantDemo, approach, proofPoints, cta }`. Test. Commit.
- [ ] **Task 4 — Export view.** Per-slug page rendering the three outputs with copy-to-clipboard; generated purely from the record. Verify for SunGrid + one other. Commit.
**Gate:** all renderers derive from canonical data, disclosure always present, no fabricated metrics; tests green.

---

## Session 11 — Capability deck (full)
Turns the Session-1 shell into the 35–50 slide web deck with print/PDF export.

**Files:** `src/showcase/content/deck.ts` (slide data), `src/app/(showcase)/showcase/capability-deck/page.tsx` + `deck.css` (16:9 + `@media print`), `src/components/capability/deck/{Slide,SlideGrid}.tsx`.

- [ ] **Task 1 — Slide model + content.** `type Slide` + `DECK: Slide[]` following the north-star slide plan (cover; one-sentence positioning; problems; capabilities; service map; buyers; methodology; quality; tech approach; engagement models; Booka internal product 3–4; then 3–4 slides per demonstrator ×8; reusable delivery system; why TechClave; CTA; contact; disclosure/appendix). Test: 35 ≤ DECK.length ≤ 50, one message per slide (title present), no fabricated metrics. Commit.
- [ ] **Task 2 — Web deck render.** 16:9 slides, diagram/screenshot-first, ≤~45 words on normal slides. Keyboard nav between slides. Commit.
- [ ] **Task 3 — Print/PDF.** `@media print` one-slide-per-page, no clipping; document `Print → Save as PDF` in `docs/DECK.md` (avoid a heavy PDF dep unless needed). Verify print preview. Commit.
**Gate:** readable, unclipped, truthful, clear CTA; disclosure in case-study footers.

---

## Session 12 — Screenshots, audits, final QA
**Files:** `scripts/showcase-screenshots.mjs` (Playwright), `docs/showcase/{PERFORMANCE.md, ACCESSIBILITY.md, CONTENT_AUDIT.md}`.

- [ ] **Task 1 — Screenshot automation.** Playwright script capturing per demonstrator at 1440×1000, 1280×900, 768×1024, 390×844: home hero, key conversion section, a supporting page, a form state, mobile home, mobile conversion. Output to `public/mockups/<slug>/{desktop-home,desktop-detail,mobile-home,mobile-form}.png`. Run against `npm run build && npm start`. Commit.
- [ ] **Task 2 — SEO check.** Every `/showcase/*` route has unique title/description/canonical/OG; add `app/(showcase)/showcase/sitemap.ts` + robots entry for showcase. Verify. Commit.
- [ ] **Task 3 — Accessibility audit.** Keyboard nav, visible focus, skip link, labels, contrast, reduced motion, landmarks, alt text, modal focus. Record in `ACCESSIBILITY.md`; fix blockers. Commit.
- [ ] **Task 4 — Performance.** `next/image` everywhere, static rendering, lazy below-fold, optimized fonts. Measure (Lighthouse) and record actual scores in `PERFORMANCE.md` — only claim numbers you measured (targets: Perf 90+, A11y 95+, BP 95+, SEO 95+). Commit.
- [ ] **Task 5 — Content audit + isolation.** `CONTENT_AUDIT.md`: confirm every demonstrator labeled "Capability Demonstrator", disclosures present, no fabricated metrics, no lorem ipsum, no hotlinked/broken images, no broken routes. Re-run the quarantine grep (no Booka data-layer imports). Commit.
- [ ] **Task 6 — Final build gate.** `npm run typecheck && npm run lint && npm test && npm run build`. Update `docs/OPEN_ISSUES.md` (close resolved; note any deferrals). Commit.
**Completion (whole project):** corporate + `/showcase` deployed; 8 demonstrators + 8 case studies present with disclosures; component library documented; deck exportable; Upwork/LinkedIn/proposal copy for all 8; screenshots present; all checks green; no broken routes / lorem ipsum / fake evidence; README explains adding a 9th demonstrator.
