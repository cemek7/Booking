# 30-Day Launch / Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take one concierge-onboarded test salon live in production running the full WhatsApp operations loop (inbound → booking → Paystack deposit → reminder → no-show recovery → rebooking), proven by characterization tests + one end-to-end smoke test, within 30 days.

**Architecture:** This is a *hardening* effort — all six loop stages already exist in code. We add regression coverage around the Paystack deposit path (already signature-verified + replay-protected), prove loop continuity with one smoke test, document migration-ordering hazards for manual prod resolution (no auto-renumbering), and produce a concierge onboarding runbook for the test salon. Paystack is the only payment rail in scope.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Jest 30 + ts-jest, Supabase JS client (mocked in tests), Paystack (HMAC-sha512 webhook signatures), `createHttpHandler` route wrapper.

**Spec:** [2026-06-16-30-day-launch-hardening-design.md](../specs/2026-06-16-30-day-launch-hardening-design.md)

---

## File Structure

**Created:**
- `docs/runbooks/migration-collision-resolution.md` — manual prod resolution runbook (Workstream A)
- `db/audits/core_path_audit.sql` — read-only audit queries for collisions + core-path columns (Workstream A)
- `docs/runbooks/concierge-onboarding-test-salon.md` — provisioning checklist (Workstream D)
- `src/__tests__/app/api/payments/paystack-webhook.test.ts` — webhook characterization tests (Workstream B1)
- `src/__tests__/app/api/payments/deposits.test.ts` — deposit init tests (Workstream B2)
- `src/__tests__/app/api/jobs/auto-cancel.test.ts` — abandoned-deposit sweep test (Workstream B3)
- `src/__tests__/integration/ops-loop-smoke.test.ts` — end-to-end loop smoke test (Workstream C)
- `docs/runbooks/launch-test-triage.md` — triage record for the ~107 non-core failures (Workstream C)

**Modified (only if audit reveals a real gap):**
- `db/migrations/*` — NOT modified by this plan. Collisions are documented for manual resolution.

---

## Workstream A — DB Hygiene (document-only)

### Task A1: Read-only core-path audit script

**Files:**
- Create: `db/audits/core_path_audit.sql`

- [ ] **Step 1: Write the audit script**

```sql
-- core_path_audit.sql — READ ONLY. Run against the TARGET prod DB to confirm
-- the no-show / deposit columns and webhook idempotency table actually exist
-- (the IF NOT EXISTS migrations may have silently skipped on a pre-existing table).

-- 1. No-show scoring columns (migration 077_customer_no_show_score.sql)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers'
  AND column_name IN ('no_show_count', 'risk_score');
-- EXPECT: 2 rows (no_show_count int default 0, risk_score text default 'low')

-- 2. Transactions reconciliation columns used by the webhook
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='transactions'
  AND column_name IN ('provider_reference','reconciliation_status','status','tenant_id');
-- EXPECT: 4 rows

-- 3. Webhook idempotency table + its unique constraint (replay protection)
SELECT conname, contype FROM pg_constraint
WHERE conrelid = 'public.webhook_events'::regclass AND contype = 'u';
-- EXPECT: at least 1 unique constraint covering (provider, external_id)

-- 4. Confirm which of the colliding migrations' objects are present
--    065: chats unique constraint vs messages read columns
SELECT to_regclass('public.chats') AS chats, to_regclass('public.messages') AS messages;
SELECT column_name FROM information_schema.columns
WHERE table_name='messages' AND column_name IN ('read_at','read_by');
```

- [ ] **Step 2: Commit**

```bash
git add db/audits/core_path_audit.sql
git commit -m "chore(db): add read-only core-path audit script for launch hardening"
```

### Task A2: Migration collision resolution runbook

**Files:**
- Create: `docs/runbooks/migration-collision-resolution.md`

- [ ] **Step 1: Write the runbook**

Document, for a human operator (NOT an automated step):
- The three genuine forward-migration collisions and their files:
  - `065_chats_unique_constraint.sql` + `065_messages_read_columns.sql`
  - `077_ai_wallets.sql` + `077_customer_no_show_score.sql`
  - `079_finance_ledgers.sql` + `079_whatsapp_message_queue_channel.sql`
- The hazard: on a fresh apply-from-zero, filename sort order between two `077_*` files is ambiguous; on an existing prod DB, both may already be applied.
- The procedure: run `db/audits/core_path_audit.sql` FIRST. Only if a core-path object is missing, hand-apply the additive SQL from the specific migration (e.g. the `ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS no_show_count ...` block from `077_customer_no_show_score.sql`). Never rename a migration already recorded as applied.
- A manual fallback SQL block (copy the additive ALTERs from `077_customer_no_show_score.sql`) so no-show scoring can be repaired without re-running migrations.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/migration-collision-resolution.md
git commit -m "docs(runbook): migration collision manual-resolution procedure"
```

---

## Workstream B — Paystack Deposit Path (characterization tests)

The routes already exist (`src/app/api/payments/webhook/route.ts`, `auth:false`; `src/app/api/payments/deposits/route.ts`, `auth:true`). These tests lock in current behavior so hardening changes don't regress it.

> **CRITICAL — verified route-testing pattern for this repo.** `createHttpHandler` returns a function that takes a real `NextRequest`, builds its **own** Supabase client internally (ignoring any client you try to pass in), and wraps the handler's return value in `NextResponse.json(...)`. Therefore:
> - Pass a real `new NextRequest(url, {...})` — **never** a hand-built `ctx` object.
> - Mock the Supabase factories so the wrapper uses your mock: `jest.mock('@/lib/supabase/server', ...)` and `jest.mock('@/lib/supabase/bearer-client', ...)`.
> - Read results via `response.status` and `await response.json()` — the handler's return is **not** returned directly.
> - Validation failures do **not** reject; the wrapper catches them and returns an error response. Assert `response.status` (e.g. `400`), never `.rejects`.
> - For `auth:true` routes the request needs headers `authorization: 'Bearer <token>'` **and** `x-tenant-id: '<tenant>'`, and the **admin-client** mock must provide `auth.getUser` → user and `from('tenant_users')` → `{ tenant_id, role }` (the wrapper does its own membership check via the admin client; the handler's own queries run through the bearer client).
>
> **Copy the canonical working example: `src/__tests__/app/api/sias/ops.routes.test.ts`.** Do NOT model on `stripe.test.ts` — it uses the outdated ctx-passing pattern and is among the known-failing suites.

### Task B1: Paystack webhook (`auth:false`) — reject unsigned, accept signed, replay

**Files:**
- Create: `src/__tests__/app/api/payments/paystack-webhook.test.ts`
- Test target: `src/app/api/payments/webhook/route.ts`

- [ ] **Step 1: Write the tests** (auth:false → mock `getSupabaseRouteHandlerClient`)

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
  createSupabaseAdminClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/payments/lifecycle', () => ({ handlePaymentSuccess: jest.fn(async () => undefined) }));
jest.mock('@/lib/eventbus/eventBus', () => ({ getEventBus: () => ({ publishEvent: jest.fn(async () => undefined) }) }));

import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { POST } from '@/app/api/payments/webhook/route';

const SECRET = 'sk_test_dummy';
const sign = (raw: string) => crypto.createHmac('sha512', SECRET).update(raw).digest('hex');

// IMPORTANT: build the body string ONCE and reuse it for both the signature and the
// request body, so the signed bytes exactly match what the handler reads via request.text().
const signedWebhook = (bodyObj: unknown) => {
  const raw = JSON.stringify(bodyObj);
  return new NextRequest('http://localhost:3000/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(raw) },
    body: raw,
  });
};
const unsignedWebhook = (bodyObj: unknown) =>
  new NextRequest('http://localhost:3000/api/payments/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bodyObj),
  });

const makeSupabase = (opts: { insertError?: { code: string } | null } = {}) => ({
  from: jest.fn((table: string) => {
    if (table === 'webhook_events') return {
      insert: () => ({ select: async () => ({ data: opts.insertError ? null : [{ id: 'evt1' }], error: opts.insertError ?? null }) }),
    };
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }; // transactions
  }),
});

describe('Paystack webhook (auth:false)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(makeSupabase());
  });

  it('rejects a request with no recognised signature header (400)', async () => {
    const res = await POST(unsignedWebhook({ provider: 'paystack', reference: 'r1', status: 'success' }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it('accepts a correctly signed webhook (200, ok:true)', async () => {
    const res = await POST(signedWebhook({ provider: 'paystack', reference: 'r_ok', status: 'success' }) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('treats a duplicate webhook_events insert (23505) as a replay', async () => {
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(makeSupabase({ insertError: { code: '23505' } }));
    const res = await POST(signedWebhook({ provider: 'paystack', reference: 'r_dup', status: 'success' }) as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ ok: true, replay: true });
  });
});
```

- [ ] **Step 2: Run** → `npx jest src/__tests__/app/api/payments/paystack-webhook.test.ts`. Expected: 3 PASS. If "accept signed" fails on signature, confirm the body string used for signing equals the body sent (the `signedWebhook` helper guarantees this). If replay fails, the `webhook_events` unique constraint is the only replay guard — flag it for the Task A1 audit.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/app/api/payments/paystack-webhook.test.ts
git commit -m "test(payments): Paystack webhook unsigned-reject, signed-accept, replay"
```

### Task B2: Deposit init (`auth:true`) — happy path, idempotent duplicate, cancelled guard

**Files:**
- Create: `src/__tests__/app/api/payments/deposits.test.ts`
- Test target: `src/app/api/payments/deposits/route.ts`

- [ ] **Step 1: Write the tests** (auth:true → mock admin client for auth/membership + bearer client for handler queries)

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
  getSupabaseRouteHandlerClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/supabase/bearer-client', () => ({ createSupabaseBearerClient: jest.fn() }));
jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    initializePayment: jest.fn(async () => ({ success: true, transactionId: 'txn_1', authorizationUrl: 'https://pay/redirect' })),
  })),
}));

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { createSupabaseBearerClient } from '@/lib/supabase/bearer-client';
import { POST } from '@/app/api/payments/deposits/route';

// admin client: used by the wrapper for auth.getUser + tenant_users membership (.eq().eq().maybeSingle())
const adminMock = () => ({
  auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'usr_1', email: 'o@test.com' } }, error: null }) },
  from: jest.fn((t: string) => t === 'tenant_users'
    ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: 'ten_1', role: 'owner' }, error: null }) }) }) }) }
    : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
});

// bearer client = ctx.supabase used INSIDE the deposits handler
const bearerMock = (o: { reservationStatus?: string; existingDeposit?: any } = {}) => {
  const chain = (final: any): any => ({ select: () => chain(final), eq: () => chain(final), in: () => chain(final), single: async () => final, maybeSingle: async () => final });
  return { from: (t: string) => {
    if (t === 'tenant_users') return chain({ data: { tenant_id: 'ten_1' } });
    if (t === 'reservations') return chain({ data: { id: 'res_1', status: o.reservationStatus ?? 'pending' } });
    if (t === 'transactions') return chain({ data: o.existingDeposit ?? null });
    if (t === 'tenants') return chain({ data: { metadata: {} } });
    return chain({ data: null });
  } };
};

const req = (body: unknown) => new NextRequest('http://localhost:3000/api/payments/deposits', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer test-token', 'x-tenant-id': 'ten_1' },
  body: JSON.stringify(body),
});

describe('deposit init (auth:true)', () => {
  const body = { amount: 10000, email: 'salon@test.com', reservationId: 'res_1' };
  beforeEach(() => {
    jest.clearAllMocks();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(adminMock());
  });

  it('initializes a Paystack deposit and returns the authorization URL', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock());
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, transactionId: 'txn_1', authorizationUrl: 'https://pay/redirect' });
  });

  it('is idempotent — returns the existing deposit instead of creating a new one', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock({ existingDeposit: { id: 'txn_old', status: 'pending', provider_reference: 'r', raw: { provider_response: { authorizationUrl: 'https://old' } } } }));
    const res = await POST(req(body) as unknown as NextRequest);
    expect(await res.json()).toMatchObject({ duplicate: true, transactionId: 'txn_old' });
  });

  it('refuses a deposit for a cancelled reservation (4xx)', async () => {
    (createSupabaseBearerClient as jest.Mock).mockReturnValue(bearerMock({ reservationStatus: 'cancelled' }));
    const res = await POST(req(body) as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Run** → `npx jest src/__tests__/app/api/payments/deposits.test.ts`. Expected: 3 PASS. If auth returns 401/403, re-check the `adminMock` `tenant_users` chain shape (`.eq().eq().maybeSingle()`) and the `x-tenant-id` header.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/app/api/payments/deposits.test.ts
git commit -m "test(payments): deposit init happy-path, idempotency, cancelled-guard"
```

### Task B3: Abandoned deposit → auto-cancel sweep

**Files:**
- Create: `src/__tests__/app/api/jobs/auto-cancel.test.ts`
- Test target: `src/app/api/jobs/auto-cancel-unconfirmed/route.ts`

- [ ] **Step 1: Read the handler to learn its real export, auth mode, query, and status values**

Run: `sed -n '1,120p' src/app/api/jobs/auto-cancel-unconfirmed/route.ts`
Record: which HTTP method is exported; whether it's `auth:false` (cron) or `auth:true`; the exact source status it sweeps (e.g. `pending` / `unconfirmed`); the time-window column; and the target status it writes (expected `cancelled`). Use these EXACT values below — do not guess.

- [ ] **Step 2: Write the test using the verified pattern from Task B1/B2**

Mirror the matching auth mode: if `auth:false`, mock `getSupabaseRouteHandlerClient` (as in B1); if `auth:true`, mock admin + bearer (as in B2). Return one stale reservation from the swept query and assert an `update({ status: 'cancelled' ... })` is issued for it. Read `response.status` / `response.json()`. Write concrete assertions from the Step 1 findings — no placeholders.

- [ ] **Step 3: Run + commit**

Run: `npx jest src/__tests__/app/api/jobs/auto-cancel.test.ts`
Expected: PASS

```bash
git add src/__tests__/app/api/jobs/auto-cancel.test.ts
git commit -m "test(jobs): abandoned deposit is swept to cancelled by auto-cancel job"
```

---

## Workstream C — Loop Continuity + Smoke Test

### Task C1: End-to-end ops-loop smoke test

**Files:**
- Create: `src/__tests__/integration/ops-loop-smoke.test.ts`

- [ ] **Step 1: Write a single test that walks the loop stages with mocked I/O**

```typescript
// Smoke test: asserts the six loop stages chain without throwing, using mocked
// providers/supabase. This is a continuity guard, not a unit test — one assertion
// per stage handoff. Stages:
//   1. processMessageV2 (inbound)  -> booking intent recognised
//   2. deposit init                -> authorization URL returned
//   3. webhook success             -> handlePaymentSuccess called, reservation confirmed
//   4. reminders/run               -> reminder enqueued for the confirmed reservation
//   5. auto-cancel/no-show scoring -> no_show_count increments on a missed reservation
//   6. nightly rebooking           -> rebooking nudge sent for an eligible past reservation
// Import the real exported functions; mock Supabase + provider clients at the boundary.
```

Build this incrementally: add one stage, run, see it pass, then add the next. Reuse the verified Supabase-factory mock pattern from Task B1/B2 (mock `@/lib/supabase/server` + `@/lib/supabase/bearer-client`; never hand-build a `ctx`). For route stages, invoke via real `NextRequest` and read `response.json()`. For library-function stages (e.g. `processMessageV2`, `handlePaymentSuccess`, the nightly rebooking functions), import the real exports and mock `getProviderClient` so no real WhatsApp/Paystack calls fire.

- [ ] **Step 2: Run the smoke test**

Run: `npx jest src/__tests__/integration/ops-loop-smoke.test.ts -v`
Expected: PASS — each stage handoff asserted.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/ops-loop-smoke.test.ts
git commit -m "test(integration): end-to-end ops-loop smoke test (6-stage continuity)"
```

### Task C2: Core-path green + triage the rest

**Files:**
- Create: `docs/runbooks/launch-test-triage.md`

- [ ] **Step 1: Run only the core-path tests and confirm green**

Run:
```bash
npx jest src/__tests__/app/api/payments/ \
         src/__tests__/integration/ops-loop-smoke.test.ts \
         src/__tests__/lib/whatsapp/v2/ \
         src/__tests__/api/cron/nightly/ --runInBand
```
Expected: all PASS. Fix any failures that are on the ops-loop path (these block launch).

- [ ] **Step 2: Capture the full-suite failure list and triage**

Run: `npx jest --silent 2>&1 | tail -40 > /tmp/suite.txt`
Then write `docs/runbooks/launch-test-triage.md` listing each failing suite with a one-line classification: `CORE` (must fix, should be zero after Step 1) or `NON-CORE-WIP` (deferred, not a launch blocker). The ~107 known failures are NON-CORE-WIP per the spec.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/launch-test-triage.md
git commit -m "docs(runbook): launch test triage — core green, non-core WIP deferred"
```

---

## Workstream D — Concierge Onboarding (operational runbook)

### Task D1: Test-salon provisioning checklist

**Files:**
- Create: `docs/runbooks/concierge-onboarding-test-salon.md`

- [ ] **Step 1: Write the provisioning checklist**

Concrete, ordered steps for onboarding the identified test salon:
- Create tenant row + owner `tenant_users` membership.
- Configure WhatsApp provider (Evolution/WAHA/Meta) — which provider, instance, webhook URL.
- Set Paystack: tenant `metadata.paystack_subaccount_code`, deposit percentage, currency NGN.
- Load services (name, duration, price, deposit %), staff, and staff_services.
- Set reminder timing + no-show window to match the salon's policy.
- Define the go-live smoke: send a real WhatsApp message → complete a booking → pay a real small (₦100) deposit → confirm reminder fires → confirm reservation in dashboard.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/concierge-onboarding-test-salon.md
git commit -m "docs(runbook): concierge onboarding checklist for launch test salon"
```

### Task D2: Live cutover + week-4 buffer

- [ ] **Step 1:** Execute `concierge-onboarding-test-salon.md` against the real salon (operational, human-run).
- [ ] **Step 2:** Run the go-live smoke (one real booking + real ₦100 Paystack deposit end-to-end). Record the reservation id + transaction reference.
- [ ] **Step 3:** Reserve remaining days for live-fire fixes from real traffic. Any bug found gets a failing test first (per TDD), then a fix.

---

## Self-Review

**Spec coverage:**
- Migration collisions documented, not auto-renumbered → A1, A2 ✓
- Core-path column audit / skip-risk → A1 ✓
- Paystack webhook signed/replay + deposit init hardened + idempotent → B1, B2 ✓
- Declined/abandoned deposit auto-cancels → B3 ✓
- End-to-end smoke test → C1 ✓
- Core-path green + triage → C2 ✓
- Test salon onboarded + live + real deposit → D1, D2 ✓
- Out-of-scope (Instagram/Stripe/self-serve/107 failures) → respected; no tasks touch them ✓

**Route-testing pattern (verified):** all route tests use the `createHttpHandler` contract proven in `src/__tests__/app/api/sias/ops.routes.test.ts` — real `NextRequest`, mocked Supabase factories (`@/lib/supabase/server` + `bearer-client`), assertions on `response.status` / `await response.json()`, and error *responses* (not rejections). The earlier ctx-passing pattern (from `stripe.test.ts`) was removed as a defect.

**Placeholder scan:** B3 Step 2 and C1 Step 1 intentionally defer exact assertions to discovered runtime values (the auto-cancel status strings; per-stage signatures) — marked "read first, then write concrete code" because guessing the swept status would be a worse failure than instructing discovery. All other steps carry full code.

**Type consistency:** `adminMock` / `bearerMock` / `makeSupabase` helpers are defined once per test file and reused; `handlePaymentSuccess` referenced with its real signature (`lifecycle.ts:1325`).
