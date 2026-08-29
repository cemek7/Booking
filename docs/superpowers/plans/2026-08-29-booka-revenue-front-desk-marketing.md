# Booka Revenue Front Desk Marketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Booka's unsupported proof and booking-software language with the approved cross-vertical, beauty-led AI Revenue Front Desk positioning, offer, channel boundaries, and pricing.

**Architecture:** Keep reusable commercial definitions in `src/lib/sias.ts`, while the public presentation stays in the existing `BookaLanding` and `DemoConversation` components. Add focused rendering tests that pin the approved headline, CTA, prices, channel caveats, and absence of unsupported numerical claims.

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
- Test: `src/__tests__/lib/sias-marketing.test.ts`

**Interfaces:**
- Consumes: Existing `SIAS_VERTICAL_PACKAGES`, `SIAS_BILLING_PLANS`, and `SIAS_OUTCOME_ATRIBUTION` exports.
- Produces: `BOOKA_POSITIONING`, updated plan records, and truthful vertical descriptions consumed by the landing page.

- [ ] **Step 1: Write the failing commercial-definition test**

```ts
import {
  BOOKA_POSITIONING,
  SIAS_BILLING_PLANS,
  SIAS_VERTICAL_PACKAGES,
} from '@/lib/sias';

describe('Booka marketing definitions', () => {
  it('uses the approved revenue-front-desk promise', () => {
    expect(BOOKA_POSITIONING).toEqual({
      category: 'AI Revenue Front Desk',
      headline: 'Turn your WhatsApp and Instagram enquiries into booked and paying customers.',
      campaignLine: 'Turn conversations into customers.',
    });
  });

  it('keeps the approved launch prices and fair-use language', () => {
    expect(SIAS_BILLING_PLANS.map(({ id, price }) => ({ id, price }))).toEqual([
      { id: 'core', price: '₦15k/mo' },
      { id: 'front-desk', price: '₦45k/mo' },
      { id: 'growth-ops', price: '₦85k/mo' },
      { id: 'managed-ops', price: '₦250k+' },
    ]);
    expect(SIAS_BILLING_PLANS.every((plan) => plan.usagePolicy.length > 0)).toBe(true);
  });

  it('keeps beauty first without removing other verticals', () => {
    expect(SIAS_VERTICAL_PACKAGES.map((item) => item.id)).toEqual([
      'beauty',
      'hospitality',
      'medicine',
    ]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/__tests__/lib/sias-marketing.test.ts -i`
Expected: FAIL because `BOOKA_POSITIONING` and `usagePolicy` do not exist and managed pricing is `₦250k+` without the approved description.

- [ ] **Step 3: Add the approved definitions**

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

- [ ] **Step 4: Run the focused test**

Run: `npx jest src/__tests__/lib/sias-marketing.test.ts -i`
Expected: PASS.

- [ ] **Step 5: Commit the commercial definitions**

```bash
git add src/lib/sias.ts src/__tests__/lib/sias-marketing.test.ts
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

- [ ] **Step 1: Write the failing rendering test**

```tsx
import { render, screen } from '@testing-library/react';
import BookaLanding from '@/components/homepage/BookaLanding';

jest.mock('@/components/brand/BrandMark', () => ({
  __esModule: true,
  default: () => <div data-testid="brand-mark" />,
}));

describe('BookaLanding', () => {
  it('renders the approved promise and CTAs', () => {
    render(<BookaLanding />);
    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Turn your WhatsApp and Instagram enquiries into booked and paying customers.',
    })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Apply for the 14-Day Revenue Pilot' })[0])
      .toHaveAttribute('href', '#revenue-pilot');
    expect(screen.getByRole('link', { name: 'Get a Missed Revenue Report' }))
      .toHaveAttribute('href', '#missed-revenue-report');
  });

  it('uses capability proof and removes unsupported numerical proof', () => {
    render(<BookaLanding />);
    expect(screen.getByText('Automated enquiry handling')).toBeInTheDocument();
    expect(screen.getByText('Booking and selling in one conversation')).toBeInTheDocument();
    expect(screen.getByText('Human takeover when needed')).toBeInTheDocument();
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
    expect(screen.queryByText('₦3.6m')).not.toBeInTheDocument();
  });

  it('states the channel and clinic boundaries', () => {
    render(<BookaLanding />);
    expect(screen.getByText(/Instagram captures and converts active enquiries/i)).toBeInTheDocument();
    expect(screen.getByText(/WhatsApp carries reminders, recovery and repeat-business conversations/i)).toBeInTheDocument();
    expect(screen.getByText(/non-clinical guidance/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: FAIL on the old headline, old CTA, and unsupported proof.

- [ ] **Step 3: Implement the approved landing-page hierarchy**

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
- include the channel-boundary sentences asserted by the test;
- change medicine copy to `non-clinical guidance, appointment routing, reminders and human escalation`;
- add `id="revenue-pilot"` and the complete approved pilot offer, eligibility summary, and success definition;
- add `id="missed-revenue-report"` with the audit description, opportunity-range disclaimer, and CTA linking back to `#revenue-pilot` until Plan 2 ships;
- render each plan's `usagePolicy` beneath its included items;
- state that overages are transparent and opt-in, without publishing message counts.

In `DemoConversation.tsx`, make beauty the default scenario. The conversation must demonstrate: price question → recommendation → alternative availability → deposit/booking next step. Remove any fixed recovered-revenue or no-show performance claim from its reporting panel.

- [ ] **Step 4: Run the component test**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: PASS.

- [ ] **Step 5: Run a focused unsupported-claim scan**

Run: `rg -n "40%|₦3\.6m|AI booking software|guaranteed revenue" src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx`
Expected: no output.

- [ ] **Step 6: Commit the landing-page change**

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
- Test: `src/__tests__/app/booka-marketing-copy.test.ts`

**Interfaces:**
- Consumes: `BOOKA_POSITIONING` from Task 1.
- Produces: Consistent discoverability copy without new claims on adjacent Techclave surfaces.

- [ ] **Step 1: Write the failing metadata and source-copy test**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { metadata as bookaMetadata } from '@/app/booka/page';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Booka marketing copy consistency', () => {
  it('uses revenue-front-desk metadata', () => {
    expect(bookaMetadata.title).toBe('Booka | AI Revenue Front Desk');
    expect(bookaMetadata.description).toContain('booked and paying customers');
  });

  it('contains no unsupported proof on public Booka surfaces', () => {
    const source = [
      read('src/app/page.tsx'),
      read('src/app/products/page.tsx'),
      read('src/app/booka/page.tsx'),
      read('src/components/homepage/BookaLanding.tsx'),
      read('src/components/homepage/DemoConversation.tsx'),
    ].join('\n');
    expect(source).not.toMatch(/40%|₦3\.6m|guaranteed revenue/i);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/__tests__/app/booka-marketing-copy.test.ts -i`
Expected: FAIL because the current metadata says `AI Front Desk for Service Businesses`.

- [ ] **Step 3: Align adjacent copy**

Use `Booka | AI Revenue Front Desk` as the Booka page title and this description:

```text
Booka turns WhatsApp and Instagram enquiries into booked and paying customers with recommendations, booking, payment links, follow-up and human escalation.
```

On the Techclave homepage and products page, describe Booka as an AI Revenue Front Desk. Preserve the channel boundary: Instagram for active enquiry conversion, WhatsApp for the broader customer lifecycle. Do not add outcome numbers.

- [ ] **Step 4: Run the focused tests and lint**

Run: `npx jest src/__tests__/lib/sias-marketing.test.ts src/components/homepage/BookaLanding.test.tsx src/__tests__/app/booka-marketing-copy.test.ts -i`
Expected: PASS.

Run: `npx eslint src/lib/sias.ts src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx`
Expected: exit 0.

- [ ] **Step 5: Commit the metadata alignment**

```bash
git add src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx src/__tests__/app/booka-marketing-copy.test.ts
git commit -m "fix(marketing): align Booka revenue front desk copy"
```

### Task 4: Final Marketing Verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: A verified, independently deployable marketing release.

- [ ] **Step 1: Run the marketing tests**

Run: `npx jest src/__tests__/lib/sias-marketing.test.ts src/components/homepage/BookaLanding.test.tsx src/__tests__/app/booka-marketing-copy.test.ts -i`
Expected: all suites pass.

- [ ] **Step 2: Run TypeScript validation for the touched surface**

Run: `npx tsc --noEmit`
Expected: exit 0. If unrelated existing errors prevent a clean run, capture the full output and prove no diagnostic references the files in this plan.

- [ ] **Step 3: Run formatting and claim checks**

Run: `git diff --check`
Expected: no output.

Run: `rg -n "40%|₦3\.6m|AI booking software|guaranteed revenue|unlimited messaging" src/app/booka src/components/homepage src/app/products/page.tsx src/app/page.tsx`
Expected: no output.

- [ ] **Step 4: Review the page at mobile and desktop widths**

Run: `npm run dev`
Expected: the Booka page loads at `/booka`; hero, eight-step sequence, vertical cards, pilot, audit, pricing, and FAQ are readable at 390px and 1440px without horizontal overflow.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required a correction, stage only the files from this plan and commit:

```bash
git add src/lib/sias.ts src/components/homepage/BookaLanding.tsx src/components/homepage/DemoConversation.tsx src/app/booka/page.tsx src/app/layout.tsx src/app/products/page.tsx src/app/page.tsx src/__tests__/lib/sias-marketing.test.ts src/components/homepage/BookaLanding.test.tsx src/__tests__/app/booka-marketing-copy.test.ts
git commit -m "fix(marketing): finish Booka revenue positioning"
```
