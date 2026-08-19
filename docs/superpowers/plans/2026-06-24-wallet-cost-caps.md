# Per-Tenant Wallet & Cost Caps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch runaway per-tenant AI spend fast (within the prepaid balance) via a velocity guard + daily budget, degrading gracefully to the existing L1 rules engine when capped.

**Architecture:** A read-only `checkCaps` sums the `ai_wallet_ledger` (spend = `−SUM(amount_credits)` where `kind <> 'topup'`) over a short velocity window and the current day; it gates at the **top of `callAIWithRetry`** (before `isQuotaExceeded`) → `return null` → L1 fallback, with a `skipCapCheck`-gated backstop throw in `withTenantWalletSpend` for non-pipeline callers. Owner alerts (daily-budget) dedup once/day; velocity caps are logged.

**Tech Stack:** Next.js 16, TypeScript, Supabase admin client, Jest with the queue-based Supabase mock from the v2/deliverability tests.

**Source spec:** `docs/superpowers/specs/2026-06-24-wallet-cost-caps-design.md`

---

## Collision discipline (read first)

Build in an **isolated worktree** (via `superpowers:using-git-worktrees`) off the current `feat/instagram-channel` tip. Shared files (one minimal touch each; stage ONLY the named file, never `git add -A`): `src/lib/billing/ai-wallet.ts` (Task 5), `src/lib/whatsapp/v2/pipeline.ts` (Task 6), `src/app/api/admin/tenant/[id]/settings/route.ts` + `src/app/api/superadmin/tenants/[tenantId]/route.ts` (Task 7). New code under `src/lib/billing/spendCaps/` — collision-free.

> **Migration number is volatile** — a parallel session keeps adding migrations. `097` is the next free at writing; the implementer MUST re-check `ls db/migrations | grep -oE '^[0-9]+' | sort -n | tail -1` and use the next integer.

## Config (env defaults — build with these)

`VELOCITY_CREDITS=200`, `VELOCITY_WINDOW_MIN=10`, `DAILY_BUDGET_DEFAULT=2000`, `DAILY_BUDGET_PLATFORM_MAX=20000`, `SOFT_WARN_PCT=0.80`, `SPEND_CAPS_ENFORCED=true`. Numbers are placeholders to calibrate; with `SPEND_CAPS_ENFORCED=false` the guard logs but never blocks (metering mode).

## File structure

| File | Responsibility |
|------|----------------|
| `db/migrations/097_wallet_cost_caps.sql` | `ai_wallets` cap columns |
| `src/lib/billing/spendCaps/config.ts` | env-tunable cap constants |
| `src/lib/billing/spendCaps/spendGuard.ts` | `checkCaps()` (ledger sums → CapDecision) |
| `src/lib/billing/spendCaps/spendAlerts.ts` | `maybeAlertCap()` (deduped owner alerts / velocity log) |
| `src/lib/billing/ai-wallet.ts` | `skipCapCheck` option + backstop `checkCaps` throw |
| `src/lib/whatsapp/v2/pipeline.ts` | `checkCaps` pre-check at top of `callAIWithRetry` |
| `settings/route.ts` / `superadmin/.../route.ts` | owner `daily_budget_credits` (clamped) / superadmin `velocity_credits_override` |

---

## Task 1: Migration — `ai_wallets` cap columns

**Files:** Create `db/migrations/097_wallet_cost_caps.sql` (re-check the number first)

- [ ] **Step 1: Write the migration**
```sql
-- 097_wallet_cost_caps.sql  (verify number is free before applying)
-- SAFE: ADD COLUMN only.
ALTER TABLE ai_wallets
  ADD COLUMN IF NOT EXISTS daily_budget_credits      NUMERIC,   -- owner-lowerable; NULL = platform default
  ADD COLUMN IF NOT EXISTS velocity_credits_override NUMERIC,   -- superadmin-only; NULL = env default
  ADD COLUMN IF NOT EXISTS budget_warned_on          DATE;      -- daily-alert dedup
```
- [ ] **Step 2: Apply + re-run (idempotent).** `psql $DATABASE_URL -f db/migrations/097_wallet_cost_caps.sql`
- [ ] **Step 3: Commit** — `git add db/migrations/097_wallet_cost_caps.sql && git commit -m "feat(spend-caps): ai_wallets daily_budget + velocity_override + warned_on"`

---

## Task 2: Cap config constants

**Files:** Create `src/lib/billing/spendCaps/config.ts`; Test alongside.

- [ ] **Step 1: Failing test**
```typescript
import { CAPS } from '@/lib/billing/spendCaps/config';
describe('spend-cap config', () => {
  it('exposes defaults', () => {
    expect(CAPS.velocityCredits()).toBe(200);
    expect(CAPS.velocityWindowMs()).toBe(10 * 60 * 1000);
    expect(CAPS.dailyDefault()).toBe(2000);
    expect(CAPS.dailyPlatformMax()).toBe(20000);
    expect(CAPS.softWarnPct()).toBeCloseTo(0.8);
    expect(CAPS.enforced()).toBe(true);
  });
  it('resolves a daily budget clamped to the platform max', () => {
    expect(CAPS.resolveDailyBudget(500)).toBe(500);
    expect(CAPS.resolveDailyBudget(999999)).toBe(20000);
    expect(CAPS.resolveDailyBudget(null)).toBe(2000);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
function num(env: string, def: number): number { const v = Number(process.env[env]); return Number.isFinite(v) ? v : def; }
export const CAPS = {
  velocityCredits: () => num('VELOCITY_CREDITS', 200),
  velocityWindowMs: () => num('VELOCITY_WINDOW_MIN', 10) * 60 * 1000,
  dailyDefault: () => num('DAILY_BUDGET_DEFAULT', 2000),
  dailyPlatformMax: () => num('DAILY_BUDGET_PLATFORM_MAX', 20000),
  softWarnPct: () => num('SOFT_WARN_PCT', 0.8),
  enforced: () => (process.env.SPEND_CAPS_ENFORCED ?? 'true') !== 'false',
  resolveDailyBudget: (tenantBudget: number | null | undefined) =>
    Math.min(typeof tenantBudget === 'number' ? tenantBudget : num('DAILY_BUDGET_DEFAULT', 2000), num('DAILY_BUDGET_PLATFORM_MAX', 20000)),
  resolveVelocity: (override: number | null | undefined) =>
    typeof override === 'number' ? override : num('VELOCITY_CREDITS', 200),
};
```
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(spend-caps): tunable cap config`)

---

## Task 3: `checkCaps` — the core guard

**Files:** Create `src/lib/billing/spendCaps/spendGuard.ts`; Test alongside (queue-based supabase mock).

- [ ] **Step 1: Failing test** — the mock's `from('ai_wallet_ledger').select().eq().neq().gte()` resolves a list of `{amount_credits}` rows; `from('ai_wallets').select().eq().maybeSingle()` resolves the cap config row.
```typescript
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';
// queue mock: pushDb(rows) for ledger sums; the guard runs 2 ledger queries (velocity, daily) + 1 ai_wallets read
describe('checkCaps', () => {
  beforeEach(() => { responses.length = 0; jest.clearAllMocks(); process.env.SPEND_CAPS_ENFORCED = 'true'; });

  it('allows under budget', async () => {
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null }); // wallet
    pushDb([{ amount_credits: -10 }]);  // velocity window: spend 10
    pushDb([{ amount_credits: -50 }]);  // today: spend 50
    const d = await checkCaps(admin as any, 't1');
    expect(d).toMatchObject({ allowed: true, reason: 'ok', softWarn: false });
  });
  it('blocks on velocity (spend >= 200 in window)', async () => {
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb([{ amount_credits: -150 }, { amount_credits: -80 }]); // 230 in window
    pushDb([{ amount_credits: -230 }]);
    const d = await checkCaps(admin as any, 't1');
    expect(d.allowed).toBe(false); expect(d.reason).toBe('velocity_cap');
  });
  it('blocks on daily (spend >= budget)', async () => {
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb([{ amount_credits: -5 }]);     // velocity ok
    pushDb([{ amount_credits: -120 }]);   // today 120 >= 100
    const d = await checkCaps(admin as any, 't1');
    expect(d.allowed).toBe(false); expect(d.reason).toBe('daily_cap');
  });
  it('flags softWarn at >=80% of daily', async () => {
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb([{ amount_credits: -5 }]);
    pushDb([{ amount_credits: -85 }]);    // 85% of 100
    const d = await checkCaps(admin as any, 't1');
    expect(d).toMatchObject({ allowed: true, softWarn: true });
  });
  it('fails OPEN on query error', async () => {
    pushErr();  // first query throws
    const d = await checkCaps(admin as any, 't1');
    expect(d.allowed).toBe(true); expect(d.reason).toBe('ok');
  });
  it('metering mode (SPEND_CAPS_ENFORCED=false) never blocks', async () => {
    process.env.SPEND_CAPS_ENFORCED = 'false';
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb([{ amount_credits: -300 }]);   // would breach velocity
    pushDb([{ amount_credits: -300 }]);
    const d = await checkCaps(admin as any, 't1');
    expect(d.allowed).toBe(true);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAPS } from './config';

export interface CapDecision {
  allowed: boolean;
  reason: 'ok' | 'velocity_cap' | 'daily_cap';
  softWarn: boolean;
  spentTodayCredits: number;
  dailyBudgetCredits: number;
}

function startOfTodayUTC(): string {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString();
}

/** spend = -SUM(amount_credits) over kind<>'topup' since `sinceIso` (ledger debits are negative). */
async function spendSince(admin: SupabaseClient, tenantId: string, sinceIso: string): Promise<number> {
  const { data, error } = await admin
    .from('ai_wallet_ledger')
    .select('amount_credits')
    .eq('tenant_id', tenantId)
    .neq('kind', 'topup')
    .gte('created_at', sinceIso);
  if (error) throw new Error(error.message);
  const sum = (data ?? []).reduce((acc: number, r: { amount_credits?: number }) => acc + Number(r.amount_credits ?? 0), 0);
  return -sum; // negate debits → positive spend
}

export async function checkCaps(admin: SupabaseClient, tenantId: string): Promise<CapDecision> {
  try {
    const { data: wallet } = await admin
      .from('ai_wallets').select('daily_budget_credits, velocity_credits_override').eq('tenant_id', tenantId).maybeSingle();
    const dailyBudget = CAPS.resolveDailyBudget((wallet as { daily_budget_credits?: number } | null)?.daily_budget_credits);
    const velocityCap = CAPS.resolveVelocity((wallet as { velocity_credits_override?: number } | null)?.velocity_credits_override);

    const velocitySpend = await spendSince(admin, tenantId, new Date(Date.now() - CAPS.velocityWindowMs()).toISOString());
    const todaySpend = await spendSince(admin, tenantId, startOfTodayUTC());

    const enforced = CAPS.enforced();
    if (enforced && velocitySpend >= velocityCap) return { allowed: false, reason: 'velocity_cap', softWarn: false, spentTodayCredits: todaySpend, dailyBudgetCredits: dailyBudget };
    if (enforced && todaySpend >= dailyBudget)     return { allowed: false, reason: 'daily_cap',    softWarn: false, spentTodayCredits: todaySpend, dailyBudgetCredits: dailyBudget };
    return { allowed: true, reason: 'ok', softWarn: todaySpend >= CAPS.softWarnPct() * dailyBudget, spentTodayCredits: todaySpend, dailyBudgetCredits: dailyBudget };
  } catch (err) {
    console.warn('[spendGuard] checkCaps failed — failing open', err);
    return { allowed: true, reason: 'ok', softWarn: false, spentTodayCredits: 0, dailyBudgetCredits: 0 };
  }
}
```
> Mock `makeChain` must support `.neq()` and `.gte()` (return chain) plus a `pushErr()` that makes the next terminal reject. `startOfTodayUTC` keeps v1 simple; tenant-tz day-start is a documented follow-up.
- [ ] **Step 4: Run → PASS (6 tests)** — [ ] **Step 5: Commit** (`feat(spend-caps): checkCaps ledger guard (velocity + daily, fail-open)`)

---

## Task 4: Deduped alerts

**Files:** Create `src/lib/billing/spendCaps/spendAlerts.ts`; Test alongside.

- [ ] **Step 1: Failing test**
```typescript
import { maybeAlertCap } from '@/lib/billing/spendCaps/spendAlerts';
jest.mock('@/lib/monitoring/telegramAlert', () => ({ sendTelegramInfo: jest.fn().mockResolvedValue(undefined) }));
// queue mock: ai_wallets read for budget_warned_on; notifications insert recorded
describe('maybeAlertCap', () => {
  beforeEach(() => { responses.length = 0; inserted.length = 0; updates.length = 0; jest.clearAllMocks(); });
  it('daily_cap: inserts a notification + sets budget_warned_on when not yet warned today', async () => {
    pushDb({ budget_warned_on: null });
    await maybeAlertCap(admin as any, 't1', 'daily_cap');
    expect(inserted.some((r) => r.type === 'spend_cap')).toBe(true);
    expect(updates.some((u) => 'budget_warned_on' in u)).toBe(true);
  });
  it('daily_cap: does NOT re-alert when already warned today', async () => {
    pushDb({ budget_warned_on: new Date().toISOString().slice(0, 10) });
    await maybeAlertCap(admin as any, 't1', 'daily_cap');
    expect(inserted).toHaveLength(0);
  });
  it('velocity_cap: logs only, never inserts an owner notification', async () => {
    await maybeAlertCap(admin as any, 't1', 'velocity_cap');
    expect(inserted).toHaveLength(0);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendTelegramInfo } from '@/lib/monitoring/telegramAlert';

const today = () => new Date().toISOString().slice(0, 10);

/** Owner alert for DAILY caps/soft-warn, deduped once/day via ai_wallets.budget_warned_on.
 *  Velocity caps are transient → logged only. Best-effort; never throws. */
export async function maybeAlertCap(admin: SupabaseClient, tenantId: string, reason: 'daily_cap' | 'velocity_cap' | 'soft_warn'): Promise<void> {
  try {
    if (reason === 'velocity_cap') { console.warn('[spend-caps] velocity cap hit', { tenantId }); return; }
    const { data } = await admin.from('ai_wallets').select('budget_warned_on').eq('tenant_id', tenantId).maybeSingle();
    const warned = (data as { budget_warned_on?: string } | null)?.budget_warned_on;
    if (warned && String(warned).slice(0, 10) === today()) return; // already alerted today

    const message = reason === 'daily_cap'
      ? 'AI paused for today (rules-only mode). Top up credits or it resets at midnight.'
      : 'Heads up: today’s AI budget is 80% used.';
    await admin.from('notifications').insert({ tenant_id: tenantId, type: 'spend_cap', title: 'AI budget', message, read: false });
    await admin.from('ai_wallets').update({ budget_warned_on: today() }).eq('tenant_id', tenantId);
    await sendTelegramInfo(`[spend-caps] tenant ${tenantId}: ${reason}`).catch(() => {});
  } catch (err) {
    console.warn('[spend-caps] alert failed', err);
  }
}
```
> Verify `sendTelegramInfo` is exported by `@/lib/monitoring/telegramAlert`; if the export name differs, adapt. `notifications` columns (tenant_id, type, title, message, read) confirmed in the live schema.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(spend-caps): deduped daily alerts; velocity logged`)

---

## Task 5: `withTenantWalletSpend` — `skipCapCheck` + backstop

**Files:** Modify `src/lib/billing/ai-wallet.ts` (shared — stage only this file); Test `src/__tests__/lib/billing/wallet-cap-backstop.test.ts`

- [ ] **Step 1: Failing test** — mock `@/lib/billing/spendCaps/spendGuard` `checkCaps`. Assert:
  - with `checkCaps → {allowed:false, reason:'velocity_cap'}` and options WITHOUT `skipCapCheck`, `withTenantWalletSpend` throws `wallet_block: velocity_cap` and never calls `execute`.
  - with `skipCapCheck:true`, `checkCaps` is NOT called and the call proceeds (reserve/execute path, mocked).
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — add `skipCapCheck?: boolean` to `WalletProtectedCallOptions` (line ~201). At the very start of `withTenantWalletSpend` (after the `if (!tenantId) return execute()` guard), add:
```typescript
if (!options.skipCapCheck) {
  const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
  const cap = await checkCaps(supabase, tenantId);
  if (!cap.allowed) throw new Error(`wallet_block: ${cap.reason}`);
}
```
(Dynamic import avoids a static cycle and keeps the cap module optional.)
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(spend-caps): skipCapCheck option + wallet backstop`)

---

## Task 6: Pipeline pre-check at the top of `callAIWithRetry`

**Files:** Modify `src/lib/whatsapp/v2/pipeline.ts` (shared — stage only this file); extend a pipeline test.

- [ ] **Step 1: Failing test** — mock `checkCaps` + `maybeAlertCap`; call `callAIWithRetry` (or a thin exported wrapper). Assert: when `checkCaps → {allowed:false, reason:'daily_cap'}`, it returns `null`, `isQuotaExceeded` is NOT reached, no wallet reserve happens, and `maybeAlertCap('daily_cap')` was called.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — at the TOP of `callAIWithRetry` (pipeline.ts:300, before the `isQuotaExceeded` block at :309) add:
```typescript
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';
import { maybeAlertCap } from '@/lib/billing/spendCaps/spendAlerts';
// ... at the top of callAIWithRetry body:
const cap = await checkCaps(supabaseAdmin, tenantId);
if (!cap.allowed) { await maybeAlertCap(supabaseAdmin, tenantId, cap.reason); return null; }
if (cap.softWarn) await maybeAlertCap(supabaseAdmin, tenantId, 'soft_warn');
```
Then pass `skipCapCheck: true` in the `options` object of BOTH `withTenantWalletSpend` calls (the L2 call at ~320 and the L3 `callFlash` call at ~433) since the entry already checked.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(spend-caps): gate callAIWithRetry on caps before quota; skip wrapper recheck`)

---

## Task 7: Owner daily budget + superadmin velocity in settings

**Files:** Modify `src/app/api/admin/tenant/[id]/settings/route.ts` + `src/app/api/superadmin/tenants/[tenantId]/route.ts` (shared — stage individually); Test `src/__tests__/api/tenants/spend-cap-settings.test.ts` (follow the verified `boka-route-test-pattern`).

- [ ] **Step 1: Failing tests:**
  - settings PUT with `daily_budget_credits: 500` → updates `ai_wallets.daily_budget_credits = 500`; with `999999` → clamps to `DAILY_BUDGET_PLATFORM_MAX` (20000); never accepts `velocity_credits_override`.
  - superadmin PATCH with `velocity_credits_override: 50` → updates `ai_wallets.velocity_credits_override = 50`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement:**
  - In `UpdateSettingsSchema` add `daily_budget_credits: z.number().nonnegative().optional()`. In the PUT handler, after the tenant update, if `data.daily_budget_credits !== undefined`, `await ctx.supabase.from('ai_wallets').update({ daily_budget_credits: CAPS.resolveDailyBudget(data.daily_budget_credits) }).eq('tenant_id', tenantId)` (import `CAPS` from `@/lib/billing/spendCaps/config`). Do NOT add velocity to this schema.
  - In the superadmin `TenantPatchBody` add `velocity_credits_override?: number`; when present, `await admin.from('ai_wallets').update({ velocity_credits_override: body.velocity_credits_override }).eq('tenant_id', tenantId)`.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(spend-caps): owner daily-budget (clamped) + superadmin velocity override`)

---

## Task 8: Full-suite + verification

- [ ] **Step 1:** `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/billing/spendCaps/ src/__tests__/lib/billing/wallet-cap-backstop.test.ts src/__tests__/api/tenants/spend-cap-settings.test.ts` → green.
- [ ] **Step 2:** `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` → no NEW errors in spend-cap files.
- [ ] **Step 3:** Live-schema check: `ai_wallets` has the 3 new columns (migration 097 run). Confirm `ai_wallet_ledger` debits are negative in a real row sample (the guard negates the sum).
- [ ] **Step 4:** Calibrate `VELOCITY_CREDITS`/`DAILY_BUDGET_DEFAULT` against measured per-call credit cost; ship with `SPEND_CAPS_ENFORCED=false` (metering) first if real numbers are unknown, then flip to `true`.

---

## Final: land the branch

Per `superpowers:finishing-a-development-branch` — once Tasks 1–8 are green, coordinate a clean FF of `feat/instagram-channel` during a parallel-session pause (same protocol as prior specs). Shared-file touches (`ai-wallet.ts`, `pipeline.ts`, the 2 routes) may need a quick rebase auto-merge.

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| Unit 1 checkCaps (ledger sum, velocity+daily, fail-open, metering) | 2, 3 |
| Unit 2 caps config/storage (ai_wallets cols, owner-clamped, superadmin velocity) | 1, 7 |
| Unit 3 enforcement (top of callAIWithRetry; skipCapCheck backstop) | 5, 6 |
| Unit 4 deduped alerts (daily once/day; velocity logged) | 4, 6 |
| Config + flag | 2 |
| Verification/calibration | 8 |

**Deferred (documented):** tenant-tz day start (v1 = UTC); monthly + per-conversation caps; capping non-wallet-wrapped AI paths; surfacing cap state in `getTenantWalletSummary` (optional read-side nicety).
