# Launch-Readiness Audit — Full Repo

**Date:** 2026-07-05
**Branch:** `feat/instagram-channel`
**Method:** Every finding verified against actual code (file:line) — no inferred/false positives.

## Health baseline
- **tsc:** 0 errors
- **Tests:** 1545 passed / 36 failed / 11 skipped / 1 todo across 169 suites (8 failing suites)
- **Secrets:** no hardcoded secrets in `src/`
- Improved from the prior 107-failed baseline.

---

## 🔴 CRITICAL — blocks launch

### C1. Two parallel product-commerce systems; the older one writes to 3 phantom tables
- **`retail_orders`** (migration `120`, `src/lib/commerce/retail-orders.ts`) — the AI-front-desk sales path.
  Real tables. Reviewed + fixed 2026-07 (`fd24b22`, `56121a3`).
- **`product_bookings`** (`src/app/api/bookings/products/route.ts`) — an EARLIER product-commerce attempt.
  Writes to `product_bookings`, `product_booking_items`, `product_inventory` — **none exist** (not in
  migrations, not in live schema). UI-wired via `src/components/booking/IntegratedBookingForm.tsx`, so
  a real form submits to it → **500s on every submit** for tracked-inventory products.
- **Also broken same way:** `src/app/api/products/by-product-id/variants/route.ts:139` inserts into
  `product_inventory` — but **fail-quiet** ("Continue anyway, inventory can be added later"), so variant
  creation still works; the inventory row silently isn't created.
- **DECISION REQUIRED (product):** consolidate on `retail_orders` (delete the `product_bookings` route +
  `IntegratedBookingForm`, or point the form at `retail_orders`), OR resurrect `product_bookings` with 3
  new migrations. Do NOT blind-fix — it's UI-wired and duplicates a working system.
- Note the `product_inventory` shape here (`reserved_stock`, `minimum_stock`, `reorder_point`) is a richer
  model than migration 117's flat `products.stock_quantity` — a consolidation must pick one.

### C2. `db/migrations/` is NOT the schema source of truth (~45 live tables have no migration)
- `services`, `tenant_users`, `bookings`, `jobs`, `notifications`, `reservation_services`, etc. exist only
  in live Supabase. **Provisioning any fresh environment from `db/migrations/` yields a broken DB.** No
  reproducible schema = no safe DR / staging / new-region / new-dev onboarding.
- **Fix:** baseline migration from a live `pg_dump --schema-only`, committed as e.g. `000_baseline.sql`,
  and adopt "every schema change ships as a migration" going forward.
- This is the ROOT CAUSE of the recurring "missing table" confusion.

---

## 🟠 HIGH

### H1. Subsystems referencing tables that exist nowhere — dead or broken
Verified `.from('...')` callers, table absent from both migrations and live schema:
| Subsystem | File(s) | Missing tables | Runtime behavior |
|---|---|---|---|
| HIPAA / compliance | `middleware/hipaaMiddleware.ts`, `lib/compliance/hipaaCompliance.ts` | `phi_access_logs`, `patient_consents`, `encrypted_medical_data`, `security_incidents`, `user_tenant_roles` | middleware NOT wired → dead; but **false compliance signal** |
| Payment fraud | `lib/paymentSecurityService.ts` | `fraud_assessments`, `suspicious_activities` | verify wired/dead |
| LLM usage/quota | `lib/llmUsageTracker.ts` | `llm_usage`, `llm_quotas` | **fail-quiet** → per-model quota silently no-ops (real guard = Spec 5 wallet caps on `ai_wallets`) |
| Usage metering | `app/api/usage/route.ts`, `lib/usageMetrics.ts` | `usage_daily` | verify |
| Staff/locations | `app/api/locations/[locationId]/staff/route.ts`, `lib/analyticsService.ts` | `staff`, `staff_availability`, `provider_services` | verify |
| LLM alerts | `lib/llmAlertService.ts` | `profiles`, `tenant_settings` | verify |
| Superadmin | `types/unified-permissions.ts`, `lib/error-handling/migration-helpers.ts` | `superadmin_audit_log` | verify |

**Action:** triage each — **delete if dead** (esp. HIPAA: false assurance), **migrate if live**.

### H2. 8 failing test suites / 36 tests — includes a booking-engine cluster (core path)
- `src/__tests__/booking/engine.test.ts`
- `src/__tests__/lib/booking/engine.test.ts`
- `src/__tests__/app/api/bookings/bookings.test.ts` (also slow, ~56s)
- `tests/evolution-integration.test.ts` (WhatsApp transport — launch path)
- `src/__tests__/app/api/analytics/dashboard.test.ts`
- `src/__tests__/api/health-security/routes.test.ts`
- `src/__tests__/api/template.test.ts`
- `src/__tests__/hooks/useChatRealtime.test.tsx`

**Action:** triage before launch — booking + WhatsApp transport are launch-critical.

---

## 🟡 MEDIUM

- **M1. 39 `@ts-nocheck` files** — type safety off across a real chunk of the codebase; masks the exact
  class of type bugs found by hand this cycle (`.category.name`, phantom columns).
- **M2. 3 `.or()` string-interpolation filters** — `app/api/reservations/[id]/route.ts:118`,
  `lib/doubleBookingPrevention.ts:216`, `lib/ai/reviewCollectionAgent.ts:481`. Interpolate internal
  timestamps/UUIDs (low injection risk) but the banned fragile pattern; harden to `.eq()`/`.gte()`.

## 🟢 LOW
- **L1.** 37 `eslint-disable`, 5 `TODO/FIXME` — normal debt.
- **L2.** Commerce polish: no unique constraint on active cart per `(tenant_id, external_customer_ref)`;
  chat cart is product-level only (variants supported in schema, not in the chat add path).

---

## Recommended launch sequencing
1. **C2** baseline migration (unblocks reproducible envs).
2. **C1** product decision → consolidate on `retail_orders`.
3. **H1** delete the false-compliance HIPAA dead code (at minimum).
4. **H2** fix the booking-engine + evolution-integration test cluster.
5. Then M/L as capacity allows.

## Already-tracked operational opens (not re-litigated here)
- Apply migration `097` (wallet caps) + `117` (products) to prod.
- Seed/enable SerpApi for social listening (`b07d83b`).
