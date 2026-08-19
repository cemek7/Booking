# Booka Inventory Variance & Shrinkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reconcile the movement ledger against physical counts — stock count sessions, ledger-derived expected quantities, variance + cost-value loss, shrinkage → `business_anomalies`, and idempotent `count_adjustment` posting.

**Architecture:** New `inventory_locations` + `stock_count_sessions`/`stock_count_items`, plus `location_id` on the existing `inventory_movements`. Expected is derived from `Σ quantity_change` at snapshot; approval posts `count_adjustment` via the existing RPC; shrinkage is raised by spec 3's registry via a `stock_count.approved` event.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-inventory-variance-shrinkage-design.md`.

## Global Constraints
- Depends on specs 2 (extended `inventory_movements` + `recordMovement`), 3 (`business_anomalies` registry), 4 (permissions).
- Signed column is **`quantity_change`**; `reference_id` **text**; writes via existing RPC (consolidation §M).
- Expected snapshot = `Σ quantity_change ≤ snapshot_at` per `(product, variant, location)`, `NULL location → tenant default`.
- **Uncounted items (`counted_quantity IS NULL`) skipped — never treated as zero.**
- **Movement-during-count** flags the item; flagged items not auto-posted.
- **One active session per `(tenant, location)`** (partial unique index).
- Shrinkage anomalies created by **spec 3's engine** via a `stock_shrinkage` rule triggered by `stock_count.approved` (consolidation §I). Counter = `PERFORM_STOCK_COUNTS`; approver = `ADJUST_INVENTORY`. Migrations after spec-4.

## File Structure
- `db/migrations/130_inventory_locations_counts.sql`(+rollback) — locations, `inventory_movements.location_id`, sessions, items; seed default location per tenant.
- `src/lib/inventory/stockCountService.ts` — `startСountSession`, `enterCount`, `computeVariance`, `approveSession`.
- `src/lib/inventory/expectedStock.ts` — `expectedAt(admin, tenantId, snapshotAt, locationId)`.
- `src/lib/anomalies/rules/inventory.ts` (modify) — add `stock_shrinkage` (triggerActions `['stock_count.approved']`) and ensure `stock_leaving_without_record` excludes `count_adjustment`.
- `src/app/api/owner/stock-counts/route.ts`, `.../[id]/route.ts`, `.../[id]/approve/route.ts`.
- `src/app/(dashboard)/owner/stock-counts/page.tsx`.

---

## Task 1: Migration + default-location seed
- [ ] **Step 1:** `130_inventory_locations_counts.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','review','approved','cancelled')),
  started_by uuid, snapshot_at timestamptz, approved_by uuid, approved_at timestamptz,
  shrinkage_value_cents bigint NOT NULL DEFAULT 0, notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session ON public.stock_count_sessions (tenant_id, location_id) WHERE status IN ('draft','counting','review');
CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.stock_count_sessions(id) ON DELETE CASCADE,
  product_id uuid NOT NULL, variant_id uuid, location_id uuid,
  expected_quantity integer NOT NULL, counted_quantity integer, variance integer,
  unit_cost_cents integer, variance_value_cents bigint, flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS service_role policies for all three tables (mirror pattern).
-- Seed one default location per tenant:
INSERT INTO public.inventory_locations (tenant_id, name, is_default)
  SELECT id, 'Main', true FROM public.tenants t
  WHERE NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.tenant_id = t.id AND l.is_default);
```
Add the three RLS policies. Rollback drops the three tables + `inventory_movements.location_id`.
- [ ] **Step 2:** Apply + verify seed created default locations. **Commit** `feat(inventory): locations + stock count tables + default seed`.

---

## Task 2: Expected-stock derivation
**Interfaces:** `expectedAt(admin, tenantId, snapshotAt, locationId): Promise<Map<string /*product|variant*/, number>>` — `Σ quantity_change` where `created_at <= snapshotAt` and `COALESCE(location_id, default) = locationId`, grouped by `(product_id, variant_id)`.
- [ ] **Step 1:** Test: given movements (+10 purchase, −3 sale) for product P at/under snapshot, expected = 7; a movement after snapshot excluded; NULL-location movement counted under default.
- [ ] **Step 2:** Implement (query + in-memory group; coalesce NULL location to the tenant default id).
- [ ] **Step 3:** PASS; **Commit** `feat(inventory): ledger-derived expected stock at snapshot`.

---

## Task 3: Session lifecycle + variance
**Interfaces:** `startCountSession(admin, tenantId, locationId, startedBy)`, `enterCount(admin, itemId, counted)`, `computeVariance(item)`, `approveSession(admin, sessionId, approverId)`.
- [ ] **Step 1:** Test `startCountSession` snapshots expected into `stock_count_items` per `(product,variant,location)` with `unit_cost_cents` from `products.cost_price_cents` (flag `cost_unknown` when null); sets `snapshot_at`, status `counting`.
- [ ] **Step 2:** Implement start (enumerate stocked products/variants; freeze expected via `expectedAt`).
- [ ] **Step 3:** Test `enterCount` validates `counted >= 0`; computes `variance` + `variance_value_cents`; flags `extreme_variance` when |variance| > N×expected.
- [ ] **Step 4:** Implement enter + variance.
- [ ] **Step 5:** PASS; **Commit** `feat(inventory): stock count session start + count entry + variance`.

---

## Task 4: Movement-during-count flag + approval posting
- [ ] **Step 1:** Test: on approve, an item with a non-`count_adjustment` movement in `[snapshot_at, now]` is flagged `moved_during_count` and NOT posted; a clean counted item with variance posts a `count_adjustment` via `recordMovement` (`quantity_change=variance`, `reference_type='stock_count_item'`).
- [ ] **Step 2:** Test **uncounted items (`counted_quantity IS NULL`) are skipped** (no adjustment, no variance).
- [ ] **Step 3:** Implement `approveSession`: guard status (only `review`/`counting`→`approved`, idempotent — re-approve no-op); per counted+unflagged nonzero-variance item post `count_adjustment`; set session `shrinkage_value_cents`; emit `stock_count.approved` business event with per-item variance payload.
- [ ] **Step 4:** PASS; **Commit** `feat(inventory): count approval posts idempotent count_adjustments (guards)`.

---

## Task 5: Shrinkage rule + APIs + dashboard
- [ ] **Step 1:** In `anomalies/rules/inventory.ts` add `stock_shrinkage` (mode realtime, triggerActions `['stock_count.approved']`) reading the event payload → raises anomalies for negative variance beyond threshold. Ensure `stock_leaving_without_record` excludes `count_adjustment`. Test both.
- [ ] **Step 2:** APIs: `/api/owner/stock-counts` (create/list), `/[id]` (items + enter), `/[id]/approve`. Permissions: create/enter `PERFORM_STOCK_COUNTS`; approve `ADJUST_INVENTORY`. (Use `permissions:[]` from §12.)
- [ ] **Step 3:** Dashboard page: session list, count entry grid, variance report, approve.
- [ ] **Step 4:** PASS + typecheck; **Commit** `feat(inventory): shrinkage rule + stock-count APIs + dashboard`.

---

## Self-Review
**Spec coverage:** locations+tables → Task 1; expected → Task 2; lifecycle+variance → Task 3; flags+approval → Task 4; shrinkage+APIs+UI → Task 5. **Placeholder scan:** clean. **Type consistency:** `expectedAt`/`startCountSession`/`enterCount`/`approveSession` consistent; uses spec 2's `recordMovement`. **Cross-spec:** §I (shrinkage via spec 3), §B (exclude count_adjustment), §M (`quantity_change`, RPC) honored.
