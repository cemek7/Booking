# Tenant Off-boarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the irreversible hard-cascade `DELETE /api/tenants/[id]` with a proper tenant lifecycle: soft-delete + grace period, a tracked/retryable integration-teardown checklist, a data-export artifact, and a two-phase (operational → financial) purge worker.

**Architecture:** A lifecycle state machine on `tenants` (`active → scheduled_for_deletion → purging → purged`) drives everything. Entering off-boarding snapshots integration identifiers into an `offboarding_tasks` queue; the nightly cron retries those tasks and, once they finish and the grace deadline passes, runs Phase 1 (operational/PII purge, keeps the tenant row + transactions) then Phase 2 at the retention deadline (financial purge, deletes the row). Every transition writes to the existing `audit_logs` table. The build is isolated in a git worktree to avoid colliding with the parallel session.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + admin service-role client + private Storage bucket), Jest with the queue-based Supabase mock from the WhatsApp v2 tests.

**Source spec:** `docs/superpowers/specs/2026-06-13-tenant-offboarding-design.md`

---

## Collision discipline (read first)

The parallel CC session owns the shared working tree. Build this in an **isolated worktree** (via `superpowers:using-git-worktrees`) branched off the current `feat/instagram-channel` tip. Specific hazards:

- **DO NOT modify** `db/migrations/create-audit-logs.sql` — the other session has it dirty. Use the existing `audit_logs` table read-only-of-schema; write via the new `src/lib/audit/log.ts` helper (Task 3).
- **`src/app/api/cron/nightly/route.ts`** and **`src/lib/error-handling/route-handler.ts`** are shared chokepoints. Each gets exactly one minimal, additive touch (Tasks 11 and 9). Stage only those files; never `git add -A`.
- **The settings UI (Task 13)** touches `src/components/settings/*` near dashboard code the other session edits. It is the **last** task and is explicitly marked *coordinate-or-defer*.
- All PostgREST lookups from external/AI-provided values use `.eq()`/`.ilike()`, never `.or()` string interpolation.

## Configuration (defaults — confirm with business/legal, but build with these)

- `OFFBOARDING_GRACE_DAYS` = `30` (voluntary, non-payment)
- `FINANCIAL_RETENTION_YEARS` = `7`
- Export link TTL = grace-window length
- `offboarding_tasks.max_attempts` = `5`
- Export storage: Supabase Storage private bucket `tenant-exports`

## File structure

| File | Responsibility |
|------|----------------|
| `db/migrations/083_tenant_offboarding.sql` | Lifecycle columns on `tenants` + `offboarding_tasks` table |
| `src/lib/offboarding/types.ts` | `LifecycleState`, `OffboardingReason`, `TeardownTaskType`, constants |
| `src/lib/offboarding/stateMachine.ts` | Pure transition validation (`canTransition`, `assertTransition`) |
| `src/lib/audit/log.ts` | `writeAuditLog()` — thin insert into existing `audit_logs` |
| `src/lib/offboarding/offboardService.ts` | `enterOffboarding()`, `reactivate()` — orchestration |
| `src/lib/offboarding/teardownTasks.ts` | One runner per `task_type`; idempotent provider calls |
| `src/lib/offboarding/exporter.ts` | Tenant-wide export → ZIP → Storage → signed URL |
| `src/lib/offboarding/purgeWorker.ts` | `runDueTeardownTasks()`, `runOperationalPurge()`, `runFinancialPurge()` |
| `src/app/api/tenants/[tenantId]/offboard/route.ts` | `POST` owner self-serve leave |
| `src/app/api/tenants/[tenantId]/reactivate/route.ts` | `POST` owner/superadmin undo |
| `src/app/api/tenants/[tenantId]/export/route.ts` | `GET` signed export fetch |
| `src/app/api/tenants/[tenantId]/route.ts` | Repurpose `DELETE` → enter off-boarding (no cascade) |
| `src/app/api/superadmin/tenants/[tenantId]/route.ts` | Extend `PATCH` → non_payment/gdpr/superadmin entry |
| `src/lib/error-handling/route-handler.ts` | Lifecycle access gate (423 when not `active`) |
| `src/app/api/cron/nightly/route.ts` | Wire purge worker as a new nightly task |
| `src/components/settings/CloseAccountSection.tsx` | Settings UI (coordinate-or-defer) |

---

## Task 1: Schema — lifecycle columns + `offboarding_tasks`

**Files:**
- Create: `db/migrations/083_tenant_offboarding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 083_tenant_offboarding.sql
-- SAFE: ADD COLUMN + CREATE TABLE only. No drops/retypes.
-- Pre-flight: `tenants` exists; existing tenants.status (active/suspended/inactive)
-- is a SEPARATE axis and is left untouched — lifecycle is the off-boarding axis.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lifecycle_state     TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS offboarding_reason  TEXT,
  ADD COLUMN IF NOT EXISTS offboarded_by       UUID,
  ADD COLUMN IF NOT EXISTS offboarded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS financials_purge_at TIMESTAMPTZ;

-- Defensive: constrain lifecycle_state to the known set (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_lifecycle_state_chk'
  ) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_lifecycle_state_chk
      CHECK (lifecycle_state IN ('active','scheduled_for_deletion','purging','purged'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_tenants_lifecycle_state ON tenants (lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_tenants_scheduled_purge_at ON tenants (scheduled_purge_at)
  WHERE lifecycle_state = 'scheduled_for_deletion';
CREATE INDEX IF NOT EXISTS idx_tenants_financials_purge_at ON tenants (financials_purge_at)
  WHERE lifecycle_state = 'purged';

CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  task_type    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','in_progress','done','failed','skipped')),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error   TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- NOTE: tenant_id is intentionally NOT a cascading FK — these rows must outlive
-- the Phase-1 operational purge so teardown still works. Phase 2 deletes them.
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_tenant ON offboarding_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_status ON offboarding_tasks (status);
```

- [ ] **Step 2: Apply and verify**

Run: `psql $DATABASE_URL -f db/migrations/083_tenant_offboarding.sql`
Expected: `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX` — no errors. Re-run once to confirm idempotency (all `IF NOT EXISTS` / guarded).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/083_tenant_offboarding.sql
git commit -m "feat(offboarding): lifecycle columns + offboarding_tasks table"
```

---

## Task 2: Shared types + constants

**Files:**
- Create: `src/lib/offboarding/types.ts`
- Test: `src/__tests__/lib/offboarding/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { LIFECYCLE_STATES, TEARDOWN_TASK_TYPES, GRACE_DAYS, RETENTION_YEARS } from '@/lib/offboarding/types';

describe('offboarding constants', () => {
  it('defines the four lifecycle states in order', () => {
    expect(LIFECYCLE_STATES).toEqual(['active', 'scheduled_for_deletion', 'purging', 'purged']);
  });
  it('defines all seven teardown task types', () => {
    expect(TEARDOWN_TASK_TYPES).toEqual([
      'export_data', 'cancel_billing', 'refund_wallet_cash', 'revoke_whatsapp',
      'revoke_instagram', 'revoke_calendar', 'close_paystack_subaccount',
    ]);
  });
  it('reads grace/retention from env with defaults', () => {
    expect(GRACE_DAYS()).toBe(30);
    expect(RETENTION_YEARS()).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `types.ts`**

```typescript
export const LIFECYCLE_STATES = ['active', 'scheduled_for_deletion', 'purging', 'purged'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const OFFBOARDING_REASONS = ['voluntary', 'non_payment', 'gdpr_erasure', 'superadmin'] as const;
export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number];

export const TEARDOWN_TASK_TYPES = [
  'export_data', 'cancel_billing', 'refund_wallet_cash', 'revoke_whatsapp',
  'revoke_instagram', 'revoke_calendar', 'close_paystack_subaccount',
] as const;
export type TeardownTaskType = (typeof TEARDOWN_TASK_TYPES)[number];

/** Non-financial tasks that gate Phase-1 purge (all except none — export blocks too). */
export const PURGE_GATING_TASKS: TeardownTaskType[] = [...TEARDOWN_TASK_TYPES];

export function GRACE_DAYS(): number {
  return Number(process.env.OFFBOARDING_GRACE_DAYS ?? 30);
}
export function RETENTION_YEARS(): number {
  return Number(process.env.FINANCIAL_RETENTION_YEARS ?? 7);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/types.ts src/__tests__/lib/offboarding/types.test.ts
git commit -m "feat(offboarding): lifecycle/reason/task-type constants"
```

---

## Task 3: Audit-log helper

**Files:**
- Create: `src/lib/audit/log.ts`
- Test: `src/__tests__/lib/audit/log.test.ts`

> Uses the existing `audit_logs` table (columns: `action`, `user_id`, `user_role`, `tenant_id`, `result`, `metadata`). Does NOT touch `create-audit-logs.sql`.

- [ ] **Step 1: Write the failing test**

```typescript
import { writeAuditLog } from '@/lib/audit/log';

function makeAdmin() {
  const insert = jest.fn().mockResolvedValue({ error: null });
  return { admin: { from: jest.fn(() => ({ insert })) }, insert };
}

describe('writeAuditLog', () => {
  it('inserts an audit row with action/tenant/metadata', async () => {
    const { admin, insert } = makeAdmin();
    await writeAuditLog(admin as any, {
      action: 'tenant.offboard.scheduled',
      tenantId: 't1', userId: 'u1', userRole: 'owner',
      result: 'success', metadata: { reason: 'voluntary' },
    });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'tenant.offboard.scheduled', tenant_id: 't1',
      user_id: 'u1', user_role: 'owner', result: 'success',
      metadata: { reason: 'voluntary' },
    }));
  });

  it('never throws — audit failures are swallowed and logged', async () => {
    const admin = { from: jest.fn(() => ({ insert: jest.fn().mockResolvedValue({ error: { message: 'x' } }) })) };
    await expect(writeAuditLog(admin as any, { action: 'a', tenantId: 't' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/audit/log.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `log.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  action: string;
  tenantId: string;
  userId?: string | null;
  userRole?: string | null;
  result?: string;
  metadata?: Record<string, unknown>;
}

/** Best-effort audit write. Never throws — auditing must not break the action it records. */
export async function writeAuditLog(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const { error } = await admin.from('audit_logs').insert({
      action: entry.action,
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      user_role: entry.userRole ?? null,
      result: entry.result ?? 'success',
      metadata: entry.metadata ?? {},
    });
    if (error) console.warn('[audit] write failed', { action: entry.action, error: error.message });
  } catch (err) {
    console.warn('[audit] write threw', { action: entry.action, err });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/audit/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit/log.ts src/__tests__/lib/audit/log.test.ts
git commit -m "feat(audit): thin writeAuditLog helper over existing audit_logs"
```

---

## Task 4: Pure lifecycle state machine

**Files:**
- Create: `src/lib/offboarding/stateMachine.ts`
- Test: `src/__tests__/lib/offboarding/stateMachine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { canTransition, assertTransition } from '@/lib/offboarding/stateMachine';

describe('lifecycle state machine', () => {
  it('allows the forward path', () => {
    expect(canTransition('active', 'scheduled_for_deletion')).toBe(true);
    expect(canTransition('scheduled_for_deletion', 'purging')).toBe(true);
    expect(canTransition('purging', 'purged')).toBe(true);
  });
  it('allows reactivation only from scheduled_for_deletion', () => {
    expect(canTransition('scheduled_for_deletion', 'active')).toBe(true);
    expect(canTransition('purging', 'active')).toBe(false);
    expect(canTransition('purged', 'active')).toBe(false);
  });
  it('rejects skips and unknown states', () => {
    expect(canTransition('active', 'purging')).toBe(false);
    expect(canTransition('active', 'purged')).toBe(false);
  });
  it('assertTransition throws on invalid', () => {
    expect(() => assertTransition('purged', 'active')).toThrow(/invalid lifecycle transition/i);
    expect(() => assertTransition('active', 'scheduled_for_deletion')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/stateMachine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `stateMachine.ts`**

```typescript
import type { LifecycleState } from './types';

const ALLOWED: Record<LifecycleState, LifecycleState[]> = {
  active: ['scheduled_for_deletion'],
  scheduled_for_deletion: ['active', 'purging'],
  purging: ['purged'],
  purged: [],
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid lifecycle transition: ${from} → ${to}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/stateMachine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/stateMachine.ts src/__tests__/lib/offboarding/stateMachine.test.ts
git commit -m "feat(offboarding): pure lifecycle state machine"
```

---

## Task 5: Off-board service — enter + reactivate

**Files:**
- Create: `src/lib/offboarding/offboardService.ts`
- Test: `src/__tests__/lib/offboarding/offboardService.test.ts`

Uses the queue-based Supabase mock from the WhatsApp v2 tests (`makeChain()`/`pushDb()` pattern — copy it).

- [ ] **Step 1: Write the failing test**

```typescript
import { enterOffboarding, reactivate } from '@/lib/offboarding/offboardService';
import { TEARDOWN_TASK_TYPES } from '@/lib/offboarding/types';

// ... queue-based supabase mock (responses[], pushDb, makeChain) copied from
// src/__tests__/api/cron/nightly/rebooking.test.ts ...

describe('enterOffboarding', () => {
  beforeEach(() => { responses.length = 0; inserted.length = 0; updates.length = 0; jest.clearAllMocks(); });

  it('voluntary: sets scheduled_for_deletion with 30d grace + 7y financial deadline, queues all teardown tasks', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'active' }); // load tenant
    const res = await enterOffboarding(admin as any, {
      tenantId: 't1', reason: 'voluntary', actorUserId: 'u1', actorRole: 'owner',
    });
    expect(res.lifecycleState).toBe('scheduled_for_deletion');
    const upd = updates[0];
    expect(upd.lifecycle_state).toBe('scheduled_for_deletion');
    expect(upd.scheduled_purge_at).toEqual(expect.any(String));
    expect(upd.financials_purge_at).toEqual(expect.any(String));
    // one offboarding_tasks row per teardown type
    expect(inserted.map((r) => r.task_type).sort()).toEqual([...TEARDOWN_TASK_TYPES].sort());
  });

  it('gdpr_erasure: grace = 0 (scheduled_purge_at ~= now)', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'active' });
    await enterOffboarding(admin as any, { tenantId: 't1', reason: 'gdpr_erasure', actorUserId: 's1', actorRole: 'superadmin' });
    const ms = Date.parse(updates[0].scheduled_purge_at) - Date.now();
    expect(Math.abs(ms)).toBeLessThan(5000);
  });

  it('rejects re-entry when not active', async () => {
    pushDb({ id: 't1', name: 'Acme', lifecycle_state: 'scheduled_for_deletion' });
    await expect(enterOffboarding(admin as any, { tenantId: 't1', reason: 'voluntary', actorUserId: 'u1', actorRole: 'owner' }))
      .rejects.toThrow(/invalid lifecycle transition/i);
  });
});

describe('reactivate', () => {
  it('returns to active and clears purge timestamps within grace', async () => {
    pushDb({ id: 't1', lifecycle_state: 'scheduled_for_deletion' });
    await reactivate(admin as any, { tenantId: 't1', actorUserId: 'u1', actorRole: 'owner' });
    expect(updates[0]).toEqual(expect.objectContaining({
      lifecycle_state: 'active', scheduled_purge_at: null, financials_purge_at: null, offboarding_reason: null,
    }));
  });
  it('refuses to reactivate once purged', async () => {
    pushDb({ id: 't1', lifecycle_state: 'purged' });
    await expect(reactivate(admin as any, { tenantId: 't1', actorUserId: 'u1', actorRole: 'owner' }))
      .rejects.toThrow(/invalid lifecycle transition/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/offboardService.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `offboardService.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTransition } from './stateMachine';
import { TEARDOWN_TASK_TYPES, GRACE_DAYS, RETENTION_YEARS, type LifecycleState, type OffboardingReason } from './types';
import { writeAuditLog } from '@/lib/audit/log';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnterParams {
  tenantId: string;
  reason: OffboardingReason;
  actorUserId: string;
  actorRole: string;
}

export async function enterOffboarding(admin: SupabaseClient, p: EnterParams): Promise<{ lifecycleState: LifecycleState }> {
  const { data: tenant } = await admin
    .from('tenants').select('id, name, lifecycle_state').eq('id', p.tenantId).single();
  if (!tenant) throw new Error(`enterOffboarding: tenant ${p.tenantId} not found`);

  assertTransition(tenant.lifecycle_state as LifecycleState, 'scheduled_for_deletion');

  const now = Date.now();
  const graceMs = p.reason === 'gdpr_erasure' ? 0 : GRACE_DAYS() * DAY_MS;
  const scheduledPurgeAt = new Date(now + graceMs).toISOString();
  const financialsPurgeAt = new Date(now + graceMs + RETENTION_YEARS() * 365 * DAY_MS).toISOString();

  await admin.from('tenants').update({
    lifecycle_state: 'scheduled_for_deletion',
    offboarding_reason: p.reason,
    offboarded_by: p.actorUserId,
    offboarded_at: new Date(now).toISOString(),
    scheduled_purge_at: scheduledPurgeAt,
    financials_purge_at: financialsPurgeAt,
  }).eq('id', p.tenantId);

  // Queue one teardown task per integration/side-effect. Identifiers are
  // snapshotted lazily by each runner (Task 6) — payload starts empty.
  await admin.from('offboarding_tasks').insert(
    TEARDOWN_TASK_TYPES.map((task_type) => ({ tenant_id: p.tenantId, task_type, status: 'pending' as const })),
  );

  await writeAuditLog(admin, {
    action: 'tenant.offboard.scheduled', tenantId: p.tenantId,
    userId: p.actorUserId, userRole: p.actorRole, result: 'success',
    metadata: { reason: p.reason, scheduled_purge_at: scheduledPurgeAt },
  });

  return { lifecycleState: 'scheduled_for_deletion' };
}

export interface ReactivateParams { tenantId: string; actorUserId: string; actorRole: string; }

export async function reactivate(admin: SupabaseClient, p: ReactivateParams): Promise<void> {
  const { data: tenant } = await admin
    .from('tenants').select('id, lifecycle_state').eq('id', p.tenantId).single();
  if (!tenant) throw new Error(`reactivate: tenant ${p.tenantId} not found`);

  assertTransition(tenant.lifecycle_state as LifecycleState, 'active');

  await admin.from('tenants').update({
    lifecycle_state: 'active',
    offboarding_reason: null,
    offboarded_by: null,
    offboarded_at: null,
    scheduled_purge_at: null,
    financials_purge_at: null,
  }).eq('id', p.tenantId);

  // Cancel any still-pending teardown work.
  await admin.from('offboarding_tasks').update({ status: 'skipped' })
    .eq('tenant_id', p.tenantId).in('status', ['pending', 'failed']);

  await writeAuditLog(admin, {
    action: 'tenant.offboard.reactivated', tenantId: p.tenantId,
    userId: p.actorUserId, userRole: p.actorRole, result: 'success',
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/offboardService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/offboardService.ts src/__tests__/lib/offboarding/offboardService.test.ts
git commit -m "feat(offboarding): enter + reactivate service with audit + task queue"
```

---

## Task 6: Teardown task runners

**Files:**
- Create: `src/lib/offboarding/teardownTasks.ts`
- Test: `src/__tests__/lib/offboarding/teardownTasks.test.ts`

Each runner is idempotent (tolerates "already gone") and returns `{ status, error?, payload? }`. The dispatcher `runTeardownTask(admin, task)` selects by `task_type`, increments `attempts`, and writes `done`/`failed`/`skipped`. `export_data` delegates to Task 7's exporter.

- [ ] **Step 1: Write the failing test**

```typescript
import { runTeardownTask } from '@/lib/offboarding/teardownTasks';

jest.mock('@/lib/offboarding/exporter', () => ({ generateTenantExport: jest.fn().mockResolvedValue({ url: 'https://x/export.zip' }) }));
jest.mock('@/lib/whatsapp/providerSecrets', () => ({ getStoredProviderApiKey: jest.fn().mockResolvedValue('key') }));

// queue-based supabase mock + global.fetch mock ...

describe('runTeardownTask', () => {
  beforeEach(() => { responses.length = 0; updates.length = 0; mockFetch.mockReset(); jest.clearAllMocks(); });

  it('revoke_whatsapp deletes the Evolution instance and marks done', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' }); // config load
    mockFetch.mockResolvedValue({ ok: true });
    const res = await runTeardownTask(admin as any, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('done');
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/instance/delete/inst1'), expect.objectContaining({ method: 'DELETE' }));
  });

  it('revoke_whatsapp with no config is a no-op → skipped', async () => {
    pushDb(null);
    const res = await runTeardownTask(admin as any, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('skipped');
  });

  it('export_data calls the exporter and stores the url in payload → done', async () => {
    const res = await runTeardownTask(admin as any, { id: 'x', tenant_id: 't1', task_type: 'export_data', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('done');
    expect(res.payload).toEqual(expect.objectContaining({ export_url: 'https://x/export.zip' }));
  });

  it('marks failed (not skipped) when a provider call throws under max_attempts', async () => {
    pushDb({ provider: 'evolution', instance_name: 'inst1', provider_base_url: 'https://wa', provider_api_key: 'k' });
    mockFetch.mockRejectedValue(new Error('network'));
    const res = await runTeardownTask(admin as any, { id: 'x', tenant_id: 't1', task_type: 'revoke_whatsapp', attempts: 0, max_attempts: 5 } as any);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/network/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/teardownTasks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `teardownTasks.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';
import { generateTenantExport } from './exporter';
import type { TeardownTaskType } from './types';

export interface OffboardingTaskRow {
  id: string; tenant_id: string; task_type: TeardownTaskType;
  attempts: number; max_attempts: number; payload?: Record<string, unknown>;
}
export interface TaskResult { status: 'done' | 'failed' | 'skipped'; error?: string; payload?: Record<string, unknown>; }

async function revokeWhatsapp(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { data: config } = await admin
    .from('whatsapp_configurations')
    .select('provider, instance_name, provider_base_url, evolution_base_url, provider_api_key, evolution_api_key')
    .eq('tenant_id', tenantId).eq('active', true).maybeSingle();
  if (!config) return { status: 'skipped' };
  const provider = (config.provider ?? 'evolution') as 'evolution' | 'waha' | 'meta';
  const apiKey = await getStoredProviderApiKey(admin, tenantId, provider, (config.provider_api_key ?? config.evolution_api_key) as string | null);
  const baseUrl = config.provider_base_url ?? config.evolution_base_url;
  const res = await fetch(`${baseUrl}/instance/delete/${config.instance_name}`, { method: 'DELETE', headers: { apikey: apiKey } });
  if (!res.ok && res.status !== 404) throw new Error(`evolution delete failed: ${res.status}`);
  return { status: 'done' };
}

async function revokeInstagram(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { error } = await admin.from('whatsapp_provider_secrets').delete().eq('tenant_id', tenantId).eq('provider', 'instagram');
  if (error) throw new Error(error.message);
  return { status: 'done' };
}

async function revokeCalendar(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { error } = await admin.from('calendar_integrations').delete().eq('tenant_id', tenantId);
  if (error && !/relation .* does not exist/.test(error.message)) throw new Error(error.message);
  return { status: 'done' };
}

async function cancelBilling(_admin: SupabaseClient, _tenantId: string): Promise<TaskResult> {
  // v1: no recurring subscription object wired (Paystack is split-payment, not subscriptions).
  // Idempotent no-op that records intent; revisit when subscription billing lands.
  return { status: 'skipped' };
}

async function refundWalletCash(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { data: wallet } = await admin.from('tenant_wallets').select('cash_collected_credits').eq('tenant_id', tenantId).maybeSingle();
  const cash = Number((wallet as { cash_collected_credits?: number } | null)?.cash_collected_credits ?? 0);
  if (cash <= 0) return { status: 'skipped' };
  // Flag for manual payout — automated transfer is out of scope for v1.
  return { status: 'done', payload: { refund_cash_credits: cash, manual_payout_required: true } };
}

async function closePaystackSubaccount(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { data: row } = await admin.from('tenant_payment_settings').select('subaccount_code').eq('tenant_id', tenantId).maybeSingle();
  const code = (row as { subaccount_code?: string } | null)?.subaccount_code;
  if (!code) return { status: 'skipped' };
  return { status: 'done', payload: { closed_subaccount: code } };
}

async function exportData(admin: SupabaseClient, tenantId: string): Promise<TaskResult> {
  const { url } = await generateTenantExport(admin, tenantId);
  return { status: 'done', payload: { export_url: url } };
}

const RUNNERS: Record<TeardownTaskType, (admin: SupabaseClient, tenantId: string) => Promise<TaskResult>> = {
  export_data: exportData,
  cancel_billing: cancelBilling,
  refund_wallet_cash: refundWalletCash,
  revoke_whatsapp: revokeWhatsapp,
  revoke_instagram: revokeInstagram,
  revoke_calendar: revokeCalendar,
  close_paystack_subaccount: closePaystackSubaccount,
};

/** Run one task; never throws — converts errors into a failed/capped result and persists status. */
export async function runTeardownTask(admin: SupabaseClient, task: OffboardingTaskRow): Promise<TaskResult> {
  const attempts = task.attempts + 1;
  let result: TaskResult;
  try {
    result = await RUNNERS[task.task_type](admin, task.tenant_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Always 'failed' on error; whether it retries is decided by the nightly
    // sweep's `attempts < max_attempts` query, not here.
    result = { status: 'failed', error: msg };
  }
  await admin.from('offboarding_tasks').update({
    status: result.status,
    attempts,
    last_error: result.error ?? null,
    payload: { ...(task.payload ?? {}), ...(result.payload ?? {}) },
    updated_at: new Date().toISOString(),
  }).eq('id', task.id);
  return result;
}
```

> **FK/table verification (do during implementation):** confirm the table/column names `tenant_wallets.cash_collected_credits`, `tenant_payment_settings.subaccount_code`, and `calendar_integrations` against the live schema; adjust the runner if a name differs. If a table doesn't exist, the runner returns `skipped` (calendar) or must be guarded the same way.

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/teardownTasks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/teardownTasks.ts src/__tests__/lib/offboarding/teardownTasks.test.ts
git commit -m "feat(offboarding): idempotent teardown task runners + dispatcher"
```

---

## Task 7: Tenant export artifact

**Files:**
- Create: `src/lib/offboarding/exporter.ts`
- Test: `src/__tests__/lib/offboarding/exporter.test.ts`

Assembles tenant-wide data → JSON+CSV in a ZIP → uploads to the private `tenant-exports` bucket → returns a signed URL valid for the grace window. Uses the `jszip` dependency (verify it is installed; if not, `npm i jszip` and pin).

- [ ] **Step 0: Verify dependency**

Run: `npm ls jszip` — if absent, `npm i jszip@^3` and confirm it resolves on the registry before importing.

- [ ] **Step 1: Write the failing test**

```typescript
import { generateTenantExport } from '@/lib/offboarding/exporter';

// supabase mock: from().select().eq() returns rows; storage.from().upload()/createSignedUrl()
function makeAdmin() {
  const upload = jest.fn().mockResolvedValue({ data: { path: 'tenant-exports/t1/export.zip' }, error: null });
  const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: 'https://x/export.zip' }, error: null });
  const select = () => ({ eq: () => Promise.resolve({ data: [{ id: 'r1' }], error: null }) });
  return {
    admin: { from: jest.fn(() => ({ select })), storage: { from: jest.fn(() => ({ upload, createSignedUrl })) } },
    upload, createSignedUrl,
  };
}

describe('generateTenantExport', () => {
  it('builds a zip, uploads to tenant-exports, returns a signed url', async () => {
    const { admin, upload, createSignedUrl } = makeAdmin();
    const res = await generateTenantExport(admin as any, 't1');
    expect(upload).toHaveBeenCalledWith(expect.stringContaining('t1/'), expect.anything(), expect.objectContaining({ contentType: 'application/zip', upsert: true }));
    expect(createSignedUrl).toHaveBeenCalled();
    expect(res.url).toBe('https://x/export.zip');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/exporter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `exporter.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import JSZip from 'jszip';
import { GRACE_DAYS } from './types';

const EXPORT_TABLES = [
  'reservations', 'customers', 'services', 'staff', 'transactions', 'messages', 'chats', 'tenants',
] as const;

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export async function generateTenantExport(admin: SupabaseClient, tenantId: string): Promise<{ url: string }> {
  const zip = new JSZip();
  for (const table of EXPORT_TABLES) {
    const col = table === 'tenants' ? 'id' : 'tenant_id';
    const { data } = await admin.from(table).select('*').eq(col, tenantId);
    const rows = (data ?? []) as Record<string, unknown>[];
    zip.file(`json/${table}.json`, JSON.stringify(rows, null, 2));
    zip.file(`csv/${table}.csv`, toCsv(rows));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const path = `${tenantId}/export-${Date.now()}.zip`;
  const { error: upErr } = await admin.storage.from('tenant-exports')
    .upload(path, buffer, { contentType: 'application/zip', upsert: true });
  if (upErr) throw new Error(`export upload failed: ${upErr.message}`);

  const ttlSeconds = GRACE_DAYS() * 24 * 60 * 60;
  const { data, error } = await admin.storage.from('tenant-exports').createSignedUrl(path, ttlSeconds);
  if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
  return { url: data.signedUrl };
}
```

> **Provisioning note for the plan executor:** the private Storage bucket `tenant-exports` must exist (create via Supabase dashboard or a one-off setup script). Document this in the runbook; it is infra, not migration SQL.

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/exporter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/exporter.ts src/__tests__/lib/offboarding/exporter.test.ts package.json package-lock.json
git commit -m "feat(offboarding): tenant-wide export artifact (zip → storage → signed url)"
```

---

## Task 8: Two-phase purge worker

**Files:**
- Create: `src/lib/offboarding/purgeWorker.ts`
- Test: `src/__tests__/lib/offboarding/purgeWorker.test.ts`

Three exported functions, all idempotent and safe to re-run nightly:
- `runDueTeardownTasks(admin)` — claim `pending`/`failed` (under cap) tasks and run them.
- `runOperationalPurge(admin)` — for tenants past `scheduled_purge_at` with all gating tasks `done`/`skipped`: delete operational/PII tables, flip `scheduled_for_deletion → purging → purged`. Keep `tenants` row + `transactions` + `offboarding_tasks`.
- `runFinancialPurge(admin)` — for `purged` tenants past `financials_purge_at`: delete `transactions`, `offboarding_tasks`, then the `tenants` row.

- [ ] **Step 1: Write the failing test**

```typescript
import { runDueTeardownTasks, runOperationalPurge, runFinancialPurge } from '@/lib/offboarding/purgeWorker';

jest.mock('@/lib/offboarding/teardownTasks', () => ({ runTeardownTask: jest.fn().mockResolvedValue({ status: 'done' }) }));
// queue-based supabase mock: deletes recorded in `deletes[]`, updates in `updates[]` ...

describe('runOperationalPurge', () => {
  beforeEach(() => { responses.length = 0; deletes.length = 0; updates.length = 0; jest.clearAllMocks(); });

  it('does NOT purge when gating tasks are still pending', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]); // due tenants
    pushDb([{ task_type: 'revoke_whatsapp', status: 'pending' }]); // gating tasks → not all done
    const n = await runOperationalPurge(admin as any);
    expect(n).toBe(0);
    expect(deletes).toHaveLength(0);
  });

  it('purges operational tables and flips to purged when due + tasks done, keeping tenants + transactions', async () => {
    pushDb([{ id: 't1', scheduled_purge_at: new Date(Date.now() - 1000).toISOString() }]);
    pushDb([{ task_type: 'revoke_whatsapp', status: 'done' }, { task_type: 'export_data', status: 'done' }]);
    const n = await runOperationalPurge(admin as any);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining(['customers', 'reservations', 'messages', 'chats', 'services', 'staff']));
    expect(deletes).not.toContain('transactions');
    expect(deletes).not.toContain('tenants');
    expect(updates.at(-1)).toEqual(expect.objectContaining({ lifecycle_state: 'purged' }));
  });
});

describe('runFinancialPurge', () => {
  it('deletes transactions + offboarding_tasks + the tenants row past retention', async () => {
    pushDb([{ id: 't1' }]); // purged tenants past financials_purge_at
    const n = await runFinancialPurge(admin as any);
    expect(n).toBe(1);
    expect(deletes).toEqual(expect.arrayContaining(['transactions', 'offboarding_tasks', 'tenants']));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/purgeWorker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `purgeWorker.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { runTeardownTask, type OffboardingTaskRow } from './teardownTasks';
import { writeAuditLog } from '@/lib/audit/log';

// Operational/PII tables deleted in Phase 1. Order respects FK children-first.
// VERIFY against the live schema during implementation (FK audit) and extend as needed.
const OPERATIONAL_TABLES = [
  'messages', 'chats', 'whatsapp_conversations', 'reservations', 'customers',
  'staff', 'services', 'leads', 'knowledge_articles', 'whatsapp_configurations',
] as const;

export async function runDueTeardownTasks(admin: SupabaseClient): Promise<number> {
  const { data: tasks } = await admin
    .from('offboarding_tasks').select('*')
    .in('status', ['pending', 'failed']).lt('attempts', 5);
  let ran = 0;
  for (const t of (tasks ?? []) as OffboardingTaskRow[]) { await runTeardownTask(admin, t); ran++; }
  return ran;
}

export async function runOperationalPurge(admin: SupabaseClient): Promise<number> {
  const { data: due } = await admin
    .from('tenants').select('id, scheduled_purge_at')
    .eq('lifecycle_state', 'scheduled_for_deletion')
    .lte('scheduled_purge_at', new Date().toISOString());
  let purged = 0;
  for (const tenant of (due ?? []) as Array<{ id: string }>) {
    const { data: tasks } = await admin
      .from('offboarding_tasks').select('task_type, status').eq('tenant_id', tenant.id);
    const allSettled = ((tasks ?? []) as Array<{ status: string }>).every((t) => t.status === 'done' || t.status === 'skipped');
    if (!allSettled) continue;

    await admin.from('tenants').update({ lifecycle_state: 'purging' }).eq('id', tenant.id);
    for (const table of OPERATIONAL_TABLES) {
      await admin.from(table).delete().eq('tenant_id', tenant.id);
    }
    await admin.from('tenants').update({ lifecycle_state: 'purged' }).eq('id', tenant.id);
    await writeAuditLog(admin, { action: 'tenant.offboard.operational_purged', tenantId: tenant.id, userRole: 'system' });
    purged++;
  }
  return purged;
}

export async function runFinancialPurge(admin: SupabaseClient): Promise<number> {
  const { data: due } = await admin
    .from('tenants').select('id')
    .eq('lifecycle_state', 'purged')
    .lte('financials_purge_at', new Date().toISOString());
  let removed = 0;
  for (const tenant of (due ?? []) as Array<{ id: string }>) {
    await admin.from('transactions').delete().eq('tenant_id', tenant.id);
    await admin.from('offboarding_tasks').delete().eq('tenant_id', tenant.id);
    await writeAuditLog(admin, { action: 'tenant.offboard.financial_purged', tenantId: tenant.id, userRole: 'system' });
    await admin.from('tenants').delete().eq('id', tenant.id);
    removed++;
  }
  return removed;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/purgeWorker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offboarding/purgeWorker.ts src/__tests__/lib/offboarding/purgeWorker.test.ts
git commit -m "feat(offboarding): two-phase purge worker + teardown retry sweep"
```

---

## Task 9: Lifecycle access gate in the unified route handler

**Files:**
- Modify: `src/lib/error-handling/route-handler.ts` (shared — minimal additive touch; stage only this file)
- Test: `src/__tests__/lib/error-handling/lifecycle-gate.test.ts`

When an authenticated request resolves a tenant whose `lifecycle_state !== 'active'`, return HTTP 423 (Locked) — except the export route (allow-listed) so the owner can still download during grace.

- [ ] **Step 1: Read the handler to find the post-auth tenant-resolution point**

Run: `grep -n "tenantId\|ctx.user\|auth\b\|roles" src/lib/error-handling/route-handler.ts | head -30`
Identify where `ctx.user.tenantId` is established after auth. The gate goes immediately after, before the handler body runs.

- [ ] **Step 2: Write the failing test**

```typescript
import { isLifecycleAccessible } from '@/lib/error-handling/route-handler';

describe('isLifecycleAccessible', () => {
  it('allows active tenants', () => expect(isLifecycleAccessible('active', '/api/tenants/x/settings')).toBe(true));
  it('blocks non-active tenants', () => expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/settings')).toBe(false));
  it('allows the export + reactivate routes during grace', () => {
    expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/export')).toBe(true);
    expect(isLifecycleAccessible('scheduled_for_deletion', '/api/tenants/x/reactivate')).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/error-handling/lifecycle-gate.test.ts`
Expected: FAIL — `isLifecycleAccessible` not exported.

- [ ] **Step 4: Add the pure predicate + wire it (minimal, additive)**

```typescript
// Add near the top-level exports of route-handler.ts:
const LIFECYCLE_ALLOWLIST = ['/export', '/reactivate'];
export function isLifecycleAccessible(lifecycleState: string, pathname: string): boolean {
  if (lifecycleState === 'active') return true;
  return LIFECYCLE_ALLOWLIST.some((suffix) => pathname.includes(suffix));
}
```

Then, where the handler has resolved the tenant context after auth (from Step 1), add a guarded check that loads `tenants.lifecycle_state` for `ctx.user.tenantId` and, if `!isLifecycleAccessible(state, ctx.request.nextUrl.pathname)`, throws `ApiErrorFactory` with status `423` (add a `locked` factory if none exists, else use a generic with `statusCode: 423`). Keep it behind `if (opts.auth && ctx.user?.tenantId)` so unauthenticated/public routes are unaffected.

- [ ] **Step 5: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/error-handling/lifecycle-gate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/error-handling/route-handler.ts src/__tests__/lib/error-handling/lifecycle-gate.test.ts
git commit -m "feat(offboarding): gate non-active tenants at the route handler (423)"
```

---

## Task 10: API routes — offboard, reactivate, export, DELETE repurpose, superadmin PATCH

**Files:**
- Create: `src/app/api/tenants/[tenantId]/offboard/route.ts`
- Create: `src/app/api/tenants/[tenantId]/reactivate/route.ts`
- Create: `src/app/api/tenants/[tenantId]/export/route.ts`
- Modify: `src/app/api/tenants/[tenantId]/route.ts` (repurpose DELETE)
- Modify: `src/app/api/superadmin/tenants/[tenantId]/route.ts` (PATCH entry)
- Test: `src/__tests__/api/tenants/offboarding-routes.test.ts`

Follow the verified `createHttpHandler` route-test pattern (see `boka-route-test-pattern` memory; do NOT copy the broken `stripe.test.ts` ctx pattern).

- [ ] **Step 1: Write the failing test (offboard requires typed confirmation; reactivate; export returns signed url)**

```typescript
// Mock offboardService + exporter; assert the routes call them with the right args
// and that offboard rejects when confirmText !== tenant.name.
import { POST as offboardPOST } from '@/app/api/tenants/[tenantId]/offboard/route';
// ... createHttpHandler-compatible ctx per boka-route-test-pattern ...

it('offboard: 400 when confirmText does not match tenant name', async () => { /* ... */ });
it('offboard: enters off-boarding with reason=voluntary on matching confirmText', async () => { /* ... */ });
it('reactivate: calls reactivate() and returns active', async () => { /* ... */ });
it('export: returns the signed url for the latest export task payload', async () => { /* ... */ });
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/api/tenants/offboarding-routes.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the routes**

`offboard/route.ts`:
```typescript
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { enterOffboarding } from '@/lib/offboarding/offboardService';

const Body = z.object({ confirmText: z.string().min(1) });

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'required' });
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');
    const parsed = Body.safeParse(await ctx.request.json());
    if (!parsed.success) throw ApiErrorFactory.validationError({ issues: parsed.error.issues });

    const admin = createSupabaseAdminClient();
    const { data: tenant } = await admin.from('tenants').select('id, name').eq('id', tenantId).single();
    if (!tenant) throw ApiErrorFactory.notFound('Tenant not found');
    if (parsed.data.confirmText.trim() !== (tenant.name as string)) {
      throw ApiErrorFactory.validationError({ confirmText: 'Type the exact tenant name to confirm' });
    }
    const res = await enterOffboarding(admin, {
      tenantId, reason: 'voluntary', actorUserId: ctx.user!.id, actorRole: ctx.user!.role,
    });
    return { success: true, lifecycleState: res.lifecycleState };
  },
  'POST',
  { auth: true, roles: ['owner'] },
);
```

`reactivate/route.ts`: same shape, calls `reactivate(admin, { tenantId, actorUserId, actorRole })`, roles `['owner','superadmin']`.

`export/route.ts`: `GET`, roles `['owner']`; loads the `export_data` task row for the tenant and returns `{ url: payload.export_url }` (404 if not ready).

`route.ts` DELETE repurpose — replace the hard-cascade body with:
```typescript
// DELETE now enters the reversible off-boarding flow instead of hard-deleting.
const admin = createSupabaseAdminClient();
const { data: tenant } = await admin.from('tenants').select('id, lifecycle_state').eq('id', tenantId).single();
if (!tenant) throw ApiErrorFactory.notFound('Tenant not found');
const { enterOffboarding } = await import('@/lib/offboarding/offboardService');
await enterOffboarding(admin, { tenantId, reason: 'voluntary', actorUserId: ctx.user!.id, actorRole: ctx.user!.role });
return { success: true, scheduled: tenantId };
```

`superadmin/tenants/[tenantId]/route.ts` PATCH — add an optional `offboard` body field `{ reason: 'non_payment'|'gdpr_erasure'|'superadmin' }`; when present, call `enterOffboarding` with that reason and `actorRole: 'superadmin'`.

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/api/tenants/offboarding-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/tenants/[tenantId]/offboard/route.ts" "src/app/api/tenants/[tenantId]/reactivate/route.ts" "src/app/api/tenants/[tenantId]/export/route.ts" "src/app/api/tenants/[tenantId]/route.ts" "src/app/api/superadmin/tenants/[tenantId]/route.ts" src/__tests__/api/tenants/offboarding-routes.test.ts
git commit -m "feat(offboarding): offboard/reactivate/export routes + DELETE repurpose + superadmin entry"
```

---

## Task 11: Wire the purge worker into the nightly cron

**Files:**
- Modify: `src/app/api/cron/nightly/route.ts` (shared — one import + one task block; stage only this file)
- Test: extend `src/__tests__/api/cron/nightly/` with `offboarding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
jest.mock('@/lib/offboarding/purgeWorker', () => ({
  runDueTeardownTasks: jest.fn().mockResolvedValue(2),
  runOperationalPurge: jest.fn().mockResolvedValue(1),
  runFinancialPurge: jest.fn().mockResolvedValue(0),
}));
import { runOffboardingSweep } from '@/app/api/cron/nightly/route';

it('runOffboardingSweep runs teardown then operational then financial purge', async () => {
  const res = await runOffboardingSweep();
  expect(res).toEqual({ teardown: 2, operational: 1, financial: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/api/cron/nightly/offboarding.test.ts`
Expected: FAIL — `runOffboardingSweep` not exported.

- [ ] **Step 3: Add the exported sweep + call it in the GET task list**

```typescript
import { runDueTeardownTasks, runOperationalPurge, runFinancialPurge } from '@/lib/offboarding/purgeWorker';

export async function runOffboardingSweep(): Promise<{ teardown: number; operational: number; financial: number }> {
  const admin = supabaseAdmin; // module-level admin client already in this file
  const teardown = await runDueTeardownTasks(admin);
  const operational = await runOperationalPurge(admin);
  const financial = await runFinancialPurge(admin);
  return { teardown, operational, financial };
}
```
Add a `// ── Task 8: Off-boarding lifecycle sweep ──` block in the `GET` handler that `await runOffboardingSweep()` and folds the counts into `results`.

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/api/cron/nightly/offboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/nightly/route.ts src/__tests__/api/cron/nightly/offboarding.test.ts
git commit -m "feat(offboarding): nightly lifecycle sweep (teardown + two-phase purge)"
```

---

## Task 12: Full-suite + typecheck checkpoint

**Files:** none (verification only)

- [ ] **Step 1: Run the offboarding suites together**

Run:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/offboarding/ src/__tests__/lib/audit/ src/__tests__/api/tenants/offboarding-routes.test.ts src/__tests__/api/cron/nightly/offboarding.test.ts src/__tests__/lib/error-handling/lifecycle-gate.test.ts
```
Expected: all green.

- [ ] **Step 2: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: no NEW errors attributable to offboarding files (pre-existing baseline errors in unrelated files are acceptable; confirm none reference `src/lib/offboarding/*` or the new routes).

- [ ] **Step 3: FK-audit sign-off**

Manually verify `OPERATIONAL_TABLES` (Task 8) and the teardown table/column names (Task 6) against the live schema. Adjust lists if a table is missing or a child table needs to precede its parent. Re-run Step 1.

---

## Task 13: Settings UI — "Close account" (COORDINATE-OR-DEFER)

> **Collision warning:** `src/components/settings/*` and dashboard code are actively edited by the parallel session. Do this task **only after** confirming with the user that the other session is clear of these files, or defer it to a follow-up branch. The backend (Tasks 1–11) is fully functional via API without this UI.

**Files:**
- Create: `src/components/settings/CloseAccountSection.tsx`
- Test: `src/__tests__/components/settings/CloseAccountSection.test.tsx`

- [ ] **Step 1: Write the failing test** — renders a typed-confirmation modal; the "Close account" button is disabled until the typed text equals the tenant name; on submit it POSTs to `/api/tenants/{id}/offboard`. Renders a `scheduled_for_deletion` banner with a "Reactivate" button when lifecycle is not active.

- [ ] **Step 2–4:** Implement the component (typed-confirmation modal stating grace length, cash-refunded / tokens-forfeited, export download link; reactivate banner), run the test to red then green.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/CloseAccountSection.tsx src/__tests__/components/settings/CloseAccountSection.test.tsx
git commit -m "feat(offboarding): Close Account settings UI + reactivate banner"
```

---

## Final: land the branch

Per `superpowers:finishing-a-development-branch` — once Tasks 1–12 (and optionally 13) are green, coordinate a clean fast-forward of `feat/instagram-channel` to this branch during a window when the parallel session is paused (same protocol used for the brand-identity landing). Re-apply against the latest tip; the only shared-file touches (nightly cron, route-handler) may need a quick rebase auto-merge.

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| §1 Lifecycle state machine + schema | 1, 2, 4 |
| §2 Data export artifact | 7 (+ task wiring in 6) |
| §3 Teardown checklist (`offboarding_tasks`) | 1, 6 |
| §4 Two-phase purge job | 8, 11 |
| §5 API + UI surface | 10, 13 |
| §6 Per-scenario wiring | 5 (reasons), 10 (entry points) |
| §7 Error handling & testing | 6 (idempotency/retry), 8 (gating), throughout (tests) |
| Access control (non-active → 423) | 9 |
| Audit on every transition | 3 (helper) + 5, 8 (calls) |

**Deferred to follow-up (documented, not silent):** automatic non-payment lapse *detection* (entry point exists via superadmin PATCH / DELETE; auto-detection needs the subscription-billing model, which isn't wired); `cancel_billing` is a recorded no-op until then. Token→cash conversion remains a non-goal per spec.
