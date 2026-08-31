# Booka Revenue Attribution and Pilot Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce source-backed Booka pilot reports that distinguish processed, influenced, and recovered revenue and expose internal provider cost without inflating generated-revenue claims.

**Architecture:** Add explicit attribution and verification fields to the existing SIAS attribution records, preserve legacy `value` for compatibility, and aggregate verified commercial outcomes in a deterministic service. Tenant reports expose customer-outcome metrics; a separate superadmin endpoint exposes internal cost and gross contribution.

**Tech Stack:** Next.js 16, TypeScript, Supabase/PostgreSQL, Zod 4, Recharts 3, Jest 30, React Testing Library

**Spec:** `docs/superpowers/specs/2026-08-29-booka-revenue-front-desk-positioning-design.md`

## Global Constraints

- Keep processed, influenced, and recovered revenue separate; never sum them into generated revenue.
- Count money only when `amount_cents` and `currency` are explicit.
- Report verification status and data completeness.
- Do not backfill ambiguous legacy `value=1` records into money.
- Tenant reports never expose Booka's internal provider cost or margin.
- Internal unit economics are superadmin-only.
- Every money figure carries source, attribution type, period, currency, and verification state.
- Keep the unrelated untracked `Booking/` directory untouched.

---

### Task 1: Harden the Attribution Schema

**Files:**
- Create: `db/migrations/123_revenue_attribution_verification.sql`
- Create: `scripts/sql/test_revenue_attribution_baseline.sql`
- Create: `scripts/sql/verify_revenue_attribution_verification.sql`

**Interfaces:**
- Consumes: `public.sias_outcome_attributions` from migration 080.
- Produces: additive columns used by the attribution service and reports.

- [x] **Step 1: Write the disposable baseline and verification SQL**

Create `scripts/sql/test_revenue_attribution_baseline.sql` so migration 080 can run outside Supabase:

```sql
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table if not exists tenants (id uuid primary key);
create table if not exists customers (id uuid primary key);
create table if not exists reservations (id uuid primary key);
create table if not exists tenant_users (
  tenant_id uuid not null references tenants(id),
  user_id uuid,
  role text
);
```

The script must assert these columns exist: `attribution_type`, `verification_status`, `amount_cents`, `currency`, `evidence_type`, `verified_at`, `verified_by`, and `attribution_window_started_at`. It must also assert that no row has `amount_cents < 0`.

Use this failure block:

```sql
if missing_columns is not null then
  raise exception 'sias_outcome_attributions missing columns: %', missing_columns;
end if;

if exists (select 1 from sias_outcome_attributions where amount_cents < 0) then
  raise exception 'negative amount_cents found';
end if;
```

- [ ] **Step 2: Confirm verification fails in disposable PostgreSQL**

> Pending owner execution. Database and Docker commands were deliberately left to the owner on 2026-08-29.

Run:

```bash
docker run --rm -d --name booka-attribution-db -e POSTGRES_PASSWORD=booka -p 55433:5432 postgres:16-alpine
psql postgresql://postgres:booka@127.0.0.1:55433/postgres -f scripts/sql/test_revenue_attribution_baseline.sql
psql postgresql://postgres:booka@127.0.0.1:55433/postgres -f db/migrations/080_sias_operational_layer.sql
psql postgresql://postgres:booka@127.0.0.1:55433/postgres -f scripts/sql/verify_revenue_attribution_verification.sql
```

Expected: the first two commands exit 0; verification exits non-zero because the additive columns are absent.

- [x] **Step 3: Write the additive migration**

Add:

```sql
alter table public.sias_outcome_attributions
  add column if not exists attribution_type text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists amount_cents bigint,
  add column if not exists currency text,
  add column if not exists evidence_type text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid,
  add column if not exists attribution_window_started_at timestamptz;

alter table public.sias_outcome_attributions
  drop constraint if exists sias_outcome_attributions_type_check,
  drop constraint if exists sias_outcome_attributions_verification_check,
  drop constraint if exists sias_outcome_attributions_amount_check,
  drop constraint if exists sias_outcome_attributions_currency_check;

alter table public.sias_outcome_attributions
  add constraint sias_outcome_attributions_type_check
    check (attribution_type is null or attribution_type in ('processed', 'influenced', 'recovered')),
  add constraint sias_outcome_attributions_verification_check
    check (verification_status in ('unverified', 'merchant_confirmed', 'system_verified', 'rejected')),
  add constraint sias_outcome_attributions_amount_check
    check (amount_cents is null or amount_cents >= 0),
  add constraint sias_outcome_attributions_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$');

update public.sias_outcome_attributions
set attribution_type = case
  when signal = 'revenue_recovery' then 'recovered'
  when signal in ('upsell_conversion', 'repeat_booking_lift', 'reactivation_lift') then 'influenced'
  else null
end
where attribution_type is null;

create index if not exists idx_sias_attribution_tenant_type_verified
  on public.sias_outcome_attributions
  (tenant_id, attribution_type, verification_status, created_at desc);
```

Do not populate `amount_cents` from legacy `value`.

- [ ] **Step 4: Apply and verify the migration**

> Pending owner execution together with Step 2.

Run:

```bash
psql postgresql://postgres:booka@127.0.0.1:55433/postgres -f db/migrations/123_revenue_attribution_verification.sql
psql postgresql://postgres:booka@127.0.0.1:55433/postgres -f scripts/sql/verify_revenue_attribution_verification.sql
docker rm -f booka-attribution-db
```

Expected: migration and verification exit 0; the disposable container is removed.

- [x] **Step 5: Commit the schema**

```bash
git add db/migrations/123_revenue_attribution_verification.sql scripts/sql/test_revenue_attribution_baseline.sql scripts/sql/verify_revenue_attribution_verification.sql
git commit -m "feat(analytics): add verified revenue attribution fields"
```

### Task 2: Make Attribution Recording Explicit and Type-Safe

**Files:**
- Modify: `src/lib/sias-operations.ts`
- Modify: `src/lib/payments/lifecycle.ts`
- Test: `src/__tests__/lib/sias-operations.attribution.test.ts`

**Interfaces:**
- Consumes: Schema from Task 1.
- Produces: `RevenueAttributionType`, `RevenueVerificationStatus`, and an extended `recordOutcomeAttribution(input)` contract.

- [x] **Step 1: Write failing service tests**

Assert that:

```ts
await service.recordOutcomeAttribution({
  tenantId: 'tenant-1',
  signal: 'revenue_recovery',
  sourceEvent: 'cron.rebooking_nudge',
  attributionType: 'recovered',
  verificationStatus: 'system_verified',
  amountCents: 4500000,
  currency: 'NGN',
  evidenceType: 'payment_completed',
  attributionWindowStartedAt: '2026-08-01T00:00:00.000Z',
});
```

inserts snake_case values. Also assert negative `amountCents`, lowercase currency, verified status without evidence, and `amountCents` without `attributionType` are rejected before a database call.

- [x] **Step 2: Run tests and confirm they fail**

Run: `npx jest src/__tests__/lib/sias-operations.attribution.test.ts -i`
Expected: FAIL because the fields and validation do not exist.

- [x] **Step 3: Extend the service contract**

Export:

```ts
export type RevenueAttributionType = 'processed' | 'influenced' | 'recovered';
export type RevenueVerificationStatus = 'unverified' | 'merchant_confirmed' | 'system_verified' | 'rejected';
```

Extend `AttributionInput` with camelCase versions of all Task 1 fields. Add a pure `validateAttributionInput()` called before insert. Preserve `value` for non-monetary signal counts, but use `amountCents` for every monetary report.

- [x] **Step 4: Run tests**

Run: `npx jest src/__tests__/lib/sias-operations.attribution.test.ts -i`
Expected: PASS.

- [x] **Step 5: Update existing money-producing call sites**

Modify these call sites only where they have an explicit amount and evidence:

- `src/lib/whatsapp/v2/flows/customerBooking.ts`
- `src/lib/commerce/retail-orders.ts`
- `src/lib/payments/lifecycle.ts`
- `src/lib/siasCampaignRunner.ts`
- `src/app/api/reservations/[id]/route.ts`

Payment-completion paths with a verified provider event record `attributionType='processed'`, `verificationStatus='system_verified'`, the exact paid amount in minor units, and `evidenceType='payment_completed'`. Do not invent amounts. If a path records only a count or predicted lift, keep `amountCents` null and `verificationStatus='unverified'`.

- [x] **Step 6: Run affected tests and commit**

Run: `npx jest src/__tests__/lib/sias-operations.attribution.test.ts src/__tests__/app/api/sias/ops.routes.test.ts src/__tests__/lib/payments/lifecycle.retail.test.ts -i`
Expected: PASS.

```bash
git add src/lib/sias-operations.ts src/lib/whatsapp/v2/flows/customerBooking.ts src/lib/commerce/retail-orders.ts src/lib/payments/lifecycle.ts src/lib/siasCampaignRunner.ts src/app/api/reservations/[id]/route.ts src/__tests__/lib/sias-operations.attribution.test.ts
git commit -m "feat(analytics): record explicit revenue attribution"
```

### Task 3: Build the Deterministic Pilot Report Service

**Files:**
- Create: `src/lib/analytics/revenue-front-desk-report.ts`
- Test: `src/__tests__/lib/analytics/revenue-front-desk-report.test.ts`

**Interfaces:**
- Consumes: `ai_front_desk_events`, `sias_outcome_attributions`, and an injected `SupabaseClient`.
- Produces: `buildRevenueFrontDeskReport(client, input): Promise<RevenueFrontDeskReport>`.

- [x] **Step 1: Define the report contract in the failing test**

Use this shape:

```ts
export interface RevenueFrontDeskReport {
  period: { start: string; end: string };
  currency: string;
  funnel: {
    enquiries: number;
    qualified: number;
    bookings: number;
    sales: number;
    deposits_or_payments: number;
    followups_sent: number;
    recovered_opportunities: number;
    escalations: number;
  };
  revenue: {
    processed_cents: number;
    influenced_cents: number;
    recovered_cents: number;
  };
  handling: { automated: number; human: number; unresolved: number };
  completeness: {
    unverified_attributions: number;
    missing_amount_events: number;
    offline_confirmation_required: boolean;
  };
}
```

Test tenant and date filters, event-type counts, distinct-event deduplication by `correlation_id`, exclusion of rejected/unverified money, separation of the three revenue types, currency mismatch rejection, and data-completeness flags.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/__tests__/lib/analytics/revenue-front-desk-report.test.ts -i`
Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement deterministic aggregation**

Query only the requested tenant and inclusive/exclusive period `[start, end)`. Count funnel events from `ai_front_desk_events`. Sum `amount_cents` only for `merchant_confirmed` or `system_verified` attribution rows. Use three independent reducers keyed by `attribution_type`; never compute an overall generated-revenue sum. Treat missing correlation IDs as unique rows rather than collapsing them.

- [x] **Step 4: Run tests and commit**

Run: `npx jest src/__tests__/lib/analytics/revenue-front-desk-report.test.ts -i`
Expected: PASS.

```bash
git add src/lib/analytics/revenue-front-desk-report.ts src/__tests__/lib/analytics/revenue-front-desk-report.test.ts
git commit -m "feat(analytics): aggregate Booka revenue front desk outcomes"
```

### Task 4: Add the Tenant Report API and Dashboard

**Files:**
- Create: `src/app/api/analytics/revenue-front-desk/route.ts`
- Create: `src/components/reports/RevenueFrontDeskReport.tsx`
- Modify: `src/app/dashboard/reports/page.tsx`
- Test: `src/__tests__/app/api/analytics/revenue-front-desk.route.test.ts`
- Test: `src/components/reports/RevenueFrontDeskReport.test.tsx`

**Interfaces:**
- Consumes: `buildRevenueFrontDeskReport` from Task 3.
- Produces: authenticated `GET /api/analytics/revenue-front-desk?start=<ISO>&end=<ISO>` and the tenant report UI.

- [x] **Step 1: Write route tests**

Cover owner/manager access, staff denial, authenticated tenant scoping despite a spoofed header, ISO date validation, a maximum 93-day window, and pass-through of the deterministic report.

- [x] **Step 2: Run route tests and confirm they fail**

Run: `npx jest src/__tests__/app/api/analytics/revenue-front-desk.route.test.ts -i`
Expected: FAIL because the route does not exist.

- [x] **Step 3: Implement the route**

Use `createHttpHandler` with `{ auth: true, roles: ['owner', 'manager'] }`, `getVerifiedTenantId(ctx)`, Zod-coerced ISO datetimes, and reject `end <= start` or windows over 93 days.

- [x] **Step 4: Write the report component tests**

Assert separate cards for Processed, Influenced, and Recovered Revenue; funnel counts; verification warning; no `Generated Revenue` label; NGN formatting; loading/error/empty states.

- [x] **Step 5: Implement the report UI**

Use the existing reports page and auth-fetch conventions. Render money cards separately, display the period and data-completeness warning, and label the funnel `Enquiry → Qualified → Booking/Sale → Payment`. Do not expose internal cost.

- [x] **Step 6: Run tests and commit**

Run: `npx jest src/__tests__/app/api/analytics/revenue-front-desk.route.test.ts src/components/reports/RevenueFrontDeskReport.test.tsx -i`
Expected: PASS.

```bash
git add src/app/api/analytics/revenue-front-desk/route.ts src/components/reports/RevenueFrontDeskReport.tsx src/app/dashboard/reports/page.tsx src/__tests__/app/api/analytics/revenue-front-desk.route.test.ts src/components/reports/RevenueFrontDeskReport.test.tsx
git commit -m "feat(reports): show Booka revenue front desk outcomes"
```

### Task 5: Add Superadmin Unit Economics

**Files:**
- Create: `src/lib/analytics/booka-unit-economics.ts`
- Create: `src/app/api/superadmin/booka-unit-economics/route.ts`
- Modify: `src/app/dashboard/superadmin/analytics/page.tsx`
- Test: `src/__tests__/lib/analytics/booka-unit-economics.test.ts`
- Test: `src/__tests__/app/api/superadmin/booka-unit-economics.route.test.ts`

**Interfaces:**
- Consumes: `tenant_revenue_ledger`, `tenant_cost_ledger`, `ai_front_desk_events`, and `booka_revenue_requests` after Plans 1–2.
- Produces: internal per-tenant subscription/usage revenue, provider cost, gross contribution, conversation volume, and cost per verified outcome.

- [x] **Step 1: Write aggregation tests**

Pin these equations:

```ts
gross_contribution_credits = recognized_revenue_credits - provider_cost_credits;
gross_margin_percent = recognized_revenue_credits === 0
  ? null
  : gross_contribution_credits / recognized_revenue_credits * 100;
cost_per_verified_outcome_credits = verified_outcomes === 0
  ? null
  : provider_cost_credits / verified_outcomes;
```

Test separate `llm`, `whatsapp`, `server`, and `payment` costs, date filtering, zero-revenue behavior, and no cross-tenant aggregation.

- [x] **Step 2: Run tests and confirm they fail**

Run: `npx jest src/__tests__/lib/analytics/booka-unit-economics.test.ts -i`
Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement the unit-economics service**

Return ledger-derived totals only. Never estimate provider cost from customer revenue. Include a completeness flag when a tenant has AI events but no corresponding `tenant_cost_ledger` entries.

- [x] **Step 4: Write and implement the superadmin route**

Use `{ auth: true, roles: ['superadmin'], requireTenantMembership: false }`. Accept optional `tenant_id`, `start`, and `end`; cap the period at 366 days. Return no customer message content or phone numbers.

- [x] **Step 5: Add internal analytics cards**

Add a Booka Unit Economics section to the existing superadmin analytics page with recognized revenue, provider cost, gross contribution, gross margin, verified outcomes, and cost per verified outcome. Clearly label incomplete cost capture.

- [x] **Step 6: Run tests and commit**

Run: `npx jest src/__tests__/lib/analytics/booka-unit-economics.test.ts src/__tests__/app/api/superadmin/booka-unit-economics.route.test.ts -i`
Expected: PASS.

```bash
git add src/lib/analytics/booka-unit-economics.ts src/app/api/superadmin/booka-unit-economics/route.ts src/app/dashboard/superadmin/analytics/page.tsx src/__tests__/lib/analytics/booka-unit-economics.test.ts src/__tests__/app/api/superadmin/booka-unit-economics.route.test.ts
git commit -m "feat(superadmin): report Booka unit economics"
```

### Task 6: Final Attribution and Reporting Verification

**Files:**
- Modify only if verification exposes an issue in files from Tasks 1–5.

**Interfaces:**
- Consumes: All prior tasks.
- Produces: A verified analytics release suitable for the first pilot cohort.

- [x] **Step 1: Run focused tests**

Run: `npx jest src/__tests__/lib/sias-operations.attribution.test.ts src/__tests__/lib/analytics/revenue-front-desk-report.test.ts src/__tests__/app/api/analytics/revenue-front-desk.route.test.ts src/components/reports/RevenueFrontDeskReport.test.tsx src/__tests__/lib/analytics/booka-unit-economics.test.ts src/__tests__/app/api/superadmin/booka-unit-economics.route.test.ts src/__tests__/app/api/sias/ops.routes.test.ts -i`
Expected: all suites pass.

- [x] **Step 2: Run typecheck and lint**

Run: `npm run typecheck:full`
Expected: exit 0, or no diagnostic from a file in this plan if pre-existing unrelated diagnostics remain.

> Verification result: no diagnostic came from a Phase 3 file. The command still reports the pre-existing Jest mock typing errors in `AnalyticsProvider.test.tsx` and `PostHogIdentity.test.tsx`.

Run: `npx eslint src/lib/sias-operations.ts src/lib/analytics/revenue-front-desk-report.ts src/lib/analytics/booka-unit-economics.ts src/app/api/analytics/revenue-front-desk/route.ts src/app/api/superadmin/booka-unit-economics/route.ts src/components/reports/RevenueFrontDeskReport.tsx src/app/dashboard/reports/page.tsx src/app/dashboard/superadmin/analytics/page.tsx`
Expected: exit 0.

- [x] **Step 3: Run claim and formatting checks**

Run: `rg -n "generated revenue|total generated|Booka generated" src/components/reports src/app/dashboard/reports src/app/dashboard/superadmin/analytics`
Expected: no output.

Run: `git diff --check`
Expected: no output.

- [ ] **Step 4: Verify tenant isolation manually**

> Live disposable-database verification is pending owner execution. Automated coverage verifies two-tenant aggregation separation, tenant filtering on every source query, authenticated tenant scoping, spoofed-header rejection, and superadmin-only unit-economics access.

Seed two tenants with distinct events, attribution rows, and cost ledgers in a disposable database. Call the tenant report as each tenant and confirm each response contains only its own counts and money. Call the superadmin unit-economics endpoint and confirm it can filter either tenant without returning phone numbers or message content.

- [x] **Step 5: Commit verification corrections if required**

Stage only files from this plan and commit:

```bash
git add db/migrations/123_revenue_attribution_verification.sql scripts/sql/test_revenue_attribution_baseline.sql scripts/sql/verify_revenue_attribution_verification.sql src/lib/sias-operations.ts src/lib/analytics/revenue-front-desk-report.ts src/lib/analytics/booka-unit-economics.ts src/app/api/analytics/revenue-front-desk/route.ts src/app/api/superadmin/booka-unit-economics/route.ts src/components/reports/RevenueFrontDeskReport.tsx src/app/dashboard/reports/page.tsx src/app/dashboard/superadmin/analytics/page.tsx src/__tests__
git commit -m "fix(analytics): finish verified Booka revenue reporting"
```
