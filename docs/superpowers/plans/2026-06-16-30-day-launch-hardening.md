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
- `src/__tests__/app/api/payments/paystack-webhook.test.ts` — webhook characterization tests (Workstream B)
- `src/__tests__/app/api/payments/deposits.test.ts` — deposit init tests (Workstream B)
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

The route under test already exists at `src/app/api/payments/webhook/route.ts` and `src/app/api/payments/deposits/route.ts`. These tests lock in current behavior so hardening changes don't regress it. Follow the existing mock pattern from `src/__tests__/app/api/payments/stripe.test.ts`.

### Task B1: Paystack webhook — reject unsigned requests

**Files:**
- Create: `src/__tests__/app/api/payments/paystack-webhook.test.ts`
- Test target: `src/app/api/payments/webhook/route.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import type { NextRequest } from 'next/server';
import { POST } from '@/app/api/payments/webhook/route';

const makeRequest = (body: unknown, headers: Record<string, string> = {}): NextRequest =>
  new Request('http://localhost:3000/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const makeCtx = (req: NextRequest) => ({
  request: req,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), insert: () => ({ select: async () => ({ data: [], error: null }) }) }) },
} as any);

describe('Paystack webhook signature gate', () => {
  it('rejects a request with no recognised signature header', async () => {
    const req = makeRequest({ provider: 'paystack', reference: 'ref_1', status: 'success' });
    await expect(POST(makeCtx(req) as any)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (characterization — behavior already exists)**

Run: `npx jest src/__tests__/app/api/payments/paystack-webhook.test.ts -t "rejects a request" `
Expected: PASS (the handler already throws when `signatureVerified` is false). If it FAILS, the signature gate has regressed — stop and investigate.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/app/api/payments/paystack-webhook.test.ts
git commit -m "test(payments): lock in Paystack webhook unsigned-request rejection"
```

### Task B2: Paystack webhook — valid signature, replay protection

**Files:**
- Modify: `src/__tests__/app/api/payments/paystack-webhook.test.ts`

- [ ] **Step 1: Add the valid-signature + replay tests**

```typescript
import crypto from 'crypto';

const sign = (body: unknown, secret: string) =>
  crypto.createHmac('sha512', secret).update(JSON.stringify(body)).digest('hex');

describe('Paystack webhook valid + replay', () => {
  const SECRET = 'sk_test_dummy';
  beforeAll(() => { process.env.PAYSTACK_SECRET_KEY = SECRET; });

  it('accepts a correctly signed webhook and returns ok', async () => {
    const body = { provider: 'paystack', reference: 'ref_ok', status: 'success' };
    const req = makeRequest(body, { 'x-paystack-signature': sign(body, SECRET) });
    const res = await POST(makeCtx(req) as any);
    expect(res).toMatchObject({ ok: true });
  });

  it('treats a duplicate webhook_events insert (23505) as a replay', async () => {
    const body = { provider: 'paystack', reference: 'ref_dup', status: 'success' };
    const ctx = {
      request: makeRequest(body, { 'x-paystack-signature': sign(body, SECRET) }),
      supabase: { from: (t: string) => t === 'webhook_events'
        ? ({ insert: () => ({ select: async () => ({ data: null, error: { code: '23505' } }) }) })
        : ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) },
    } as any;
    const res = await POST(ctx);
    expect(res).toMatchObject({ ok: true, replay: true });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/app/api/payments/paystack-webhook.test.ts`
Expected: PASS for both. If the replay test fails, the `webhook_events` unique constraint is the single point of replay protection — flag for Workstream A audit (Task A1 step 3).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/app/api/payments/paystack-webhook.test.ts
git commit -m "test(payments): lock in Paystack signed-accept + replay protection"
```

### Task B3: Deposit init — happy path + idempotent duplicate + cancelled reservation

**Files:**
- Create: `src/__tests__/app/api/payments/deposits.test.ts`
- Test target: `src/app/api/payments/deposits/route.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, it, expect, jest } from '@jest/globals';
import type { NextRequest } from 'next/server';

jest.mock('@/lib/paymentService', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    initializePayment: jest.fn(async () => ({
      success: true, transactionId: 'txn_1', authorizationUrl: 'https://paystack/redirect',
    })),
  })),
}));

import { POST } from '@/app/api/payments/deposits/route';

const makeReq = (body: unknown): NextRequest =>
  new Request('http://localhost:3000/api/payments/deposits', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as unknown as NextRequest;

// supabase mock that resolves tenant, reservation, and the existing-deposit check
const supa = (overrides: { reservationStatus?: string; existingDeposit?: any } = {}) => {
  const chain = (final: any) => ({
    select: () => chain(final), eq: () => chain(final), in: () => chain(final),
    single: async () => final, maybeSingle: async () => final,
  });
  return { from: (table: string) => {
    if (table === 'tenant_users') return chain({ data: { tenant_id: 'ten_1' } });
    if (table === 'reservations') return chain({ data: { id: 'res_1', status: overrides.reservationStatus ?? 'pending' } });
    if (table === 'transactions') return chain({ data: overrides.existingDeposit ?? null });
    if (table === 'tenants') return chain({ data: { metadata: {} } });
    return chain({ data: null });
  } };
};

const ctx = (body: unknown, sOverrides = {}) => ({
  request: makeReq(body), supabase: supa(sOverrides), user: { id: 'usr_1' },
} as any);

describe('deposit init', () => {
  const body = { amount: 10000, email: 'salon@test.com', reservationId: 'res_1' };

  it('initializes a Paystack deposit and returns the authorization URL', async () => {
    const res = await POST(ctx(body));
    expect(res).toMatchObject({ success: true, transactionId: 'txn_1', authorizationUrl: 'https://paystack/redirect' });
  });

  it('is idempotent — returns the existing deposit instead of creating a new one', async () => {
    const res = await POST(ctx(body, { existingDeposit: { id: 'txn_old', status: 'pending', provider_reference: 'r', raw: { provider_response: { authorizationUrl: 'https://old' } } } }));
    expect(res).toMatchObject({ duplicate: true, transactionId: 'txn_old' });
  });

  it('refuses a deposit for a cancelled reservation', async () => {
    await expect(POST(ctx(body, { reservationStatus: 'cancelled' }))).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest src/__tests__/app/api/payments/deposits.test.ts`
Expected: PASS for all three.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/app/api/payments/deposits.test.ts
git commit -m "test(payments): deposit init happy-path, idempotency, cancelled-guard"
```

### Task B4: Abandoned deposit → auto-cancel sweep

**Files:**
- Create test against: `src/app/api/jobs/auto-cancel-unconfirmed/route.ts`
- Add to: `src/__tests__/app/api/payments/deposits.test.ts` (or a new `auto-cancel.test.ts` if cleaner)

- [ ] **Step 1: Read the auto-cancel handler to learn its exact query + status values**

Run: `sed -n '1,80p' src/app/api/jobs/auto-cancel-unconfirmed/route.ts`
Note the status string it sweeps (e.g. `pending`/`unconfirmed`) and the time window. Use those exact values in the test below (replace `EXPECTED_STATUS` / `EXPECTED_WINDOW`).

- [ ] **Step 2: Write the test mirroring the handler's real query**

```typescript
// Assert: a reservation left in the unconfirmed/pending state past the window
// is transitioned to cancelled by the sweep. Mock supabase to return one stale
// reservation and assert an update to status='cancelled' is issued.
// Use the EXPECTED_STATUS / EXPECTED_WINDOW discovered in Step 1.
```

(Write the concrete assertions using the real handler export and status strings found in Step 1 — do not guess the status value.)

- [ ] **Step 3: Run + commit**

Run: `npx jest -t "auto-cancel"`
Expected: PASS

```bash
git add src/__tests__/app/api/payments/
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

Build this incrementally: add one stage, run, see it pass, then add the next. Reuse the supabase chain mock pattern from `deposits.test.ts`. Mock `getProviderClient` so no real WhatsApp/Paystack calls fire.

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
- Paystack deposit init → webhook → reconcile hardened + idempotent → B1, B2, B3 ✓
- Declined/abandoned deposit auto-cancels → B4 ✓
- End-to-end smoke test → C1 ✓
- Core-path green + triage → C2 ✓
- Test salon onboarded + live + real deposit → D1, D2 ✓
- Out-of-scope (Instagram/Stripe/self-serve/107 failures) → respected; no tasks touch them ✓

**Placeholder scan:** B4 Step 2 and C1 Step 1 intentionally defer exact assertions to discovered runtime values (status strings, stage signatures) — these are marked as "read first, then write concrete code" because guessing the status string would be a worse failure than instructing discovery. All other steps carry full code.

**Type consistency:** `makeReq`/`makeCtx`/`supa` chain-mock helpers are defined once per test file and reused; `handlePaymentSuccess` referenced with its real signature (`lifecycle.ts:1325`). Status value for auto-cancel is deliberately discovered in B4-S1 rather than hardcoded.
