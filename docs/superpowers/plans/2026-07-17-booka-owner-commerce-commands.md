# Booka Owner Commerce Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the existing owner/staff WhatsApp command pipeline with commerce actions (products, retail sales, orders, inventory, customers, staff-extras) via a per-domain action-handler registry, AI-action idempotency+logging, minimal capability gating, and the EXISTING inventory movement ledger.

**Architecture:** A strangler `ActionHandler` registry sits alongside the legacy switch in `action-validator.ts` (registry-first, legacy fallback). New commerce stock changes route through the pre-existing `inventory-service.ts` / `p_quantity_change` RPC. Every write emits a `business_events` row and is idempotency-guarded via `ai_action_log`.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-16-booka-owner-commerce-commands-design.md` (corrections applied 2026-07-17).

## Global Constraints

- **`inventory_movements` PRE-EXISTS** (consolidation §M): signed column is `quantity_change` (NOT `quantity_delta`), `reference_id` is **text**, projection via `previous_quantity`/`new_quantity`, writes go through `inventory-service.ts` + `p_quantity_change` RPC. Extend the `movement_type` CHECK; keep `sale` for retail sales (no `retail_sale`). Add `unit_cost_cents`.
- **Reservations multi-service** (§N), **deposits exist** (§O) — relevant where handlers touch bookings/payments.
- **Retail sales reuse `retail_orders`** (null `cart_id`, `payment_status='paid'`, `fulfillment_status='fulfilled'`, `metadata.source='pos'`) — single reconciliation path.
- **AI never writes directly**: propose → `validateAction` → confirm (writes) → `executeAction`.
- **Idempotency** on every write via `ai_action_log.idempotency_key` unique per tenant.
- **Capability gating** is a stub here (owner=all, staff=safe subset); §12 replaces it with real permissions — keep the mapping table small and in one place (consolidation §D).
- **Money in integer cents**; **business_events** via `recordBusinessEvent` (spec 1 Task 2); action names from `BUSINESS_EVENT_ACTIONS` (extend it).
- Migrations number after **124** (spec 1). Paired `_rollback.sql`.

## File Structure

- `db/migrations/125_ai_action_log.sql` (+rollback) — command log + idempotency.
- `db/migrations/126_inventory_movements_commerce.sql` (+rollback) — extend `movement_type`, add `unit_cost_cents`; `customers.tags`.
- `src/lib/booking/handlers/registry.ts` — `ActionHandler` type + `HANDLERS` map + `dispatchValidate`/`dispatchExecute`.
- `src/lib/booking/handlers/{commerce,inventory,customers,staff}.ts` — domain handlers.
- `src/lib/booking/capabilityMap.ts` — action→capability + `hasCapability(role, cap)`.
- `src/lib/ai/aiActionLog.ts` — `logAiAction`, `findByIdempotencyKey`.
- `src/lib/inventory/recordMovement.ts` — thin wrapper over the existing RPC accepting new types + `unit_cost_cents`.
- Modify: `src/lib/booking/action-validator.ts` (registry-first dispatch), `src/lib/whatsapp/v2/flows/ownerCommands.ts` (log + idempotency + capability).

---

## Task 1: Migrations — ai_action_log + inventory_movements extension

**Files:** Create `db/migrations/125_ai_action_log.sql`(+rollback), `db/migrations/126_inventory_movements_commerce.sql`(+rollback).

**Interfaces:** Produces `ai_action_log` table; extends `inventory_movements.movement_type` CHECK + adds `unit_cost_cents`; adds `customers.tags`.

- [ ] **Step 1: `125_ai_action_log.sql`**

```sql
CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_type        text NOT NULL,
  actor_id          uuid,
  channel           text,
  raw_message       text,
  action            text NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   text NOT NULL,
  validation_result jsonb,
  outcome           text NOT NULL CHECK (outcome IN ('executed','rejected','needs_confirmation','duplicate','denied')),
  model             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_action_log_idem_unique UNIQUE (tenant_id, idempotency_key)
);
ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_action_log_service_role ON public.ai_action_log;
CREATE POLICY ai_action_log_service_role ON public.ai_action_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```
Rollback: `DROP TABLE IF EXISTS public.ai_action_log CASCADE;`

- [ ] **Step 2: `126_inventory_movements_commerce.sql`** — extend the EXISTING table (do not recreate)

```sql
-- Extend movement_type vocabulary (existing values: sale, damage, adjustment).
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE public.inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN ('sale','damage','adjustment','purchase','return','refund_restock','transfer_in','transfer_out','count_adjustment','service_consumption','expiry','manual_adjustment'));
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS unit_cost_cents integer;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
```
Rollback: drop `unit_cost_cents`, `customers.tags`, and restore the prior CHECK (or drop it). Document that pre-existing rows use the original three values.

- [ ] **Step 3: Apply + verify** — `psql -f` both; verify `\d inventory_movements` shows `unit_cost_cents` and the new CHECK.
- [ ] **Step 4: Commit** — `git commit -m "feat(commerce): ai_action_log + inventory_movements vocabulary/cost extension"`

---

## Task 2: Movement wrapper + idempotency log

**Files:** Create `src/lib/inventory/recordMovement.ts`(+test), `src/lib/ai/aiActionLog.ts`(+test).

**Interfaces:**
- `async function recordMovement(admin, { tenantId, productId, variantId?, movementType, quantityChange, unitCostCents?, reason?, referenceType?, referenceId?, actorId? }): Promise<void>` — calls the existing `p_quantity_change` RPC (grep its exact param names in `inventory-service.ts`), passing the new `movementType`/`unit_cost_cents`.
- `async function findByIdempotencyKey(admin, tenantId, key): Promise<{ outcome: string } | null>`; `async function logAiAction(admin, entry): Promise<void>`.

- [ ] **Step 1:** Write a test for `recordMovement` asserting it calls the RPC with `p_quantity_change` = signed delta and `p_movement_type` = the new type. Mock the supabase `.rpc`.
- [ ] **Step 2:** Run (FAIL), then implement `recordMovement` mirroring `inventory-service.ts` line ~46 RPC call; add `unit_cost_cents` (update the RPC or a follow-up `update` if the RPC doesn't accept it — check the function signature first: `grep -rn "p_quantity_change" db/migrations db/schema`).
- [ ] **Step 3:** Write `aiActionLog.ts` tests: `findByIdempotencyKey` returns prior outcome on hit; `logAiAction` inserts. Implement.
- [ ] **Step 4:** Run PASS; **Commit** `git commit -m "feat(commerce): movement wrapper + ai action idempotency log"`.

---

## Task 3: Capability map + action-handler registry

**Files:** Create `src/lib/booking/capabilityMap.ts`(+test), `src/lib/booking/handlers/registry.ts`(+test); Modify `src/lib/booking/action-validator.ts`.

**Interfaces:**
```ts
export type Capability = 'refund'|'discount'|'adjust_stock'|'delete'|'manage_staff';
export function hasCapability(role: string, cap: Capability): boolean;
export interface ActionHandler {
  action: string; capability?: Capability; requiresConfirmation: boolean;
  validate(admin, tenantId, params, ctx): Promise<{ valid: boolean; error?: string }>;
  execute(admin, tenantId, params, ctx): Promise<{ success: boolean; error?: string; reply?: string }>;
}
export const HANDLERS: Record<string, ActionHandler>;
export async function dispatchValidate(admin, tenantId, action, params, ctx): Promise<{ handled: boolean; result?: {valid:boolean;error?:string} }>;
export async function dispatchExecute(admin, tenantId, action, params, ctx): Promise<{ handled: boolean; result?: {success:boolean;error?:string;reply?:string} }>;
```

- [ ] **Step 1:** Test `hasCapability`: owner→all true; staff→`refund` false, `record`-type true. Implement the map (default owner=all; staff safe subset).
- [ ] **Step 2:** Test the registry dispatch: an action present in `HANDLERS` returns `handled:true`; absent returns `handled:false` (legacy fallback). Implement `registry.ts` with an empty-but-typed `HANDLERS` initially.
- [ ] **Step 3:** In `action-validator.ts`, at the top of `validateAction`/`executeAction`, call `dispatchValidate`/`dispatchExecute`; if `handled`, return its result; else fall through to the existing switch. Add a regression test asserting an existing legacy action (e.g. `list_services`) still routes to the switch.
- [ ] **Step 4:** Run PASS + `npm run typecheck`; **Commit** `git commit -m "feat(commerce): strangler action-handler registry + capability map"`.

---

## Task 4: Product handlers

**Files:** Create `src/lib/booking/handlers/commerce.ts` (products section)(+test).

**Interfaces:** Registers handlers: `add_product`, `adjust_stock` (capability `adjust_stock`, confirm if |delta|>threshold), `set_price` (confirm), `set_availability`, `low_stock_query` (read).

- [ ] **Step 1:** Test `adjust_stock.execute` calls `recordMovement` with `movementType:'adjustment'`, `quantityChange:params.delta`, and emits `product.stock_adjusted`. Mock admin + recordMovement.
- [ ] **Step 2:** Run FAIL → implement product handlers. `set_price` updates `products.price_cents` + emits `product.price_changed` with before/after. `low_stock_query` selects `stock_quantity <= low_stock_threshold`.
- [ ] **Step 3:** Register them in `HANDLERS`. Test `low_stock_query` returns the formatted list.
- [ ] **Step 4:** PASS; **Commit** `git commit -m "feat(commerce): product command handlers"`.

---

## Task 5: Inventory handlers

**Files:** Create `src/lib/booking/handlers/inventory.ts`(+test).

**Interfaces:** `restock` (movement `purchase`, +qty), `record_stock_count` (records a counted qty — in this spec, an ad-hoc `adjustment` to match; spec 5 later attaches it to a session), `record_damage` (movement `damage`, confirm, reason required), `transfer_stock` (movement pair `transfer_out`/`transfer_in`; destination location deferred to spec 5 — for now record both with a `metadata.destination` note), `inventory_variance_query` (read: compare `stock_quantity` vs `Σ quantity_change`).

- [ ] **Step 1:** Test `record_damage` requires a reason (validate fails without) and posts a negative `damage` movement + emits `stock.damaged`.
- [ ] **Step 2:** Implement all inventory handlers via `recordMovement`. `transfer_stock` posts two movements atomically.
- [ ] **Step 3:** Register + test `inventory_variance_query`.
- [ ] **Step 4:** PASS; **Commit** `git commit -m "feat(commerce): inventory command handlers"`.

---

## Task 6: Retail-sale + refund handlers (atomic, reuse retail_orders)

**Files:** Extend `src/lib/booking/handlers/commerce.ts` (retail section)(+test).

**Interfaces:** `record_retail_sale` (creates `retail_order` paid/fulfilled + items + negative `sale` movement per item + `transaction` type `sale` with `subject_type='retail_order'`, all in one DB transaction; emits `retail_sale.recorded`), `refund_sale` (capability `refund`, confirm; refund `transaction` + `refund_restock` movement + order status; emits `order.refunded`), `record_outstanding_balance`.

- [ ] **Step 1:** Test `record_retail_sale.execute` on a 2-item sale: asserts an order row, 2 movements (`sale`, negative), a transaction with `subject_type='retail_order'`, and that a mid-way failure rolls all back (simulate the movement call throwing → no order persisted). Use a transaction wrapper (Supabase RPC or sequential with manual compensation — prefer a Postgres function `record_retail_sale_tx` if the repo uses RPCs; else wrap in a single RPC).
- [ ] **Step 2:** Implement. For atomicity, add a Postgres function in a migration `127_record_retail_sale_fn.sql` that inserts order+items+movements+transaction in one transaction, OR use the existing pattern in `commerce/retail-orders.ts` (grep it). Emit the business event after commit.
- [ ] **Step 3:** Implement `refund_sale` (links to original transaction via `original_transaction_id`, restocks). Test refund→restock movement created once (idempotent via `ai_action_log`).
- [ ] **Step 4:** PASS + typecheck; **Commit** `git commit -m "feat(commerce): atomic retail sale + refund handlers"`.

---

## Task 7: Order + customer + staff-extra handlers

**Files:** `src/lib/booking/handlers/commerce.ts` (orders), `handlers/customers.ts`, `handlers/staff.ts` (+tests).

**Interfaces:** Orders: `create_order`, `set_order_fulfillment`, `add_delivery_fee`, `cancel_order_restock` (confirm; restock movements). Customers: `lapsed_customers_query`, `add_customer_note`, `customer_history`, `set_customer_tag` (writes `customers.tags`). Staff: `staff_sales_query`, `staff_discount_query`, `set_staff_capability` (capability `manage_staff`, confirm — in this spec writes an intent to `ai_action_log`/metadata; §12 makes it write `tenant_user_permissions`).

- [ ] **Step 1:** Test `cancel_order_restock` posts `return` movements for each order item + sets order cancelled + emits `order.cancelled`.
- [ ] **Step 2:** Implement order handlers.
- [ ] **Step 3:** Implement customer handlers (`set_customer_tag` appends to `tags`; `lapsed_customers_query` = customers with no reservation/order in N days).
- [ ] **Step 4:** Implement staff handlers; `set_staff_capability` emits `staff.permission_changed` (persistence deferred to §12 — record intent for now).
- [ ] **Step 5:** PASS; **Commit** `git commit -m "feat(commerce): order, customer, and staff-extra handlers"`.

---

## Task 8: Wire dispatcher — idempotency, logging, capability, Pidgin parsing

**Files:** Modify `src/lib/whatsapp/v2/flows/ownerCommands.ts`; Create `src/lib/ai/parseNairaAmount.ts`(+test).

**Interfaces:** `parseNairaAmount(text): number|null` — deterministic word/number → cents ("thirty thousand" → 3_000_000; "₦18,000" → 1_800_000).

- [ ] **Step 1:** Test `parseNairaAmount` for digit, comma, and word forms. Implement (map units: thousand/million; handle "₦", "naira", "k").
- [ ] **Step 2:** In `handleOwnerCommand`, before executing a write: compute an `idempotency_key` (inbound message id else hash of tenant+actor+action+params), call `findByIdempotencyKey` — on hit return the prior reply; else proceed. After execute, `logAiAction`.
- [ ] **Step 3:** Enforce capability: if the resolved handler has a `capability` and `!hasCapability(role, cap)`, reply "not permitted" + emit `command.denied` + log outcome `denied`.
- [ ] **Step 4:** Test the dispatcher path: duplicate message → single execution; staff refund → denied+logged.
- [ ] **Step 5:** PASS + typecheck; **Commit** `git commit -m "feat(commerce): idempotency, logging, capability gating, Naira parsing in dispatcher"`.

---

## Self-Review

**Spec coverage:** §2/§3 registry → Tasks 3; §4 actions → Tasks 4–7; movement ledger (§M) → Tasks 1–2; idempotency+log (§5/§15) → Tasks 1,8; capability (§3.3) → Tasks 3,8; Pidgin (§6) → Task 8; retail reuse (§3.2) → Task 6. Extraction-prompt updates (new action types) fold into Task 3's registration + a prompt edit noted in Task 8.
**Placeholder scan:** Adaptation points (existing RPC param names, `commerce/retail-orders.ts` transaction pattern) are flagged with concrete greps — not placeholders.
**Type consistency:** `ActionHandler`/`HANDLERS`/`dispatchValidate`/`dispatchExecute` (Task 3) consumed by all handler tasks; `recordMovement`/`hasCapability`/`Capability` stable throughout.
**Cross-spec:** movement_type vocabulary matches consolidation §M/§P; `sale` kept for retail. Confirm `p_quantity_change` accepts `unit_cost_cents` (Task 2 Step 2) — if not, extend the function in migration 126.
