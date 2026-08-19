# Booka Service-to-Inventory Recipes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let services define expected materials so completing a booking consumes stock (per service line), attributes it to the appointment + staff, and flags unusual usage.

**Architecture:** Minimal units-of-measure on `products`; `service_material_recipes`/`recipe_items`/`service_consumption_records`. On reservation completion (the §A hook shared with spec 1), iterate `reservation_services` lines and post `service_consumption` movements via the existing RPC.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-service-inventory-recipes-design.md`.

## Global Constraints
- Depends on specs 2 (`recordMovement`, movement type `service_consumption`), 5 (locations). Migrations after spec-6.
- **Reservations multi-service** (§N): iterate `reservation_services` lines × their `quantity`.
- Consumption uses existing `inventory_movements` via RPC (`quantity_change` negative).
- Optional per service, configurable per tenant. Non-convertible UoM at recipe-save = **error (fail loud)**.
- Consumption variance → spec 3 `unusual_consumption` rule via a business event (consolidation §I).

## File Structure
- `db/migrations/132_recipes_uom.sql`(+rollback) — `products.base_uom`/`pack_size`; recipe + consumption tables.
- `src/lib/inventory/uom.ts` — `convert(qty, fromUom, toUom, packSize?)`.
- `src/lib/inventory/consumeRecipe.ts` — `consumeForReservation(admin, tenantId, reservationId, actorId)`.
- `src/app/api/owner/services/[id]/recipe/route.ts` (recipe editor).
- Modify: the completion hook (spec 1 Task 3 `markReservationCompleted`) to also call `consumeForReservation`.

---

## Task 1: Migration — UoM + recipe tables
- [ ] **Step 1:** `132_recipes_uom.sql`:
```sql
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS base_uom text, ADD COLUMN IF NOT EXISTS pack_size numeric;
CREATE TABLE IF NOT EXISTS public.service_material_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service_id uuid NOT NULL, is_active boolean NOT NULL DEFAULT true, notes text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smr_unique UNIQUE (tenant_id, service_id)
);
CREATE TABLE IF NOT EXISTS public.service_material_recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES public.service_material_recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL, variant_id uuid, default_quantity numeric NOT NULL, uom text NOT NULL, is_optional boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.service_consumption_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL, service_id uuid NOT NULL, product_id uuid NOT NULL, variant_id uuid,
  planned_quantity numeric NOT NULL, actual_quantity numeric, uom text NOT NULL, staff_id uuid,
  movement_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS service_role policies for all three.
```
Rollback drops the three tables + the two product columns.
- [ ] **Step 2:** Apply + verify. **Commit** `feat(recipes): UoM columns + recipe/consumption tables`.

---

## Task 2: UoM conversion
**Interfaces:** `convert(qty: number, fromUom: string, toUom: string, packSize?: number): number` — supports l↔ml, kg↔g, pack↔piece (via packSize); throws on non-convertible pairs.
- [ ] **Step 1:** Test: `convert(1,'l','ml')===1000`; `convert(2,'pack','piece',6)===12`; `convert(1,'ml','g')` throws.
- [ ] **Step 2:** Implement. **Commit** `feat(recipes): units-of-measure conversion`.

---

## Task 3: Recipe editor API
- [ ] **Step 1:** `GET/PUT /api/owner/services/[id]/recipe` (permission `MANAGE_PRODUCTS`). PUT validates each item's `uom` is convertible to the product's `base_uom` (else 400). Test the non-convertible rejection.
- [ ] **Step 2:** Implement. **Commit** `feat(recipes): recipe editor API with UoM validation`.

---

## Task 4: Consumption on completion
**Interfaces:** `consumeForReservation(admin, tenantId, reservationId, actorId): Promise<void>`.
- [ ] **Step 1:** Test: a reservation with two service lines (`reservation_services`), each service having a recipe, produces one `service_consumption_record` + one negative `service_consumption` movement per recipe item, scaled by line `quantity`. Optional items with no override still consume default.
- [ ] **Step 2:** Implement: fetch `reservation_services`; for each line's active recipe, for each item compute `planned = default_quantity × line.quantity` (actual overrides if supplied), `convert` to `base_uom`, call `recordMovement` (`service_consumption`, negative), insert a consumption record, link `movement_id`. All in one transaction with completion.
- [ ] **Step 3:** Hook into `markReservationCompleted` (spec 1 Task 3) — call `consumeForReservation` in the same transaction. Test end-to-end.
- [ ] **Step 4:** PASS; **Commit** `feat(recipes): consume materials on reservation completion (multi-service)`.

---

## Task 5: Consumption variance → anomaly + report
- [ ] **Step 1:** After consumption, if `actual` deviates from `planned` beyond a tenant threshold, emit `service.consumption_recorded` with variance; add a spec 3 `unusual_consumption` rule (triggerActions `['service.consumption_recorded']`). Test the rule raises above threshold.
- [ ] **Step 2:** Consumption report endpoint (per service / per staff over a period). **Commit** `feat(recipes): consumption variance anomaly + report`.

---

## Self-Review
**Spec coverage:** UoM+tables → Task 1–2; editor → Task 3; consumption (multi-service) → Task 4; variance → Task 5. **Placeholder scan:** clean. **Type consistency:** `convert`/`consumeForReservation` consistent; uses spec 2 `recordMovement`, spec 1 completion hook. **Cross-spec:** §A (shared completion hook — snapshot + consumption fire together), §I (variance via spec 3), §N (multi-service iteration) honored.
