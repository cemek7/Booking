# Per-Tenant Wallet & Cost Caps — Design Spec

**Date:** 2026-06-24
**Status:** Approved (design) — pending implementation plan
**Scope:** Spec 5 of the "WhatsApp Trust" program (Spec 1 Branding ✅, Spec 2 Off-boarding ✅, Spec 4 Deliverability ✅).
**Addresses:** Landmine #11 (per-tenant cost / runaway AI spend).

## Problem

Each tenant prepays AI credits into `ai_wallets.balance_credits`, and every wallet-wrapped AI
call goes through `withTenantWalletSpend` (reserve → execute → settle), which **already blocks**
(`throw wallet_block: <reason>`) when the balance is insufficient. So spend is bounded **by the
balance** — but only at **zero**, after the damage.

The unprotected risk is **runaway *rate* within the balance**: a bug or tight loop (e.g. the AI
ping-ponging with a confused customer) can burn a tenant's whole prepaid balance in minutes. The
only other guard, `isQuotaExceeded('lite'/'flash')`, is a **global** daily AI-layer budget, not
per-tenant — its own comment says "per-tenant limits can be added later." Nothing paces a single
tenant's AI spend.

### Current state (verified against code)

- `withTenantWalletSpend` (`billing/ai-wallet.ts:210`) reserves/settles per call and throws
  `wallet_block` on insufficient balance. ✅
- `ai_wallet_ledger.kind` ∈ `'reservation' | 'usage' | 'topup' | 'refund' | 'adjustment'`:
  `reservation` is written at call-**start**, `usage` (settled charge) **after** the call. ✅
- The pipeline's AI entry `callAIWithRetry` (`pipeline.ts:309`) already pre-checks
  `isQuotaExceeded` and **`return null` → L1 / button-menu fallback** when over budget. This is the
  clean degradation seam we reuse. ✅
- **Caveat (from design self-review):** when `withTenantWalletSpend` *throws*, the pipeline's L2
  catch only logs + **retries** (`MAX_AI_RETRIES`) then **escalates to L3**, which calls the wrapper
  again — so throwing is the *messy* path (wasted reserves + cap re-queries). We therefore gate at
  the `callAIWithRetry` entry, not by relying on the throw.

## Decisions (locked during brainstorming + self-review)

| Decision | Choice |
|---|---|
| Primary risk | **Runaway rate within the prepaid balance** — pace it, don't wait for zero. |
| Cap mechanisms | **Velocity/burst cap** (fast loop-catch) **+ daily budget ceiling**. (No monthly, no per-conversation — out of scope.) |
| Velocity cap | **Platform safety guard** — env default, **superadmin-only** override per tenant. Owners cannot raise it. |
| Daily budget | **Platform default, owner-lowerable** in settings (clamped server-side to ≤ `DAILY_BUDGET_PLATFORM_MAX`). |
| Measurement | **Query `ai_wallet_ledger`** (no new write path). Velocity = `usage`+`reservation` in the window (reservations catch loops at call-start); daily = settled `usage` since tenant-tz start-of-day. |
| Enforcement seam | **Pre-check at `callAIWithRetry` entry** (next to `isQuotaExceeded`) → `return null` → clean L1 fallback, zero wasted retries. A hard **backstop `throw`** stays in `withTenantWalletSpend` for non-pipeline wallet-wrapped paths. |
| Scope | **Wallet-wrapped AI paths** (the WhatsApp pipeline + onboarding/template/summarizer/ML flows). Truly-direct AI paths (voice STT, ad-hoc) are out of scope. |
| Capped behavior | **Graceful L1 degradation** — AI off, rules engine / button menu still books. Never a hard "unavailable" error. |

## Architecture

### Unit 1 — `spendGuard.ts`: `checkCaps(admin, tenantId)`

Read-only pre-check. One function, well-bounded, returns a decision:

```ts
interface CapDecision {
  allowed: boolean;
  reason: 'ok' | 'velocity_cap' | 'daily_cap';
  softWarn: boolean;            // daily spend ≥ SOFT_WARN_PCT of budget
  spentTodayCredits: number;
  dailyBudgetCredits: number;
}
async function checkCaps(admin: SupabaseClient, tenantId: string): Promise<CapDecision>;
```

Logic:
- **Velocity:** `SUM(amount_credits)` over `ai_wallet_ledger` where `tenant_id = t`,
  `kind IN ('usage','reservation')`, `created_at > now − VELOCITY_WINDOW_MIN`.
  If `≥ velocityCap(tenant)` → `{ allowed:false, reason:'velocity_cap' }`.
- **Daily:** `SUM(amount_credits)` where `kind = 'usage'`, `created_at ≥ startOfDay(tenant.timezone)`.
  If `≥ dailyBudget(tenant)` → `{ allowed:false, reason:'daily_cap' }`.
  Else `softWarn = spentToday ≥ SOFT_WARN_PCT × dailyBudget`.
- All sums are non-negative spend; verify `amount_credits` sign convention in the plan (the guard
  uses absolute spend).

`velocityCap(tenant)` = `tenant.velocity_credits_override ?? env VELOCITY_CREDITS`.
`dailyBudget(tenant)` = `min(ai_wallets.daily_budget_credits ?? env DAILY_BUDGET_DEFAULT, env DAILY_BUDGET_PLATFORM_MAX)`.

### Unit 2 — Caps config + storage (migration `092`)

```sql
ALTER TABLE ai_wallets
  ADD COLUMN IF NOT EXISTS daily_budget_credits      NUMERIC,        -- owner-lowerable; NULL = platform default
  ADD COLUMN IF NOT EXISTS velocity_credits_override NUMERIC,        -- superadmin-only; NULL = env default
  ADD COLUMN IF NOT EXISTS budget_warned_on          DATE;           -- soft-warn dedup (one alert/day)
```

- **Owner path:** the tenant settings PUT (`/api/admin/tenant/[id]/settings`) accepts
  `daily_budget_credits`; the handler **clamps to ≤ `DAILY_BUDGET_PLATFORM_MAX`** and rejects raising
  the velocity (owners can't touch `velocity_credits_override`).
- **Superadmin path:** the superadmin tenant PATCH accepts `velocity_credits_override`.

### Unit 3 — Enforcement integration

In `callAIWithRetry` (`pipeline.ts`), immediately after the existing `isQuotaExceeded` block:

```ts
const cap = await checkCaps(supabaseAdmin, tenantId);
if (!cap.allowed) {
  await maybeAlertCap(supabaseAdmin, tenantId, cap.reason);   // Unit 4
  return null;                                                // → L1 / button menu
}
if (cap.softWarn) await maybeSoftWarn(supabaseAdmin, tenantId, cap);  // Unit 4
```

**Backstop:** keep the existing `wallet_block` throw in `withTenantWalletSpend`, and add the same
`checkCaps` hard-block there (throwing `wallet_block: velocity_cap` / `daily_cap`) so non-pipeline
wallet-wrapped callers are still protected. The pipeline never hits it because it pre-checks.

### Unit 4 — Alerts (`spendAlerts.ts`)

- **Soft-warn (≥ `SOFT_WARN_PCT`, default 80%):** once per tenant per day (guarded by
  `ai_wallets.budget_warned_on = today`), insert a `notifications` row + optional `telegramAlert`:
  "AI budget 80% used today."
- **Hard-stop (`daily_cap`):** owner notification "AI paused for today (rules-only). Top up or it
  resets at midnight." `velocity_cap`: "AI briefly paused — unusually fast usage detected."
- Alerts are best-effort (never block the request); surfaced in `getTenantWalletSummary`.

## Configuration (env defaults; confirm in plan)

- `VELOCITY_CREDITS` = 200, `VELOCITY_WINDOW_MIN` = 10 (≥200 credits of AI spend in 10 min ⇒ pause)
- `DAILY_BUDGET_DEFAULT` = 2000, `DAILY_BUDGET_PLATFORM_MAX` = 20000
- `SOFT_WARN_PCT` = 0.80
- All credits-denominated, tunable; numbers are placeholders to calibrate against real per-call cost.

## Error handling & testing

- **Fail-open on guard error:** if the ledger query fails, **allow** the call (log) — a metering
  glitch must not take AI offline. (The balance reservation still bounds true overspend.)
- **Idempotency:** `checkCaps` is read-only; soft-warn dedup via `budget_warned_on`.
- **Tests:** `checkCaps` matrix (under budget / velocity hit / daily hit / 80% soft-warn / failed
  query ⇒ fail-open); pipeline `callAIWithRetry` returns `null` when capped (no wallet reserve
  attempted); `withTenantWalletSpend` backstop throws `wallet_block:*`; settings clamp (owner can't
  exceed platform max, can't set velocity); soft-warn fires once/day. Reuse the queue-based Supabase
  mock from the v2/deliverability tests.

## Open items for the plan

- Confirm `ai_wallet_ledger.amount_credits` sign for `usage`/`reservation` (guard sums absolute spend).
- `startOfDay(tenant.timezone)` helper — tenant tz from `tenants.timezone`; fall back to UTC.
- Exact settings-route field wiring for `daily_budget_credits` (owner) vs superadmin `velocity_credits_override`.
- Calibrate the credit thresholds against measured per-call cost before enabling enforcement (ship
  with generous defaults / a `SPEND_CAPS_ENFORCED` flag so metering runs before hard-stops).

## Non-goals

- Monthly budget ceilings; per-conversation caps (deferred — not selected).
- Capping truly-direct (non-wallet-wrapped) AI paths (voice STT, ad-hoc tooling).
- Token→cash or credit-purchase UX (top-up flow already exists).
- True sliding-window precision beyond the ledger-query window (good enough for loop-catching).
