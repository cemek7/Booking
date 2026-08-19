# Booka Service-to-Inventory Recipes — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Seventh sub-project (§5). Continues Inventory Variance (spec 5) — services
auto-consume materials. Depends on specs 2 (`inventory_movements`), 5 (locations), and the
completion hook (consolidation §A).

**Scope decisions (self-made):** introduce a minimal units-of-measure concept; recipes are
optional per service and configurable per tenant; consumption posts `service_consumption`
movements on completion; consumption variance feeds spec 3 anomalies.

---

## 1. Objective
Let a service define expected materials so completing it automatically consumes stock,
attributes it to the appointment + staff, and flags unusual usage.

## 2. Current-state findings
No recipes/consumption/UoM tables. `products.stock_quantity` is unit-based; `product_variants`
has `weight_grams`/`volume_ml` hints. `inventory_movements.movement_type` already includes
`service_consumption`.

## 3. Units of measure (minimal)
- Add to `products`: `base_uom` (piece|pack|ml|l|g|kg), `pack_size numeric` (units per pack
  where relevant). Stock stays counted in `base_uom`.
- A small conversion helper (l↔ml, kg↔g, pack↔piece via `pack_size`). Recipe quantities are
  stored with a `uom` and converted to the product's `base_uom` at consumption time.
  Non-convertible mismatches are a validation error at recipe-save (fail loud, not silent).

## 4. Data model (new; RLS tenant-scoped)
- **`service_material_recipes`**: `service_id`, `is_active`, `notes`. Optional per service.
- **`service_material_recipe_items`**: `recipe_id`, `product_id`, `variant_id`,
  `default_quantity numeric`, `uom`, `is_optional bool`.
- **`service_consumption_records`**: `reservation_id`, `service_id`, `product_id`,
  `variant_id`, `planned_quantity`, `actual_quantity` (nullable → defaults to planned),
  `uom`, `staff_id`, `movement_id → inventory_movements`, `created_at`.

## 5. Flow
On reservation completion (the same hook that writes `price_cents_snapshot`, consolidation §A):
**Iterate over the reservation's `reservation_services` lines** (reservations are
multi-service — spec 1 correction); for each service line with an active recipe:
1. For each recipe item, create a `service_consumption_record` with `planned_quantity`
   × the line's `reservation_services.quantity` (and `actual_quantity` if supplied).
2. Convert to `base_uom`, post an `inventory_movements` row via the existing RPC with
   `movement_type='service_consumption'`, `quantity_change` negative,
   `reference_type='reservation'` (`reference_id` text), in the same transaction as
   completion; link `movement_id`.
3. Staff can override actual usage (via dashboard or a WhatsApp field on completion) — actual
   overrides planned for the movement.

## 6. Consumption variance
`actual − planned` per item. Beyond a tenant threshold → emit a business event that spec 3's
registry turns into an `unusual_consumption` anomaly (single producer, same pattern as
`stock_shrinkage`). Reporting: consumption per service / per staff over a period.

## 7. Permissions & surface
Recipe management: `MANAGE_PRODUCTS` (or `MANAGE_APPOINTMENTS` — reconcile). Consumption is a
side effect of `COMPLETE_SERVICES`. Dashboard: recipe editor per service; consumption report.

## 8. Testing
Recipe save with UoM conversion (and non-convertible → error) · completion consumes each
recipe item as a `service_consumption` movement (atomic with completion) · optional items ·
actual overrides planned · consumption variance → anomaly above threshold · missing recipe →
no consumption · tenant isolation · per-tenant/ per-service opt-in respected.

## 9. Boundaries
Only decrements stock via the movement ledger (spec 2). Loss valuation reuses `cost_price_cents`.
Multi-location consumption uses the reservation's location (spec 5) or tenant default.

## 10. Implementation order
1. Migrations: `products.base_uom`/`pack_size`, recipe tables, consumption table (+ RLS, rollbacks).
2. UoM conversion helper.
3. Recipe editor API + dashboard.
4. Completion hook: consume recipe → movements (atomic) + records.
5. Actual-usage override; consumption variance → spec 3 rule.
6. Consumption report + docs.
