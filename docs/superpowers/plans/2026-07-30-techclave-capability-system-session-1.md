# TechClave Capability System — Session 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up an isolated `/showcase` capability system inside the Booka app — chrome-gated route group, scoped CSS-var design system, canonical schemas, one complete **SunGrid Energy** demonstrator, a SunGrid case study, a `/showcase/work` grid (8 with status), and a capability-deck shell — without touching Booka's `/`, product routes, backend, or root `CLAUDE.md`.

**Architecture:** A `(showcase)` App-Router group with its own nested layout. Booka's root layout keeps rendering globally, but a client `usePathname()` gate suppresses Booka's `ConsentBanner` + PostHog analytics on `/showcase/*`. Each demonstrator scopes its theme via a `data-theme` wrapper + CSS custom properties (overriding Booka's `:root` vars for its subtree only). Showcase code is quarantined from Booka's data layer.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind, strict TypeScript, Jest (jsdom) + `@testing-library/react`.

## Global Constraints

- **Truthfulness (verbatim):** every demonstrator labeled **"Capability Demonstrator"**; **no fabricated** users/revenue/testimonials/traffic/conversion/awards/performance; benefits labeled **"Designed outcome" / "Expected impact" / "Illustrative benchmark"**; required disclosure string (Task 3). No lorem ipsum, no hotlinked images, no fake logos.
- **No backend for demos:** no auth/db/billing/CMS/API; forms use **local mock submission**.
- **Quarantine:** no file under `src/app/(showcase)`, `src/showcase`, or `src/components/capability` may import `@/lib/supabase`, Booka services, or Booka product components.
- **Do NOT modify** Booka's `/` (`src/app/page.tsx`), product routes, backend, `src/middleware.ts` auth logic, or root `CLAUDE.md`. The ONLY edit to a Booka file is the root-layout chrome-gate (Task 1), which must be behavior-identical off `/showcase`.
- Strict TS, no `any` without a documented reason. Accessibility + `prefers-reduced-motion` respected. Money shown in ₦ (Naira).
- Test env: Jest `jsdom`; `@/` → `src/`; setup `src/test/jest.setup.ts`. Commands: `npm test -- <path>`, `npm run typecheck`, `npm run lint`, `npm run build`.

## File Structure

- `src/components/system/RootChrome.tsx` — client gate: renders Booka analytics+consent except on `/showcase`.
- `src/app/layout.tsx` — MODIFY: wrap chrome in `RootChrome` (only Booka-file change).
- `src/app/(showcase)/layout.tsx` — showcase base layout (neutral theme wrapper, metadata base).
- `src/app/(showcase)/showcase/page.tsx` — capability index.
- `src/app/(showcase)/showcase/work/page.tsx` — 8-demonstrator grid.
- `src/app/(showcase)/showcase/demos/sungrid-energy/layout.tsx` + `page.tsx` + `solutions|savings|projects|process|contact/page.tsx`.
- `src/app/(showcase)/showcase/case-studies/[slug]/page.tsx`.
- `src/app/(showcase)/showcase/capability-deck/page.tsx` — 16:9 shell.
- `src/showcase/design-system/{tokens.ts, themes.ts, themeVars.ts}`.
- `src/showcase/content/{types.ts, techclave.ts, disclosure.ts, demonstrators/index.ts, demonstrators/sungrid-energy.ts, case-studies/sungrid-energy.ts}`.
- `src/showcase/lib/estimator.ts` — illustrative savings math (pure).
- `src/components/capability/{core,layout,conversion,content}/…` — primitives.
- `docs/DECISIONS.md`, `docs/OPEN_ISSUES.md`.

---

## Task 1: Chrome-gate + `(showcase)` route group skeleton

**Files:** Create `src/components/system/RootChrome.tsx`, `src/app/(showcase)/layout.tsx`, `src/app/(showcase)/showcase/page.tsx`; Modify `src/app/layout.tsx`; Test `src/components/system/RootChrome.test.tsx`.

**Interfaces:**
- Produces: `RootChrome({ children, posthogKey?, posthogHost? })` — renders `<AnalyticsProvider><AuthHashRedirect/><ToastContainer/>{children}<ConsentBanner/></AnalyticsProvider>` normally, but on `/showcase*` renders `<>{children}</>` only (keeps `AuthHashRedirect`+`ToastContainer` optional-off; analytics + consent suppressed).

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/system/RootChrome.test.tsx
import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

let mockPath = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));
jest.mock('@/components/analytics/AnalyticsProvider', () => ({ __esModule: true, default: ({ children }: any) => <div data-testid="analytics">{children}</div> }));
jest.mock('@/components/consent/ConsentBanner', () => ({ __esModule: true, default: () => <div data-testid="consent" /> }));
jest.mock('@/components/AuthHashRedirect', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/toast', () => ({ ToastContainer: () => null }));

import RootChrome from './RootChrome';

describe('RootChrome', () => {
  it('renders Booka analytics + consent on normal routes', () => {
    mockPath = '/';
    render(<RootChrome><span>child</span></RootChrome>);
    expect(screen.getByTestId('analytics')).toBeTruthy();
    expect(screen.getByTestId('consent')).toBeTruthy();
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('suppresses analytics + consent on /showcase routes', () => {
    mockPath = '/showcase/demos/sungrid-energy';
    render(<RootChrome><span>child</span></RootChrome>);
    expect(screen.queryByTestId('analytics')).toBeNull();
    expect(screen.queryByTestId('consent')).toBeNull();
    expect(screen.getByText('child')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npm test -- src/components/system/RootChrome.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `RootChrome`**

```tsx
// src/components/system/RootChrome.tsx
'use client';
import { usePathname } from 'next/navigation';
import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';
import ConsentBanner from '@/components/consent/ConsentBanner';
import AuthHashRedirect from '@/components/AuthHashRedirect';
import { ToastContainer } from '@/components/ui/toast';

export default function RootChrome({
  children, posthogKey, posthogHost,
}: { children: React.ReactNode; posthogKey?: string; posthogHost?: string }) {
  const pathname = usePathname() ?? '';
  if (pathname.startsWith('/showcase')) {
    // Standalone microsite feel: no Booka analytics/consent chrome.
    return <>{children}</>;
  }
  return (
    <AnalyticsProvider posthogKey={posthogKey} posthogHost={posthogHost}>
      <AuthHashRedirect />
      <ToastContainer />
      {children}
      <ConsentBanner />
    </AnalyticsProvider>
  );
}
```

- [ ] **Step 4: Modify `src/app/layout.tsx`** — replace the body inner block (lines ~39-47) with the gate. New body:

```tsx
      <body className="brand-theme antialiased">
        <RootChrome posthogKey={posthogKey} posthogHost={posthogHost}>
          {children}
        </RootChrome>
      </body>
```
Add `import RootChrome from '@/components/system/RootChrome';` and remove the now-unused direct imports of `AnalyticsProvider`, `ConsentBanner`, `AuthHashRedirect`, `ToastContainer` from `layout.tsx`.

- [ ] **Step 5: Run test + typecheck**

Run: `npm test -- src/components/system/RootChrome.test.tsx && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 6: Create the showcase layout + index page**

```tsx
// src/app/(showcase)/layout.tsx
import type { Metadata } from 'next';
export const metadata: Metadata = { title: { default: 'TechClave — Capability Showcase', template: '%s — TechClave Showcase' } };
export default function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  // Neutral base wrapper; each demonstrator sets its own data-theme below this.
  return <div className="showcase-root min-h-screen">{children}</div>;
}
```
```tsx
// src/app/(showcase)/showcase/page.tsx
import Link from 'next/link';
export const metadata = { title: 'Capability Showcase' };
export default function ShowcaseIndex() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-semibold">TechClave Capability Showcase</h1>
      <p className="mt-4 text-neutral-600">Industry capability demonstrators built to show design, development, and conversion-system capabilities.</p>
      <Link href="/showcase/work" className="mt-8 inline-block underline">See all demonstrators →</Link>
    </main>
  );
}
```

- [ ] **Step 7: Verify routes + Booka `/` unchanged**

Run: `npm run dev`, visit `/showcase` (renders, no consent banner) and `/` (Booka landing still shows consent banner/analytics). Confirm no console errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/system/RootChrome.tsx src/components/system/RootChrome.test.tsx src/app/layout.tsx "src/app/(showcase)"
git commit -m "feat(showcase): chrome-gated /showcase route group skeleton"
```

---

## Task 2: Scoped design system (tokens + SiteTheme + themeVars + SunGrid theme)

**Files:** Create `src/showcase/design-system/{tokens.ts, themes.ts, themeVars.ts}`; add scoped CSS in `src/app/(showcase)/showcase.css` imported by the showcase layout; Test `src/showcase/design-system/themeVars.test.ts`.

**Interfaces:**
- Produces: `type SiteTheme` (per spec §C); `themeVars(theme: SiteTheme): React.CSSProperties` mapping theme colors/typography to `--sc-*` CSS custom properties; `SUNGRID_THEME: SiteTheme`.

- [ ] **Step 1: Write failing test**

```ts
// src/showcase/design-system/themeVars.test.ts
import { describe, it, expect } from '@jest/globals';
import { themeVars } from './themeVars';
import { SUNGRID_THEME } from './themes';

describe('themeVars', () => {
  it('maps a SiteTheme to --sc-* custom properties', () => {
    const v = themeVars(SUNGRID_THEME) as Record<string, string>;
    expect(v['--sc-primary']).toBe(SUNGRID_THEME.colors.primary);
    expect(v['--sc-background']).toBe(SUNGRID_THEME.colors.background);
    expect(v['--sc-font-display']).toContain(SUNGRID_THEME.typography.display);
  });
});
```

- [ ] **Step 2: Run (FAIL), then implement**

```ts
// src/showcase/design-system/tokens.ts
export type SiteTheme = {
  id: string;
  colors: { background: string; foreground: string; muted: string; surface: string; primary: string; primaryForeground: string; accent: string; border: string };
  typography: { display: string; body: string; mono?: string };
  radius: 'none' | 'small' | 'medium' | 'large';
  density: 'compact' | 'balanced' | 'spacious';
  motion: 'minimal' | 'subtle' | 'expressive';
};
```
```ts
// src/showcase/design-system/themes.ts
import type { SiteTheme } from './tokens';
export const SUNGRID_THEME: SiteTheme = {
  id: 'sungrid',
  colors: { background: '#0b1f2a', foreground: '#eef6f8', muted: '#8fb0bd', surface: '#12303e', primary: '#f5a623', primaryForeground: '#0b1f2a', accent: '#2ec4b6', border: '#1d475a' },
  typography: { display: 'Space Grotesk', body: 'Inter' },
  radius: 'medium', density: 'balanced', motion: 'subtle',
};
```
```ts
// src/showcase/design-system/themeVars.ts
import type { SiteTheme } from './tokens';
export function themeVars(t: SiteTheme): React.CSSProperties {
  return {
    ['--sc-background' as string]: t.colors.background,
    ['--sc-foreground' as string]: t.colors.foreground,
    ['--sc-muted' as string]: t.colors.muted,
    ['--sc-surface' as string]: t.colors.surface,
    ['--sc-primary' as string]: t.colors.primary,
    ['--sc-primary-fg' as string]: t.colors.primaryForeground,
    ['--sc-accent' as string]: t.colors.accent,
    ['--sc-border' as string]: t.colors.border,
    ['--sc-font-display' as string]: `'${t.typography.display}', system-ui, sans-serif`,
    ['--sc-font-body' as string]: `'${t.typography.body}', system-ui, sans-serif`,
  };
}
```
```css
/* src/app/(showcase)/showcase.css — utility classes bound to --sc-* vars (scoped, never touches brand-theme) */
.sc-bg { background: var(--sc-background); color: var(--sc-foreground); }
.sc-surface { background: var(--sc-surface); }
.sc-primary { background: var(--sc-primary); color: var(--sc-primary-fg); }
.sc-display { font-family: var(--sc-font-display); }
.sc-body { font-family: var(--sc-font-body); }
@media (prefers-reduced-motion: reduce) { .sc-root * { animation: none !important; transition: none !important; } }
```
Import `./showcase.css` in `(showcase)/layout.tsx`.

- [ ] **Step 3: Run test PASS; typecheck. Commit** `feat(showcase): scoped CSS-var design system + SunGrid theme`.

---

## Task 3: Canonical schemas + disclosure + content scaffolding

**Files:** Create `src/showcase/content/{types.ts, disclosure.ts, techclave.ts, demonstrators/index.ts, demonstrators/sungrid-energy.ts}`; Test `src/showcase/content/content.test.ts`.

**Interfaces:**
- Produces: `type Demonstrator`, `type CaseStudy` (per spec §B/§D); `DISCLOSURE` string; `DEMONSTRATORS: Demonstrator[]` (SunGrid populated + 7 `status:'planned'` stubs); `SUNGRID: Demonstrator`.

- [ ] **Step 1: Write failing test**

```ts
// src/showcase/content/content.test.ts
import { describe, it, expect } from '@jest/globals';
import { DEMONSTRATORS } from './demonstrators';
import { DISCLOSURE } from './disclosure';

describe('demonstrator content', () => {
  it('lists exactly 8 demonstrators, all labeled Capability Demonstrator', () => {
    expect(DEMONSTRATORS).toHaveLength(8);
    for (const d of DEMONSTRATORS) expect(d.projectType).toBe('Capability Demonstrator');
  });
  it('has SunGrid published and the rest planned', () => {
    const sg = DEMONSTRATORS.find((d) => d.slug === 'sungrid-energy')!;
    expect(sg.status).toBe('published');
    expect(DEMONSTRATORS.filter((d) => d.status === 'planned')).toHaveLength(7);
  });
  it('carries the required disclosure text', () => {
    expect(DISCLOSURE).toMatch(/capability demonstrator/i);
    expect(DISCLOSURE).toMatch(/not presented as commissioned client work/i);
  });
});
```

- [ ] **Step 2: Run (FAIL), then implement** `types.ts` (copy `Demonstrator`/`CaseStudy`/`SiteTheme` from spec §B/§C/§D), `disclosure.ts`:

```ts
// src/showcase/content/disclosure.ts
export const DISCLOSURE = 'This is a TechClave capability demonstrator created to show design, development, and conversion-system capabilities. It is not presented as commissioned client work.';
```
`demonstrators/sungrid-energy.ts` (full `Demonstrator` record: slug, name, industry 'Solar installation', `projectType:'Capability Demonstrator'`, oneLineSummary, businessProblem, targetAudience, `designedOutcome` (labeled), capabilitiesShown, pages, features, stack, visualDirection, `themeId:'sungrid'`, disclaimer=DISCLOSURE, `status:'published'`), and `demonstrators/index.ts` exporting `DEMONSTRATORS` = [SunGrid + 7 planned stubs: ember-table, northstar-clinic, meridian-legal, forge-build, haven-realty, crestfield-academy, atelier-soso — each minimal with `status:'planned'`].

- [ ] **Step 3: PASS + typecheck. Commit** `feat(showcase): canonical schemas + disclosure + demonstrator registry`.

---

## Task 4: Illustrative savings estimator (pure)

**Files:** Create `src/showcase/lib/estimator.ts`; Test `src/showcase/lib/estimator.test.ts`.

**Interfaces:** `estimateSolarSavings(input: { monthlyBillNaira: number; propertyType: 'residential'|'commercial' }): { systemSizeKw: number; estimatedMonthlySavingsNaira: number; paybackYears: number; assumptions: string[] }` — deterministic, fixed labeled assumptions; **illustrative only**.

- [ ] **Step 1: Write failing test**

```ts
// src/showcase/lib/estimator.test.ts
import { describe, it, expect } from '@jest/globals';
import { estimateSolarSavings } from './estimator';

describe('estimateSolarSavings', () => {
  it('produces deterministic illustrative figures with stated assumptions', () => {
    const r = estimateSolarSavings({ monthlyBillNaira: 100000, propertyType: 'residential' });
    expect(r.systemSizeKw).toBeGreaterThan(0);
    expect(r.estimatedMonthlySavingsNaira).toBeGreaterThan(0);
    expect(r.estimatedMonthlySavingsNaira).toBeLessThanOrEqual(100000);
    expect(r.paybackYears).toBeGreaterThan(0);
    expect(r.assumptions.join(' ')).toMatch(/illustrative/i);
  });
});
```

- [ ] **Step 2: Run (FAIL), implement** with explicit constants (e.g. offset ratio 0.7 residential / 0.6 commercial, ₦per-kW install cost, kWh/kW/day) and an `assumptions` array beginning "Illustrative estimate — …". Run PASS.
- [ ] **Step 3: Commit** `feat(showcase): illustrative solar savings estimator`.

---

## Task 5: Capability primitives + demo shell + mock lead form

**Files:** Create under `src/components/capability/`: `core/{Button,Container,Section,Heading,Text,Card}.tsx`, `content/Disclaimer.tsx`, `layout/{DemoHeader,DemoFooter}.tsx`, `conversion/{Hero,CTASection,FAQ,ProcessSteps}.tsx`, `forms/LeadForm.tsx`; Tests for `LeadForm` and `Disclaimer`.

**Interfaces:**
- `LeadForm({ fields, onMockSubmit? })` — labeled inputs, required indicators, inline validation, disabled while submitting, success + error states, privacy note; **local mock submit** (no network). Produces a success message on valid submit.
- `Disclaimer()` — renders `DISCLOSURE`.

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/capability/forms/LeadForm.test.tsx
import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeadForm } from './LeadForm';

describe('LeadForm', () => {
  it('shows a validation error on empty required submit and no success', async () => {
    render(<LeadForm fields={[{ name: 'name', label: 'Name', required: true }]} submitLabel="Request assessment" />);
    await userEvent.click(screen.getByRole('button', { name: /request assessment/i }));
    expect(screen.getByText(/required/i)).toBeTruthy();
    expect(screen.queryByText(/thank you/i)).toBeNull();
  });
  it('shows success on valid local mock submit (no network)', async () => {
    render(<LeadForm fields={[{ name: 'name', label: 'Name', required: true }]} submitLabel="Request assessment" />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.click(screen.getByRole('button', { name: /request assessment/i }));
    expect(await screen.findByText(/thank you/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run (FAIL), implement** the primitives (using `sc-*` classes + Tailwind) and `LeadForm` (client component; `useState` for values/errors/status; validate required; on success set status='success' and render "Thank you — this is a demonstrator; no message was sent."). `Disclaimer` renders `DISCLOSURE` in a muted footer note.
- [ ] **Step 3: PASS + typecheck. Commit** `feat(showcase): capability primitives, demo shell, mock lead form`.

---

## Task 6: SunGrid demonstrator pages

**Files:** Create `src/app/(showcase)/showcase/demos/sungrid-energy/layout.tsx` + `page.tsx` + `{solutions,savings,projects,process,contact}/page.tsx`.

**Interfaces:** Consumes Task 2 (`SUNGRID_THEME`, `themeVars`), Task 3 (`SUNGRID`, `DISCLOSURE`), Task 4 (`estimateSolarSavings`), Task 5 (components).

- [ ] **Step 1: Demo layout applies the theme + disclosure**

```tsx
// src/app/(showcase)/showcase/demos/sungrid-energy/layout.tsx
import { SUNGRID_THEME } from '@/showcase/design-system/themes';
import { themeVars } from '@/showcase/design-system/themeVars';
import { DemoHeader } from '@/components/capability/layout/DemoHeader';
import { DemoFooter } from '@/components/capability/layout/DemoFooter';
import { Disclaimer } from '@/components/capability/content/Disclaimer';
const NAV = [['Home','/showcase/demos/sungrid-energy'],['Solutions','/showcase/demos/sungrid-energy/solutions'],['Savings','/showcase/demos/sungrid-energy/savings'],['Projects','/showcase/demos/sungrid-energy/projects'],['Process','/showcase/demos/sungrid-energy/process'],['Contact','/showcase/demos/sungrid-energy/contact']];
export default function SunGridLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sc-root sc-bg sc-body min-h-screen" data-theme="sungrid" style={themeVars(SUNGRID_THEME)}>
      <DemoHeader brand="SunGrid Energy" nav={NAV} />
      {children}
      <Disclaimer />
      <DemoFooter brand="SunGrid Energy" />
    </div>
  );
}
```

- [ ] **Step 2: Build each page** with `export const metadata` (unique title/description per route), semantic sections, and the required content: Home (Hero + residential/commercial paths + trust/process teaser + CTA), Solutions, Savings (embeds a client estimator widget calling `estimateSolarSavings`, clearly labeled "Illustrative"), Projects (gallery — **source royalty-free web images** (Unsplash/Pexels license) and **download** them into `public/images/sungrid-energy/`; never hotlink), Process (ProcessSteps timeline), Contact (LeadForm site-assessment fields — name/phone/address/property type/monthly bill; local mock). Each page uses only `sc-*`/Tailwind + capability components.
- [ ] **Step 3: Verify** `npm run dev` → walk all 6 routes at 390/768/1280/1440 widths: no overflow, no clipped text, no broken images, theme applied, disclosure present, estimator labeled illustrative, form shows success locally.
- [ ] **Step 4: typecheck + lint. Commit** `feat(showcase): complete SunGrid Energy demonstrator (6 pages)`.

---

## Task 7: `/showcase/work` grid + `/showcase` index polish

**Files:** Modify `src/app/(showcase)/showcase/work/page.tsx` (create), reuse `DEMONSTRATORS`.

- [ ] **Step 1: Write a content test** asserting the grid data source lists all 8 with visible status labels (unit test on a small `demoCards(DEMONSTRATORS)` helper if extracted, else covered by Task 3 test — skip if redundant).
- [ ] **Step 2: Implement** the grid: map `DEMONSTRATORS` → cards showing name, industry, **project-type label ("Capability Demonstrator")**, and status badge (`published` links to the SunGrid demo; `planned` shows "Coming soon", non-linked). Responsive grid.
- [ ] **Step 3: Verify + typecheck. Commit** `feat(showcase): work grid listing all 8 demonstrators with status`.

---

## Task 8: SunGrid case study + capability-deck shell

**Files:** Create `src/showcase/content/case-studies/sungrid-energy.ts`, `src/app/(showcase)/showcase/case-studies/[slug]/page.tsx`, `src/app/(showcase)/showcase/capability-deck/page.tsx`; Test `src/showcase/content/case-studies/sungrid-energy.test.ts`.

**Interfaces:** `SUNGRID_CASE_STUDY: CaseStudy` (per spec §D, `projectType:'Capability Demonstrator'`, disclosure set, `outcomes.designedImpact` labeled, `outcomes.limitations` populated, NO `measuredScores`).

- [ ] **Step 1: Write failing test** asserting the case study has the disclosure, `projectType==='Capability Demonstrator'`, non-empty `outcomes.designedImpact` and `outcomes.limitations`, and no fabricated `measuredScores`.
- [ ] **Step 2: Run (FAIL), implement** the record + the `[slug]` website renderer page (executive summary, disclosure, problem, strategy, solution, delivery, quality, delivered result, **designed** impact, limitations, demo/repo links) resolving the slug from a small `CASE_STUDIES` map. Add the capability-deck shell page (16:9 cover slide + section scaffold, `@media print` page CSS, no full content).
- [ ] **Step 3: Verify** `/showcase/case-studies/sungrid-energy` and `/showcase/capability-deck` render; PASS + typecheck. **Commit** `feat(showcase): SunGrid case study renderer + capability-deck shell`.

---

## Task 9: QA sweep, isolation guard, docs, build

- [ ] **Step 1: Isolation check** — Run `grep -rnE "@/lib/supabase|@/lib/reservationService|from '@/lib/booking'" src/app/\(showcase\) src/showcase src/components/capability` → expect **no matches**. If any, refactor them out.
- [ ] **Step 2:** Add `docs/DECISIONS.md` (chrome-gate approach, `/showcase` namespace, SunGrid first, scoped CSS-var theming) and `docs/OPEN_ISSUES.md` (deferred: 7 demos, Playwright screenshots, export renderers).
- [ ] **Step 3: Full sweep** — `npm test -- src/showcase src/components/capability src/components/system && npm run typecheck && npm run lint && npm run build`. Fix all failures.
- [ ] **Step 4: Manual gate** — Booka `/` unchanged (consent banner + analytics present); `/showcase/*` isolated (no Booka chrome); all SunGrid routes truthful, responsive, disclosure present. **Commit** `chore(showcase): session-1 QA, isolation guard, docs`.

---

## Self-Review

**Spec coverage:** §2 truthfulness → Global Constraints + Tasks 3/6/8; §4 decisions → Tasks 1–2; §5 structure → all tasks; §5.1 chrome-gate → Task 1; §5.2 middleware/CSP → verified public-by-default (Task 1 Step 7 confirms; no middleware edit needed — noted); §6 schemas → Task 3; §7 SunGrid → Tasks 4–6; §8 case study + deck → Task 8; §9 testing → each task + Task 9; §11 gate → Task 9 Step 4.
**Placeholder scan:** No TBD/"handle edge cases"; content records (SunGrid demonstrator/case-study copy) are written as real prose by the implementer per the field lists — flagged as authored content, not code placeholders. Project-gallery images are added to `public/images` (never hotlinked, per constraint).
**Type consistency:** `SiteTheme`/`themeVars`/`SUNGRID_THEME` (T2) consumed in T6; `Demonstrator`/`CaseStudy`/`DISCLOSURE`/`DEMONSTRATORS`/`SUNGRID` (T3) consumed in T6/T7/T8; `estimateSolarSavings` (T4) consumed in T6; `LeadForm`/`Disclaimer` (T5) consumed in T6/T8. Names stable.
**Only Booka file touched:** `src/app/layout.tsx` (Task 1) — behavior-identical off `/showcase`, guarded by the RootChrome test.
