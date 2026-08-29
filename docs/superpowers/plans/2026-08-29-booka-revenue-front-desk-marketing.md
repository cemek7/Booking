# Booka Revenue Front Desk Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Booka's unsupported proof and booking-software language with the approved cross-vertical, beauty-led AI Revenue Front Desk positioning, offer, channel boundaries, and pricing.

**Architecture:** Keep reusable commercial definitions in `src/lib/sias.ts`, while the public presentation stays in the existing `BookaLanding` and `DemoConversation` components. Automated tests cover stable behavior and structure: usable CTA destinations, the beauty-first default, complete pricing-card rendering, and fair-use disclosure. Human review and a focused claim scan validate prose without freezing marketing sentences in brittle tests.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Jest 30, React Testing Library

**Spec:** `docs/superpowers/specs/2026-08-29-booka-revenue-front-desk-positioning-design.md`

## Global Constraints

- Booka remains cross-vertical; beauty is the first and default demonstration.
- Use **AI Revenue Front Desk** as the category and **Turn conversations into customers** as the campaign line.
- The primary promise must include both bookings and paying customers.
- Do not publish unverified numerical outcome claims, including `40%` or `₦3.6m`.
- Describe Instagram as enquiry capture and in-window conversion; WhatsApp carries proactive lifecycle messaging.
- Say Booka **helps collect payment**; do not imply Booka holds merchant customer funds.
- Clinic copy must stay non-clinical and explicitly preserve human escalation.
- Show all-inclusive fair-use pricing without publishing guessed numerical allowances.
- Keep the unrelated untracked `Booking/` directory untouched.

---

### Task 1: Lock the Approved Commercial Definitions

**Files:**
- Modify: `src/lib/sias.ts`
- Test through consumer: `src/components/homepage/BookaLanding.test.tsx` in Task 2

**Interfaces:**
- Consumes: Existing `SIAS_VERTICAL_PACKAGES`, `SIAS_BILLING_PLANS`, and `SIAS_OUTCOME_ATRIBUTION` exports.
- Produces: `BOOKA_POSITIONING`, updated plan records, and truthful vertical descriptions consumed by the landing page.

- [x] **Step 1: Add the approved definitions**

Add to `src/lib/sias.ts`:

```ts
export const BOOKA_POSITIONING = {
  category: 'AI Revenue Front Desk',
  headline: 'Turn your WhatsApp and Instagram enquiries into booked and paying customers.',
  campaignLine: 'Turn conversations into customers.',
} as const;
```

Extend every `SIAS_BILLING_PLANS` entry with `usagePolicy: string`. Use these exact values:

```ts
// core
usagePolicy: 'Includes a limited automation allowance with usage alerts before any overage.'

// front-desk
usagePolicy: 'Includes standard AI and messaging usage with transparent, opt-in overages.'

// growth-ops
usagePolicy: 'Includes higher AI, follow-up, and campaign usage with approval for large sends.'

// managed-ops
usagePolicy: 'Custom usage, service levels, and campaign controls are agreed before launch.'
```

Update plan display names to `Booka Core`, `Booka Revenue Front Desk`, `Booka Growth`, and `Managed Revenue Operations`. Preserve IDs so existing consumers do not break.

- [x] **Step 2: Confirm the existing SIAS consumers still type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, or no diagnostic references `src/lib/sias.ts` if the repository has unrelated baseline diagnostics. Consumer behavior is exercised test-first in Task 2.

- [x] **Step 3: Commit the commercial definitions**

```bash
git add src/lib/sias.ts
git commit -m "feat(marketing): define Booka revenue front desk offer"
```

### Task 2: Replace the Landing Page Message and Proof

**Files:**
- Modify: `src/components/homepage/BookaLanding.tsx`
- Modify: `src/components/homepage/DemoConversation.tsx`
- Test: `src/components/homepage/BookaLanding.test.tsx`

**Interfaces:**
- Consumes: `BOOKA_POSITIONING`, `SIAS_BILLING_PLANS`, and `SIAS_VERTICAL_PACKAGES` from Task 1.
- Produces: A public landing page with working in-page pilot and audit CTAs. Plan 2 later replaces the in-page CTA targets with dedicated intake pages.

- [x] **Step 1: Write the failing rendering test**

```tsx
import { render, screen } from '@testing-library/react';
import BookaLanding from '@/components/homepage/BookaLanding';

jest.mock('@/components/brand/BrandMark', () => ({
  __esModule: true,
  default: () => <div data-testid="brand-mark" />,
}));

describe('BookaLanding', () => {
  it('offers working pilot and missed-revenue conversion paths', () => {
    render(<BookaLanding />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /revenue pilot/i })[0])
      .toHaveAttribute('href', '#revenue-pilot');
    expect(screen.getByRole('link', { name: /missed revenue report/i }))
      .toHaveAttribute('href', '#missed-revenue-report');
    expect(document.querySelector('#revenue-pilot')).toBeInTheDocument();
    expect(document.querySelector('#missed-revenue-report')).toBeInTheDocument();
  });

  it('renders four priced plans with a visible usage policy', () => {
    render(<BookaLanding />);
    expect(screen.getAllByTestId('pricing-plan')).toHaveLength(4);
    expect(screen.getAllByTestId('usage-policy')).toHaveLength(4);
  });

  it('defaults the cross-vertical demonstration to beauty', () => {
    render(<BookaLanding />);
    expect(screen.getByTestId('vertical-demo')).toHaveAttribute('data-default-vertical', 'beauty');
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: FAIL because the conversion anchors, pricing test hooks, and explicit beauty default are not present.

- [x] **Step 3: Implement the approved landing-page hierarchy**

In `BookaLanding.tsx`:

- import `BOOKA_POSITIONING`;
- replace the eyebrow with `BOOKA_POSITIONING.category`;
- use `BOOKA_POSITIONING.headline` for the H1;
- use this body exactly:

```text
Booka answers customer questions, recommends the right service or product, checks availability, follows up, books customers and helps collect payment—while your team steps in when human judgement is needed.
```

- replace the primary CTA with `Apply for the 14-Day Revenue Pilot` → `#revenue-pilot`;
- replace the pricing CTA beside it with `Get a Missed Revenue Report` → `#missed-revenue-report`;
- replace the three unsupported metric cards with the three capability-proof strings asserted above;
- add an eight-step strip using `Answer`, `Recommend`, `Sell`, `Book`, `Pay`, `Follow up`, `Retain`, `Report`;
- reorganize the benefit section under `Capture`, `Convert`, `Recover`, and `Grow`;
- preserve beauty first in `verticals`, then clinics and hospitality;
- include the approved channel-boundary explanation;
- change medicine copy to `non-clinical guidance, appointment routing, reminders and human escalation`;
- add `id="revenue-pilot"` and the complete approved pilot offer, eligibility summary, and success definition;
- add `id="missed-revenue-report"` with the audit description, opportunity-range disclaimer, and CTA linking back to `#revenue-pilot` until Plan 2 ships;
- render each plan in a `data-testid="pricing-plan"` element and its `usagePolicy` in a `data-testid="usage-policy"` element beneath its included items;
- state that overages are transparent and opt-in, without publishing message counts.

In `DemoConversation.tsx`, expose `data-testid="vertical-demo"` and `data-default-vertical="beauty"`, and make beauty the default scenario. The conversation must demonstrate: price question → recommendation → alternative availability → deposit/booking next step. Remove any fixed recovered-revenue or no-show performance claim from its reporting panel.

- [x] **Step 4: Run the component test**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: PASS.

- [x] **Step 5: Run a focused unsupported-claim scan**

Run: `rg -n "40%|₦3\.6m|AI booking software|guaranteed revenue" src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx`
Expected: no output.

- [x] **Step 6: Commit the landing-page change**

```bash
git add src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx src/components/homepage/BookaLanding.test.tsx
git commit -m "feat(marketing): launch Booka revenue front desk positioning"
```

### Task 3: Align Metadata and Adjacent Product Copy

**Files:**
- Modify: `src/app/booka/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/products/page.tsx`
- Modify: `src/app/page.tsx`
- Verification: rendered review plus focused claim scan

**Interfaces:**
- Consumes: `BOOKA_POSITIONING` from Task 1.
- Produces: Consistent discoverability copy without new claims on adjacent Techclave surfaces.

- [x] **Step 1: Align metadata and adjacent copy**

Use `Booka | AI Revenue Front Desk` as the Booka page title and this description:

```text
Booka turns WhatsApp and Instagram enquiries into booked and paying customers with recommendations, booking, payment links, follow-up and human escalation.
```

On the Techclave homepage and products page, describe Booka as an AI Revenue Front Desk. Preserve the channel boundary: Instagram for active enquiry conversion, WhatsApp for the broader customer lifecycle. Do not add outcome numbers.

- [x] **Step 2: Run the focused component test and lint**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: PASS.

Run: `npx eslint src/lib/sias.ts src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx`
Expected: exit 0.

- [x] **Step 3: Review rendered prose and run the unsupported-claim scan**

Review `/booka`, the Techclave homepage, and `/products` for category consistency, truthful channel boundaries, and the approved payment language.

Run: `rg -n "40%|₦3\.6m|AI booking software|guaranteed revenue|unlimited messaging" src/app/booka src/components/homepage src/app/products/page.tsx src/app/page.tsx`
Expected: no output.

- [x] **Step 4: Commit the metadata alignment**

```bash
git add src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx
git commit -m "fix(marketing): align Booka revenue front desk copy"
```

### Task 4: Final Marketing Verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: A verified, independently deployable marketing release.

- [x] **Step 1: Run the marketing tests**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: all suites pass.

- [x] **Step 2: Run TypeScript validation for the touched surface**

Run: `npx tsc --noEmit`
Expected: exit 0. If unrelated existing errors prevent a clean run, capture the full output and prove no diagnostic references the files in this plan.

Verification note (2026-08-29): the full check remains blocked by existing mock-typing errors in
`src/components/analytics/AnalyticsProvider.test.tsx` and
`src/components/analytics/PostHogIdentity.test.tsx`. After correcting the new test to use the
repository's explicit Jest-global import pattern, no diagnostic references a file changed by this plan.

- [x] **Step 3: Run formatting and claim checks**

Run: `git diff --check`
Expected: no output.

Run: `rg -n "40%|₦3\.6m|AI booking software|guaranteed revenue|unlimited messaging" src/app/booka src/components/homepage src/app/products/page.tsx src/app/page.tsx`
Expected: no output.

- [x] **Step 4: Review the page at mobile and desktop widths**

Run: `npm run dev`
Expected: the Booka page loads at `/booka`; hero, eight-step sequence, vertical cards, pilot, audit, pricing, and FAQ are readable at 390px and 1440px without horizontal overflow.

- [x] **Step 5: Commit any verification-only corrections**

If verification required a correction, stage only the files from this plan and commit:

```bash
git add src/lib/sias.ts src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx src/components/homepage/BookaLanding.test.tsx
git commit -m "fix(marketing): finish Booka revenue positioning"
```
