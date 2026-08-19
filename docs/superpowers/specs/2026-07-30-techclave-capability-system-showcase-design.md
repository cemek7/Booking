# TechClave Capability System (Showcase) — Design & Session-1 Scope

**Date:** 2026-07-30
**Status:** Approved (brainstorm) — ready for implementation planning
**Home:** Inside the Booka repo (`Booking/Booking`), as isolated public marketing routes under a
`/showcase` namespace. The existing landing page at `/` is left untouched.

> **North-star spec:** the full "TechClave Capability System — Execution-Grade Build Specification"
> (corporate site + 8 demonstrators + component library + canonical case-study system + capability
> deck + export renderers + screenshot automation) is the multi-session target. This document adapts
> it to live inside Booka and defines **Session 1** only. Later sessions add the remaining 7
> demonstrators, export renderers (Upwork/LinkedIn/proposal/deck), and Playwright screenshots.

---

## 1. Objective
Stand up the TechClave capability-showcase foundation inside the existing Booka Next.js app —
isolated design system + one complete, truthful capability demonstrator (**SunGrid Energy**) +
one case study + canonical schemas + a deck shell — reusing Booka's Next 16 / React 19 / Tailwind /
TypeScript toolchain without touching Booka's product surface or data layer.

## 2. Non-negotiable truthfulness rules (carried verbatim from the north-star spec)
- Every demonstrator is labeled **"Capability Demonstrator"** — never presented as commissioned client work.
- **No fabricated** users, revenue, testimonials, traffic, conversion lifts, awards, or measured performance.
- Any expected benefit is labeled **"Designed outcome" / "Expected impact" / "Illustrative benchmark."**
- Required disclosure on each demonstrator: *"This is a TechClave capability demonstrator created to
  show design, development, and conversion-system capabilities. It is not presented as commissioned client work."*
- No lorem ipsum, no hotlinked images, no fake customer logos/testimonials.
- Demonstrators add **no auth, billing, database, CMS, dashboard, payments, or external APIs** — forms
  use **local mock submission**.
- Strict TypeScript; no `any` without a documented reason. Accessibility + reduced-motion respected.

## 3. Current-state findings (grounding, verified 2026-07-30)
- `Booking/Booking` is the TechClave web app. `src/app/page.tsx` **is** the TechClave studio landing page
  (markets Booka + Managed Ops). Flat route structure; no route groups yet.
- **Root layout** (`src/app/layout.tsx`) wraps *every* route: Booka fonts (Mulish/Fraunces) as CSS vars,
  `<body class="brand-theme antialiased">`, and `AnalyticsProvider` + `ConsentBanner` + `ToastContainer`.
  This is unavoidable in App Router — demonstrator isolation is handled by a nested layout (§5.1).
- **Middleware** (`src/middleware.ts`) protects *specific* prefixes (e.g. `/dashboard/*`, `/admin`,
  `/superadmin`, onboarding) — **allow-by-default**. `/showcase/*` matches none, so it is public by
  default. Middleware also sets a **CSP** header on all non-API responses.
- Namespace is clear: `src/app/(showcase)`, `src/showcase`, `src/components/capability`, `src/content`,
  `src/design-system` — all currently free (no collisions).

## 4. Architecture decisions
- **Route namespace:** everything under `/showcase/*` in a single `(showcase)` route group. One isolation
  boundary; zero risk to Booka's top-level namespace.
- **First demonstrator:** **SunGrid Energy** (solar) — spec's recommendation, aligns with the solar
  outreach direction, doubles as a real direct-outreach sales asset.
- **Booka chrome suppressed on `/showcase/*`:** demonstrators feel standalone — no Booka consent banner
  or PostHog analytics (§5.1).
- **Quarantine:** showcase code MUST NOT import `@/lib/supabase`, Booka data/services, or Booka product
  components. It lives only in `src/app/(showcase)`, `src/showcase`, `src/components/capability`.
- **Theming:** CSS-custom-property themes scoped under a `data-theme` wrapper so they never override
  Booka's global `brand-theme`.

## 5. Session-1 file structure
```
src/app/(showcase)/
  layout.tsx                         # showcase shell (chrome-gate + neutral base theme)
  showcase/page.tsx                  # capability index
  showcase/work/page.tsx             # portfolio grid: 8 demonstrators + status labels
  showcase/demos/sungrid-energy/
    layout.tsx                       # solar theme (data-theme="sungrid") + own display font
    page.tsx                         # Home
    solutions/page.tsx  savings/page.tsx  projects/page.tsx  process/page.tsx  contact/page.tsx
  showcase/case-studies/[slug]/page.tsx
  showcase/capability-deck/page.tsx  # 16:9 shell only
src/showcase/
  design-system/{tokens.ts, themes.ts, variants.ts, README.md}
  content/{techclave.ts, demonstrators/sungrid-energy.ts, case-studies/sungrid-energy.ts, deck.ts}
src/components/capability/{core, layout, navigation, sections, conversion, forms, content, demo-shell}/
```

### 5.1 Chrome-gate (the key integration mechanism)
Booka's root layout renders `ConsentBanner`/`AnalyticsProvider` globally. Rather than restructure Booka's
routes, add a small **client** gate that reads `usePathname()` and renders those two only when the path is
**not** under `/showcase`. `(showcase)/layout.tsx` provides the showcase base theme wrapper and loads the
showcase fonts. Net effect: `/showcase/*` renders inside Booka's `<html>` but with none of Booka's visible
chrome and its own theme.

### 5.2 Middleware
Verify `/showcase/*` is not caught by any protected prefix (it is not, today) and add an explicit comment/guard
so future changes don't accidentally gate it. Confirm the CSP allows showcase fonts/images (self + data: + the
existing font hosts). No new API routes.

## 6. Canonical schemas (types, defined once, reused by all future sessions)
`SiteTheme`, `Demonstrator` (`projectType: "Capability Demonstrator"`, `status`), and `CaseStudy` — copied
from the north-star spec's data models into `src/showcase/content/types.ts`. Session 1 populates SunGrid;
the other 7 are `status: "planned"` stubs referenced by the `/showcase/work` grid.

## 7. SunGrid Energy demonstrator (the one complete build)
- Pages: Home, Solutions, Savings, Projects, Process, Contact.
- Features: residential/commercial paths, **site-assessment form (local mock)**, **illustrative** savings
  estimator (clearly labeled illustrative), projects gallery, financing-info placeholder, process timeline,
  FAQ, service area, SEO metadata per route, and the required disclosure banner.
- Visual direction: technical, credible, bright, modern, strong data presentation — distinct solar theme.
- Fully responsive (390 / 768 / 1280 / 1440), keyboard-navigable, reduced-motion aware.

## 8. SunGrid case study + deck shell
- One `CaseStudy` record for SunGrid + the **website renderer** (rich case-study page at
  `/showcase/case-studies/sungrid-energy`) with disclosure. Upwork/LinkedIn/proposal renderers are deferred.
- `/showcase/capability-deck` — a 16:9 web layout shell (cover + section scaffold), no full content yet.

## 9. Testing (Session 1)
- Content/schema validation (Demonstrator + CaseStudy typecheck); theme-mapping unit test.
- Form validation + local-mock success/error states; estimator math.
- Visual QA at 390/768/1280/1440 (no overflow, no clipped text, no broken images).
- Isolation check: no showcase file imports `@/lib/supabase` or Booka product components.
- `/showcase/*` renders without Booka consent banner/analytics; Booka `/` and product routes unchanged.
- `npm run typecheck`, `npm run lint`, `npm run build` all pass.

## 10. Explicitly out of scope (Session 1)
Other 7 demonstrators; Playwright screenshot automation; Upwork/LinkedIn/proposal/deck export renderers;
any change to Booka's `/`, product routes, backend, or root `CLAUDE.md`; real contact API.

## 11. Session gate (definition of done)
SunGrid demonstrator complete + truthful + responsive; case study renders; schemas canonical; deck shell
renders; showcase visually isolated from Booka; all checks green; `/showcase/work` lists all 8 with status;
no placeholders in shipped SunGrid pages.

## 12. Implementation order (for the plan)
1. `(showcase)` route group + `layout.tsx` + chrome-gate; middleware/CSP verification.
2. Design system: tokens, `SiteTheme`, SunGrid theme (+7 stubs), core primitives.
3. Canonical schemas + SunGrid content record.
4. SunGrid pages (Home → Contact) with mock form + illustrative estimator + disclosure.
5. `/showcase/work` grid (8 statuses) + `/showcase` index.
6. SunGrid case study (website renderer) + `/showcase/capability-deck` shell.
7. Tests + QA + build; docs/DECISIONS.md + docs/OPEN_ISSUES.md entries.

Ship as small reviewable units; do not start multiple demonstrators.

## 13. Full session roadmap (plans cover the entire north-star spec)
Image policy (all sessions): **source royalty-free web images (Unsplash/Pexels commercial license), download** into `public/images/<slug>/`, never hotlink; record source+license in `public/images/<slug>/CREDITS.md`; render via `next/image`.

| Session | Deliverable | Plan file |
|---|---|---|
| 1 | Foundation + design system + SunGrid + schemas + deck shell + work grid | plans/2026-07-30-techclave-capability-system-session-1.md |
| — | Reusable demonstrator build template | plans/2026-07-30-techclave-demonstrator-template.md |
| 2–8 | Northstar → Ember → Haven → Meridian → Forge → Crestfield → Atelier (each: theme+pages+case study) | plans/2026-07-30-techclave-sessions-2-8-demonstrators.md |
| 9 | Corporate showcase pages (services/methodology/capabilities/contact) | plans/2026-07-30-techclave-sessions-9-12-finish.md |
| 10 | Export renderers (Upwork/LinkedIn/proposal from canonical case-study data) | plans/2026-07-30-techclave-sessions-9-12-finish.md |
| 11 | Capability deck (35–50 slides) + print/PDF | plans/2026-07-30-techclave-sessions-9-12-finish.md |
| 12 | Screenshot automation + SEO/a11y/perf audits + final QA | plans/2026-07-30-techclave-sessions-9-12-finish.md |

Demonstrator order (chosen): SunGrid → Northstar Clinic → Ember Table → Haven Realty → Meridian Legal → Forge Build → Crestfield Academy → Atelier Soso.
