# Booka Revenue Pilot and Missed Revenue Report Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build privacy-minimizing public application flows and an internal qualification queue for the Booka Revenue Pilot and concierge Missed Revenue Report.

**Architecture:** A platform-owned `booka_revenue_requests` table stores prospect-level business data, qualification inputs, workflow status, and structured audit summaries; it never stores raw customer conversations. A shared public form posts to one rate-limited endpoint, while a superadmin-only queue supports qualification and audit delivery.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Supabase/PostgreSQL, Redis, Jest 30, React Testing Library

**Spec:** `docs/superpowers/specs/2026-08-29-booka-revenue-front-desk-positioning-design.md`

## Global Constraints

- The pilot is an application, not automatic tenant provisioning.
- The 14-day clock starts only after configuration and a successful live-channel test.
- Do not request or store raw WhatsApp or Instagram customer messages in this subsystem.
- Opportunity values are ranges and must retain their assumptions.
- Consent to contact is required; sample-review consent is separate and optional.
- Public submission is rate-limited and honeypot-protected.
- Only superadmins can list, inspect, qualify, or update platform prospect requests.
- Keep the unrelated untracked `Booking/` directory untouched.

---

### Task 1: Create the Revenue Request Schema

**Files:**
- Create: `db/migrations/122_booka_revenue_requests.sql`
- Create: `scripts/sql/verify_booka_revenue_requests.sql`

**Interfaces:**
- Consumes: `auth.role()` and the existing service-role database access pattern.
- Produces: `public.booka_revenue_requests`, used by all later tasks in this plan.

- [x] **Step 1: Write the schema verification SQL first**

Create `scripts/sql/verify_booka_revenue_requests.sql`:

```sql
do $$
declare
  missing_columns text[];
begin
  select array_agg(required.name)
  into missing_columns
  from (values
    ('request_type'), ('business_name'), ('contact_name'), ('email'), ('phone'),
    ('vertical'), ('weekly_enquiry_band'), ('channels'), ('consent_to_contact'),
    ('sample_review_consent'), ('status'), ('audit_summary'), ('created_at'), ('updated_at')
  ) as required(name)
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booka_revenue_requests'
      and column_name = required.name
  );

  if missing_columns is not null then
    raise exception 'booka_revenue_requests missing columns: %', missing_columns;
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'booka_revenue_requests'
      and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on booka_revenue_requests';
  end if;
end $$;
```

- [x] **Step 2: Run the verification against a disposable PostgreSQL database and confirm it fails**

Run:

```bash
docker run --rm -d --name booka-revenue-intake-db -e POSTGRES_PASSWORD=booka -p 55432:5432 postgres:16-alpine
psql postgresql://postgres:booka@127.0.0.1:55432/postgres -f scripts/sql/verify_booka_revenue_requests.sql
```

Expected: the verification exits non-zero because the table does not exist.

- [x] **Step 3: Create the additive migration**

Create `db/migrations/122_booka_revenue_requests.sql` with:

```sql
begin;

create table if not exists public.booka_revenue_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('revenue_pilot', 'missed_revenue_report')),
  business_name text not null,
  contact_name text not null,
  email text not null,
  phone text not null,
  vertical text not null check (vertical in ('beauty', 'hospitality', 'clinic', 'other')),
  other_vertical text,
  weekly_enquiry_band text not null check (weekly_enquiry_band in ('under_20', '20_49', '50_99', '100_249', '250_plus')),
  channels text[] not null default '{}',
  average_transaction_value_ngn numeric(14,2),
  current_conversion_band text check (current_conversion_band in ('unknown', 'under_10', '10_24', '25_49', '50_plus')),
  instagram_handle text,
  website_url text,
  consent_to_contact boolean not null,
  sample_review_consent boolean not null default false,
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'audit_in_progress', 'audit_ready', 'pilot_scheduled', 'converted', 'closed')),
  qualification_note text,
  audit_summary jsonb not null default '{}'::jsonb,
  source text not null default 'booka_website',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(channels) > 0),
  check (consent_to_contact = true),
  check (vertical <> 'other' or nullif(trim(other_vertical), '') is not null)
);

create index if not exists idx_booka_revenue_requests_status_created
  on public.booka_revenue_requests (status, created_at desc);
create index if not exists idx_booka_revenue_requests_type_created
  on public.booka_revenue_requests (request_type, created_at desc);
create unique index if not exists idx_booka_revenue_requests_open_contact
  on public.booka_revenue_requests (request_type, lower(email))
  where status not in ('converted', 'closed');

alter table public.booka_revenue_requests enable row level security;
revoke all on public.booka_revenue_requests from anon, authenticated;
grant all on public.booka_revenue_requests to service_role;

drop policy if exists booka_revenue_requests_service_role on public.booka_revenue_requests;
create policy booka_revenue_requests_service_role
  on public.booka_revenue_requests for all to service_role
  using (true) with check (true);

commit;
```

- [ ] **Step 4: Apply and verify in the disposable database**

> Pending owner execution. The migration and verification script are ready; live database commands were deliberately left to the owner on 2026-08-29.

Run:

```bash
psql postgresql://postgres:booka@127.0.0.1:55432/postgres -f db/migrations/122_booka_revenue_requests.sql
psql postgresql://postgres:booka@127.0.0.1:55432/postgres -f scripts/sql/verify_booka_revenue_requests.sql
docker rm -f booka-revenue-intake-db
```

Expected: both SQL files exit 0; the container is removed.

- [x] **Step 5: Commit the schema**

```bash
git add db/migrations/122_booka_revenue_requests.sql scripts/sql/verify_booka_revenue_requests.sql
git commit -m "feat(booka): add revenue request intake schema"
```

### Task 2: Add Shared Validation and the Public Submission Endpoint

**Files:**
- Create: `src/lib/booka/revenue-intake.ts`
- Create: `src/app/api/public/booka/revenue-requests/route.ts`
- Test: `src/__tests__/app/api/public/booka/revenue-requests.route.test.ts`

**Interfaces:**
- Consumes: `booka_revenue_requests` from Task 1; `cacheGet`, `cacheSet`, and `isRedisConfigured` from `src/lib/redis.ts`.
- Produces: `BookaRevenueRequestSchema`, `BookaRevenueRequestInput`, `AuditSummarySchema`, and public `POST /api/public/booka/revenue-requests` returning `{ id, request_type, status }`.

- [x] **Step 1: Write endpoint tests**

Cover these exact cases:

```ts
it('accepts a consented beauty pilot request and inserts normalized fields');
it('accepts a missed-revenue-report request without raw conversation content');
it('rejects consent_to_contact=false');
it('rejects other vertical without other_vertical');
it('rejects an empty channels array');
it('returns success without inserting when the honeypot field is populated');
it('rejects the sixth request from one IP inside an hour when Redis is configured');
it('returns the existing open request when the unique contact constraint is hit');
```

Use mocked `createSupabaseAdminClient`, `isRedisConfigured`, `cacheGet`, and `cacheSet`. Assert the insert payload never contains `conversation`, `messages`, `chat_sample`, or `customer_data` keys.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `npx jest src/__tests__/app/api/public/booka/revenue-requests.route.test.ts -i`
Expected: FAIL because the module and route do not exist.

- [x] **Step 3: Implement the shared schemas**

In `src/lib/booka/revenue-intake.ts`, export:

```ts
export const RequestTypeSchema = z.enum(['revenue_pilot', 'missed_revenue_report']);
export const VerticalSchema = z.enum(['beauty', 'hospitality', 'clinic', 'other']);
export const WeeklyEnquiryBandSchema = z.enum(['under_20', '20_49', '50_99', '100_249', '250_plus']);
export const RequestStatusSchema = z.enum(['new', 'qualified', 'contacted', 'audit_in_progress', 'audit_ready', 'pilot_scheduled', 'converted', 'closed']);

export const AuditSummarySchema = z.object({
  enquiries_reviewed: z.number().int().nonnegative(),
  unanswered_or_delayed: z.number().int().nonnegative(),
  missing_next_step: z.number().int().nonnegative(),
  availability_dead_ends: z.number().int().nonnegative(),
  missing_follow_ups: z.number().int().nonnegative(),
  missed_recommendations: z.number().int().nonnegative(),
  opportunity_low_ngn: z.number().nonnegative(),
  opportunity_high_ngn: z.number().nonnegative(),
  assumptions: z.array(z.string().min(1).max(500)).min(1),
}).refine((value) => value.opportunity_high_ngn >= value.opportunity_low_ngn, {
  message: 'opportunity_high_ngn must be at least opportunity_low_ngn',
});
```

Define `BookaRevenueRequestSchema` with the migration's enums and limits: names 2–120 characters, email valid and lowercased, phone 7–30 characters, optional URLs valid, average transaction value positive, `channels` as a non-empty array of `whatsapp|instagram`, consent literal `true`, optional `sample_review_consent`, and honeypot `company_website` max 0 characters. Add a refinement requiring `other_vertical` when vertical is `other`.

- [x] **Step 4: Implement the public endpoint**

Use `createHttpHandler(..., 'POST', { auth: false })` and `createSupabaseAdminClient()`. Enforce five submissions per IP per hour using Redis key `rate:booka-revenue-request:<ip>`; degrade gracefully on Redis errors and log the failure. Return a generic accepted response for a populated honeypot without inserting. On PostgreSQL error `23505`, select the existing open request by `request_type` and lowercase email and return it rather than creating duplicates.

- [x] **Step 5: Run the route tests**

Run: `npx jest src/__tests__/app/api/public/booka/revenue-requests.route.test.ts -i`
Expected: PASS.

- [x] **Step 6: Commit the endpoint**

```bash
git add src/lib/booka/revenue-intake.ts src/app/api/public/booka/revenue-requests/route.ts src/__tests__/app/api/public/booka/revenue-requests.route.test.ts
git commit -m "feat(booka): accept revenue pilot and audit requests"
```

### Task 3: Build the Two Public Application Experiences

**Files:**
- Create: `src/components/booka/RevenueRequestForm.tsx`
- Create: `src/components/booka/RevenueRequestForm.test.tsx`
- Create: `src/app/booka/revenue-pilot/page.tsx`
- Create: `src/app/booka/missed-revenue-report/page.tsx`

**Interfaces:**
- Consumes: `POST /api/public/booka/revenue-requests` from Task 2.
- Produces: `<RevenueRequestForm requestType="revenue_pilot" | "missed_revenue_report" />` and two indexable public pages.

- [x] **Step 1: Write the form tests**

Test that the form:

```tsx
render(<RevenueRequestForm requestType="revenue_pilot" />);
expect(screen.getByRole('button', { name: 'Apply for the Revenue Pilot' })).toBeInTheDocument();
```

Also cover required consent, conditional `other_vertical`, channel selection, successful fetch payload, server error display, disabled submit while pending, and a Missed Revenue Report success message that says Booka will contact the applicant about a consented sample rather than requesting messages in the form.

- [x] **Step 2: Run the component tests and confirm they fail**

Run: `npx jest src/components/booka/RevenueRequestForm.test.tsx -i`
Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement the shared client form**

Use controlled React state and submit JSON to `/api/public/booka/revenue-requests`. Include:

- business and contact name;
- email and phone;
- vertical plus conditional other vertical;
- weekly enquiry band;
- WhatsApp and Instagram checkboxes;
- optional average transaction value;
- optional current conversion band;
- optional Instagram handle and website URL;
- required consent-to-contact checkbox;
- optional consent to review a separately supplied, minimized sample;
- hidden honeypot named `company_website`.

Do not render a textarea or file input for customer conversations.

- [x] **Step 4: Implement the pages**

The pilot page must state the qualification rules, included setup, success definition, and that the 14 active days begin after live verification. The audit page must state the seven report outputs, use an opportunity-range disclaimer, and explain that Booka will agree a privacy-safe sample handoff after submission.

- [x] **Step 5: Run component tests and lint**

Run: `npx jest src/components/booka/RevenueRequestForm.test.tsx -i`
Expected: PASS.

Run: `npx eslint src/components/booka/RevenueRequestForm.tsx src/app/booka/revenue-pilot/page.tsx src/app/booka/missed-revenue-report/page.tsx`
Expected: exit 0.

- [x] **Step 6: Commit the public pages**

```bash
git add src/components/booka/RevenueRequestForm.tsx src/components/booka/RevenueRequestForm.test.tsx src/app/booka/revenue-pilot/page.tsx src/app/booka/missed-revenue-report/page.tsx
git commit -m "feat(booka): add revenue pilot and audit application pages"
```

### Task 4: Build the Superadmin Qualification Queue

**Files:**
- Create: `src/app/api/superadmin/booka-revenue-requests/route.ts`
- Create: `src/app/api/superadmin/booka-revenue-requests/[id]/route.ts`
- Create: `src/app/dashboard/superadmin/booka-revenue-requests/page.tsx`
- Create: `src/app/dashboard/superadmin/booka-revenue-requests/RevenueRequestsClient.tsx`
- Create: `src/app/dashboard/superadmin/booka-revenue-requests/AuditReportPrintView.tsx`
- Test: `src/__tests__/app/api/superadmin/booka-revenue-requests.routes.test.ts`
- Test: `src/__tests__/app/dashboard/superadmin/RevenueRequestsClient.test.tsx`
- Test: `src/__tests__/app/dashboard/superadmin/AuditReportPrintView.test.tsx`

**Interfaces:**
- Consumes: `booka_revenue_requests` and `AuditSummarySchema`.
- Produces: Superadmin GET list filters, PATCH workflow updates, and an internal queue for pilot/audit operations.

- [x] **Step 1: Write API tests**

Cover superadmin-only access, `request_type` and `status` filters, default newest-first ordering, PATCH status validation, audit-summary range validation, and rejection of audit summaries on `revenue_pilot` records.

- [x] **Step 2: Run API tests and confirm they fail**

Run: `npx jest src/__tests__/app/api/superadmin/booka-revenue-requests.routes.test.ts -i`
Expected: FAIL because the routes do not exist.

- [x] **Step 3: Implement the superadmin routes**

Use `{ auth: true, roles: ['superadmin'], requireTenantMembership: false }`. GET returns `{ data, total }` with optional exact enum filters and pagination capped at 200. PATCH accepts:

```ts
{
  status?: RequestStatus;
  qualification_note?: string;
  audit_summary?: AuditSummary;
}
```

Set `updated_at` on every change. Require `request_type='missed_revenue_report'` before saving `audit_summary`; change status to `audit_ready` in the same update.

- [x] **Step 4: Write the client and printable-report tests**

Cover request-type/status filters, qualification notes, status transition, audit summary entry, NGN range display, and the empty state. For `AuditReportPrintView`, assert the business name, seven audit outputs, opportunity low/high range, every assumption, the opportunity-not-guarantee disclaimer, and absence of customer message content.

- [x] **Step 5: Implement the queue UI and printable audit deliverable**

Render contact details, vertical, channel badges, weekly enquiry band, average transaction value, consent flags, status, notes, and audit summary. Never add raw-chat upload or display. Use existing superadmin auth-fetch conventions.

`AuditReportPrintView` accepts `{ businessName: string; createdAt: string; summary: AuditSummary }`, renders a white print-safe one-page report, and includes a `Print or save as PDF` button that calls `window.print()`. Hide the button with `print:hidden`. The admin uses the browser's Save as PDF flow and sends the resulting document through the agreed concierge channel; no public unauthenticated report URL is created.

- [x] **Step 6: Run the queue tests**

Run: `npx jest src/__tests__/app/api/superadmin/booka-revenue-requests.routes.test.ts src/__tests__/app/dashboard/superadmin/RevenueRequestsClient.test.tsx src/__tests__/app/dashboard/superadmin/AuditReportPrintView.test.tsx -i`
Expected: PASS.

- [x] **Step 7: Commit the internal queue**

```bash
git add src/app/api/superadmin/booka-revenue-requests src/app/dashboard/superadmin/booka-revenue-requests src/__tests__/app/api/superadmin/booka-revenue-requests.routes.test.ts src/__tests__/app/dashboard/superadmin/RevenueRequestsClient.test.tsx src/__tests__/app/dashboard/superadmin/AuditReportPrintView.test.tsx
git commit -m "feat(superadmin): manage Booka revenue requests"
```

### Task 5: Connect the Landing Page and Verify Intake End to End

**Files:**
- Modify: `src/components/homepage/BookaLanding.tsx`
- Modify: `src/components/homepage/BookaLanding.test.tsx`
- Modify: `deployment/scripts/post-deploy-ai-front-desk.sh`

**Interfaces:**
- Consumes: Public pages and API from Tasks 2–3.
- Produces: Live landing-page navigation and a deployment schema check.

- [x] **Step 1: Update the landing-page test expectations**

Change CTA assertions to:

```ts
expect(screen.getAllByRole('link', { name: 'Apply for the 14-Day Revenue Pilot' })[0])
  .toHaveAttribute('href', '/booka/revenue-pilot');
expect(screen.getByRole('link', { name: 'Get a Missed Revenue Report' }))
  .toHaveAttribute('href', '/booka/missed-revenue-report');
```

- [x] **Step 2: Run the test and confirm it fails on the anchor links**

Run: `npx jest src/components/homepage/BookaLanding.test.tsx -i`
Expected: FAIL because the links still use in-page anchors.

- [x] **Step 3: Change the links and add deployment verification**

Update every pilot and audit CTA to the dedicated pages. Extend `deployment/scripts/post-deploy-ai-front-desk.sh` with a read-only `information_schema.columns` check requiring `booka_revenue_requests.request_type`, `status`, and `audit_summary`.

- [x] **Step 4: Run the full intake verification**

Run: `npx jest src/__tests__/app/api/public/booka/revenue-requests.route.test.ts src/components/booka/RevenueRequestForm.test.tsx src/__tests__/app/api/superadmin/booka-revenue-requests.routes.test.ts src/__tests__/app/dashboard/superadmin/RevenueRequestsClient.test.tsx src/__tests__/app/dashboard/superadmin/AuditReportPrintView.test.tsx src/components/homepage/BookaLanding.test.tsx -i`
Expected: all suites pass.

Run: `npx eslint src/lib/booka/revenue-intake.ts src/app/api/public/booka/revenue-requests/route.ts src/components/booka/RevenueRequestForm.tsx src/app/booka/revenue-pilot/page.tsx src/app/booka/missed-revenue-report/page.tsx src/app/api/superadmin/booka-revenue-requests src/app/dashboard/superadmin/booka-revenue-requests src/components/homepage/BookaLanding.tsx`
Expected: exit 0.

Run: `git diff --check`
Expected: no output.

- [x] **Step 5: Commit the integration**

```bash
git add src/components/homepage/BookaLanding.tsx src/components/homepage/BookaLanding.test.tsx deployment/scripts/post-deploy-ai-front-desk.sh
git commit -m "feat(booka): connect revenue intake journeys"
```
