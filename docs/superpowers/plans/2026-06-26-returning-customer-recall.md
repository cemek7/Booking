# Returning-Customer Context Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a returning WhatsApp customer messages, inject their tenant-scoped recall (last service, usual staff, last-visit recency + count, rebooking-due) into the front-desk AI prompt as soft hints, so replies feel personal.

**Architecture:** A focused `getCustomerRecall(admin, tenantId, phone)` reads the customer's past non-cancelled reservations (tenant-scoped) and returns a `CustomerRecall`. `grounding-service.getGroundingData` calls it for `conv.role==='customer'` with a phone, attaching `customerRecall` to `GroundingResult`; `context-builder.buildFrontDeskPrompt` renders a soft-hint "Returning customer" block. No schema changes.

**Tech Stack:** Next.js 16, TypeScript, Supabase admin client (PostgREST nested select), Jest with the queue-based Supabase mock from the v2 tests.

**Source spec:** `docs/superpowers/specs/2026-06-26-returning-customer-recall-design.md`

---

## Collision discipline (read first)

Build in an **isolated worktree** (via `superpowers:using-git-worktrees`) off the current `feat/instagram-channel` tip. `src/lib/ai/grounding-service.ts` and `src/lib/ai/context-builder.ts` are shared (recent AI-refactor) — one minimal, additive touch each; stage ONLY the named files, never `git add -A`. `src/lib/ai/customerRecall.ts` is new — collision-free. **The git index may hold a parallel session's staged batch — if `git diff --cached --name-only` is non-empty with files that aren't yours, do NOT commit; wait for it to clear.**

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/ai/customerRecall.ts` | `getCustomerRecall()` — the recall query unit |
| `src/lib/ai/grounding-service.ts` | add `customerRecall` to `GroundingResult` + call for customer role |
| `src/lib/ai/context-builder.ts` | render the soft-hint recall block in `buildFrontDeskPrompt` |

---

## Task 1: `getCustomerRecall` — the recall unit

**Files:** Create `src/lib/ai/customerRecall.ts`; Test `src/__tests__/lib/ai/customerRecall.test.ts`

- [ ] **Step 1: Write the failing test** (queue mock supports `.eq/.lt/.not/.order/.limit/.maybeSingle` + thenable terminal)

```typescript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getCustomerRecall } from '@/lib/ai/customerRecall';

type Resp = { data: unknown; error: unknown };
const responses: Resp[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function consume(): Resp { return responses.shift() ?? { data: null, error: null }; }
function makeChain(): any {
  const chain: any = {};
  ['select', 'eq', 'lt', 'not', 'order', 'limit'].forEach((m) => { chain[m] = () => chain; });
  chain.maybeSingle = async () => consume();
  chain.then = (f: any, r: any) => Promise.resolve().then(() => consume()).then(f, r);
  return chain;
}
const admin: any = { from: jest.fn(() => makeChain()) };
const recent = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
const old = new Date(Date.now() - 60 * 24 * 3600e3).toISOString();

describe('getCustomerRecall', () => {
  beforeEach(() => { responses.length = 0; jest.clearAllMocks(); });

  it('returns null for an unknown customer (no customers row)', async () => {
    pushDb(null); // customers lookup
    expect(await getCustomerRecall(admin, 't1', '+234800')).toBeNull();
  });

  it('returns null when the customer has no past visits', async () => {
    pushDb({ id: 'c1', last_visit: null }); // customer
    pushDb([]);                              // reservations
    expect(await getCustomerRecall(admin, 't1', '+234800')).toBeNull();
  });

  it('single visit → lastService set, usualStaff null, visitCount 1', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([{ start_at: recent, status: 'confirmed', service_id: 's1', tenant_staff_id: 'st1', services: { name: 'Trim', rebooking_interval_days: null } }]);
    const r = await getCustomerRecall(admin, 't1', '+234800');
    expect(r).toMatchObject({ lastService: 'Trim', usualStaff: null, visitCount: 1, rebookingDue: false });
  });

  it('≥2 visits to one staff → usualStaff named', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([
      { start_at: recent, status: 'confirmed', service_id: 's1', tenant_staff_id: 'st1', services: { name: 'Trim', rebooking_interval_days: null } },
      { start_at: old, status: 'completed', service_id: 's1', tenant_staff_id: 'st1', services: { name: 'Trim', rebooking_interval_days: null } },
    ]);
    pushDb({ name: 'Sarah' }); // tenant_users name for st1
    const r = await getCustomerRecall(admin, 't1', '+234800');
    expect(r).toMatchObject({ usualStaff: 'Sarah', visitCount: 2 });
  });

  it('favorite staff row gone → usualStaff null', async () => {
    pushDb({ id: 'c1', last_visit: recent });
    pushDb([
      { start_at: recent, status: 'confirmed', service_id: 's1', tenant_staff_id: 'st1', services: { name: 'Trim' } },
      { start_at: old, status: 'confirmed', service_id: 's1', tenant_staff_id: 'st1', services: { name: 'Trim' } },
    ]);
    pushDb(null); // tenant_users miss (staff left)
    const r = await getCustomerRecall(admin, 't1', '+234800');
    expect(r?.usualStaff).toBeNull();
  });

  it('rebookingDue true when last visit older than interval', async () => {
    pushDb({ id: 'c1', last_visit: old }); // 60 days ago
    pushDb([{ start_at: old, status: 'confirmed', service_id: 's1', tenant_staff_id: null, services: { name: 'Trim', rebooking_interval_days: 30 } }]);
    const r = await getCustomerRecall(admin, 't1', '+234800');
    expect(r?.rebookingDue).toBe(true);
  });

  it('fails quiet → null on query error', async () => {
    const throwing: any = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error('db'); } }) }) }) }) };
    expect(await getCustomerRecall(throwing, 't1', '+234800')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** (`NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/ai/customerRecall.test.ts`)
- [ ] **Step 3: Implement `src/lib/ai/customerRecall.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerRecall {
  lastService: string | null;
  usualStaff: string | null;
  lastVisitAt: string | null;
  visitCount: number;
  rebookingDue: boolean;
}

const EXCLUDED_STATUSES = ['cancelled', 'no_show', 'refunded', 'refund_pending'];
const DAY_MS = 24 * 60 * 60 * 1000;

interface VisitRow {
  start_at: string | null;
  status: string | null;
  service_id: string | null;
  tenant_staff_id: string | null;
  services:
    | { name?: string | null; rebooking_interval_days?: number | null }
    | Array<{ name?: string | null; rebooking_interval_days?: number | null }>
    | null;
}

// PostgREST nested select may return an object or a single-element array.
function svc(row: VisitRow) {
  const s = row.services;
  return Array.isArray(s) ? (s[0] ?? null) : (s ?? null);
}

/**
 * Tenant-scoped recall for a returning WhatsApp customer (keyed by phone → customer_id).
 * Returns null for unknown/new customers or on any error (recall is an enhancement).
 */
export async function getCustomerRecall(admin: SupabaseClient, tenantId: string, phone: string): Promise<CustomerRecall | null> {
  try {
    const { data: customer } = await admin
      .from('customers').select('id, last_visit').eq('tenant_id', tenantId).eq('phone', phone).maybeSingle();
    if (!customer?.id) return null;

    const { data: rows } = await admin
      .from('reservations')
      .select('start_at, status, service_id, tenant_staff_id, services(name, rebooking_interval_days)')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.id)
      .lt('start_at', new Date().toISOString())
      .not('status', 'in', `(${EXCLUDED_STATUSES.map((s) => `"${s}"`).join(',')})`)
      .order('start_at', { ascending: false })
      .limit(20);
    const visits = (rows ?? []) as VisitRow[];
    if (visits.length === 0) return null;

    const lastService = svc(visits[0])?.name ?? null;

    // usual staff = most-frequent non-null tenant_staff_id with ≥2 visits AND row still present
    const counts = new Map<string, number>();
    for (const v of visits) if (v.tenant_staff_id) counts.set(v.tenant_staff_id, (counts.get(v.tenant_staff_id) ?? 0) + 1);
    let favStaff: string | null = null, favCount = 0;
    for (const [id, c] of counts) if (c > favCount) { favCount = c; favStaff = id; }
    let usualStaff: string | null = null;
    if (favStaff && favCount >= 2) {
      const { data: staffRow } = await admin
        .from('tenant_users').select('name').eq('id', favStaff).eq('tenant_id', tenantId).maybeSingle();
      usualStaff = (staffRow?.name as string | undefined) ?? null;
    }

    const lastVisitAt = (customer.last_visit as string | null) ?? visits[0].start_at ?? null;
    const interval = svc(visits[0])?.rebooking_interval_days ?? null;
    const rebookingDue = !!(interval && lastVisitAt && Date.now() - Date.parse(lastVisitAt) >= interval * DAY_MS);

    return { lastService, usualStaff, lastVisitAt, visitCount: visits.length, rebookingDue };
  } catch (err) {
    console.warn('[customerRecall] getCustomerRecall failed', err);
    return null;
  }
}
```

- [ ] **Step 4: Run → PASS (7 tests)** — [ ] **Step 5: Commit** (`feat(recall): getCustomerRecall — tenant-scoped returning-customer signals`)

---

## Task 2: Wire recall into `getGroundingData`

**Files:** Modify `src/lib/ai/grounding-service.ts` (shared — stage only this file); Test `src/__tests__/lib/ai/grounding-recall.test.ts`

- [ ] **Step 1: Failing test** — mock `@/lib/ai/customerRecall` `getCustomerRecall` to return a sentinel; assert `getGroundingData` attaches it when `conv.role==='customer' && conv.phone_number`, and `null` (and does NOT call it) when `conv.role==='owner'` or `conv.phone_number==null`.

```typescript
import { getGroundingData } from '@/lib/ai/grounding-service';
import { getCustomerRecall } from '@/lib/ai/customerRecall';
jest.mock('@/lib/ai/customerRecall', () => ({ getCustomerRecall: jest.fn() }));
// also mock @/lib/supabase/server admin so getGroundingData's other queries resolve to empty
// (follow the existing grounding-service test's mock setup if present)

it('attaches customerRecall for a customer with a phone', async () => {
  (getCustomerRecall as jest.Mock).mockResolvedValue({ lastService: 'Trim', usualStaff: 'Sarah', lastVisitAt: null, visitCount: 3, rebookingDue: false });
  const res = await getGroundingData('t1', 'hi', { role: 'customer', phone_number: '+234800' } as any, { intent: 'book' } as any);
  expect(res.customerRecall).toMatchObject({ lastService: 'Trim' });
});
it('skips recall for owners (null, not called)', async () => {
  (getCustomerRecall as jest.Mock).mockClear();
  const res = await getGroundingData('t1', 'hi', { role: 'owner', phone_number: '+234999' } as any, { intent: 'owner_query' } as any);
  expect(res.customerRecall ?? null).toBeNull();
  expect(getCustomerRecall).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — in `grounding-service.ts`:
  1. Add `import { getCustomerRecall, type CustomerRecall } from './customerRecall';`
  2. Add to the `GroundingResult` interface: `customerRecall?: CustomerRecall | null;`
  3. Before the final `return {...}`, compute:
     ```typescript
     const customerRecall = conv.role === 'customer' && conv.phone_number
       ? await getCustomerRecall(supabaseAdmin, tenantId, conv.phone_number)
       : null;
     ```
  4. Add `customerRecall,` to the returned object.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(recall): attach customerRecall to grounding for customer role`)

---

## Task 3: Render the soft-hint block in `buildFrontDeskPrompt`

**Files:** Modify `src/lib/ai/context-builder.ts` (shared — stage only this file); Test `src/__tests__/lib/ai/context-builder-recall.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { buildFrontDeskPrompt } from '@/lib/ai/context-builder';
const base = { message: 'hi', conv: { role: 'customer' } as any, userRole: 'customer' as const, retryContext: null };
const grounding = (recall: any) => ({ route: { intent: 'book' }, tenant: { name: 'Acme' }, services: [], staff: [], availableSlots: [], bookings: [], ownerSummary: null, timezone: 'UTC', customerRecall: recall } as any);

it('renders a Returning customer block with soft-hint framing when recall present', () => {
  const out = buildFrontDeskPrompt({ ...base, grounding: grounding({ lastService: 'Trim', usualStaff: 'Sarah', lastVisitAt: new Date(Date.now()-35*24*3600e3).toISOString(), visitCount: 6, rebookingDue: true }) });
  expect(out).toMatch(/Returning customer/i);
  expect(out).toMatch(/Trim/); expect(out).toMatch(/Sarah/);
  expect(out).toMatch(/confirm what they actually want|don.t assume/i);
});
it('omits the block when recall is null', () => {
  const out = buildFrontDeskPrompt({ ...base, grounding: grounding(null) });
  expect(out).not.toMatch(/Returning customer/i);
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — in `context-builder.ts`, add a `humanizeSince(iso)` helper (returns e.g. "about 5 weeks ago") and a `recallBlock`:
```typescript
function humanizeSince(iso: string | null): string {
  if (!iso) return 'a while';
  const days = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400000));
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  if (weeks < 9) return `about ${weeks} weeks`;
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? '' : 's'}`;
}
// build the block:
const r = grounding.customerRecall;
const recallBlock = r
  ? `Returning customer — last had ${r.lastService ?? 'a service'}${r.usualStaff ? ` with ${r.usualStaff}` : ''} ${humanizeSince(r.lastVisitAt)} ago (${r.visitCount} visit${r.visitCount === 1 ? '' : 's'})${r.rebookingDue ? '; may be due for a rebook' : ''}. Greet them warmly and you may offer their usual, but confirm what they actually want — don't assume. If their usual staff isn't available, offer alternatives.\n`
  : '';
```
Insert `recallBlock` into the assembled prompt string (alongside `servicesBlock`/`staffBlock`, only meaningful for the customer path).
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(recall): soft-hint Returning-customer block in front-desk prompt`)

---

## Task 4: Full-suite + verification

- [ ] **Step 1:** `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/ai/customerRecall.test.ts src/__tests__/lib/ai/grounding-recall.test.ts src/__tests__/lib/ai/context-builder-recall.test.ts` → green.
- [ ] **Step 2:** `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` → no NEW errors in the recall files.
- [ ] **Step 3:** Verify against the live client: the `services(...)` nested select returns the expected object/array shape (the `svc()` helper handles both) and `customers.phone` is the right column (fall back to `phone_number` if the live column differs).
- [ ] **Step 4:** Manual smoke (optional): a returning WhatsApp customer message produces a prompt containing the "Returning customer" line; an Instagram message (no phone) does not.

---

## Final: land the branch

Per `superpowers:finishing-a-development-branch` — once Tasks 1–4 are green, coordinate a clean FF of `feat/instagram-channel` during a parallel-session pause (same protocol as prior specs). Shared touches (`grounding-service.ts`, `context-builder.ts`) may need a quick rebase auto-merge.

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| Unit 1 `getCustomerRecall` (visit set, usual staff, recency, rebooking-due) | 1 |
| Unit 2 grounding integration (customer-role + phone gate) | 2 |
| Unit 3 prompt soft-hint block | 3 |
| Multi-tenant scoping (#4) | 1 (tenant_id filters) |
| WhatsApp-only / IG limit | 2 (phone_number gate) |
| Verification | 4 |

**Deferred (documented):** "rebook your usual" shortcut; Instagram recall (no phone key); cross-tenant unification. No schema changes.
