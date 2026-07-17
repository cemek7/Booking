# Booka Inventory Variance & Shrinkage — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Fifth sub-project (§4, Phase 3, variance core). Depends on Owner Commerce Commands
(2026-07-16, `inventory_movements`), Revenue Assurance (2026-07-16, `business_anomalies`),
and Granular Permissions (2026-07-17). §5 service recipes are a separate follow-up.

---

## 1. Objective
Reconcile the immutable `inventory_movements` ledger against physical reality: stock count
sessions, ledger-derived expected quantities, variance + cost-value loss, shrinkage flags
into `business_anomalies` (spec 3), and an approval step that posts `count_adjustment`
movements to true-up the ledger.

## 2. Current-state findings
- No `locations`/`branches` table (a `locations` API and `location_id` on 2 unrelated tables
  exist). Spec 2 ships `transfer_stock` with no destination → this spec adds minimal locations.
- No units-of-measure system (deferred with §5).
- `inventory_movements` (spec 2, unbuilt) has `product_id`, nullable `variant_id`,
  `movement_type` incl. `count_adjustment`/`transfer_in`/`transfer_out`, cached
  `products.stock_quantity` projection.

## 3. Data model (new unless noted; RLS tenant-scoped; cents)
- **`inventory_locations`** (minimal): `name`, `is_default bool`, `is_active bool`,
  `metadata jsonb`. Migration **seeds one default location per existing tenant**. Cannot
  delete the default or a location with stock/movements.
- **`inventory_movements`** (PRE-EXISTING table, extended by spec 2 — see spec 2 §5.1
  correction; signed column is **`quantity_change`**, not `quantity_delta`) — **+ nullable
  `location_id`** (queries coalesce `NULL → tenant default`). Stock projection keyed by
  `(product_id, variant_id, location_id)`. *(Additive migration on the existing table.)*
- **`stock_count_sessions`**: `location_id`, `status` (draft|counting|review|approved|
  cancelled), `started_by`, `snapshot_at`, `approved_by`, `approved_at`,
  `shrinkage_value_cents` (cached Σ of items), `notes`. **Unique partial index: one active
  session per `(tenant_id, location_id)` where status in (draft,counting,review).**
- **`stock_count_items`**: `session_id`, `product_id`, `variant_id`, `location_id`,
  `expected_quantity` (frozen at snapshot), `counted_quantity` (nullable until entered),
  `variance`, `unit_cost_cents` (snapshot from `cost_price_cents`), `variance_value_cents`,
  `flags jsonb` (e.g. `moved_during_count`, `extreme_variance`, `cost_unknown`).

## 4. Workflow
1. Owner starts a count for a location → **snapshot** expected quantities per
   `(product, variant, location)` from the ledger (`Σ quantity_change ≤ snapshot_at`,
   `NULL location → default`), frozen into items with `unit_cost_cents`.
2. Staff enter `counted_quantity` (dashboard, or spec 2's WhatsApp `record_stock_count`
   attaches to the open session for that location). Validate `counted ≥ 0`.
3. Per item: `variance = counted − expected`, `variance_value_cents = variance × unit_cost`.
   Session shrinkage total = Σ negative variance value.
4. Owner reviews and approves.
5. On approve, for each **counted, unflagged** item with `variance ≠ 0`: post an
   `inventory_movements` row via the existing RPC with `movement_type='count_adjustment'`,
   `quantity_change=variance`, `reference_type='stock_count_item'`, `reference_id=item.id`
   (text). Ledger now equals physical.
   **Idempotent** (approved sessions cannot re-post; per-item reference unique).

## 5. Correctness guards
- **Uncounted items (`counted_quantity IS NULL`) are skipped** — never treated as zero
  (would post catastrophic false shrinkage).
- **Movement-during-count**: if any non-`count_adjustment` movement for a counted product
  occurred in `[snapshot_at, approval]`, the item is **flagged and NOT auto-posted**; the
  owner must re-count (resets the flag if no further movement) or explicitly confirm. Counts
  are expected at low-activity; the flag catches the exception.
- **Extreme variance** (e.g. |variance| > N× expected) flagged for review, still allowed.

## 6. Shrinkage → anomalies & loss valuation
On approval, the session emits a `stock_count.approved` business event carrying per-item
variance data. **Spec 3's rules engine gains a `stock_shrinkage` rule**
(`mode: realtime`, `triggerActions: ['stock_count.approved']`) that raises
`business_anomalies` (`domain=inventory`, linked to session+product) for negative variances
beyond a tenant threshold — keeping anomaly creation in spec 3's single producer.
**Spec 3's `stock_leaving_without_record` rule must exclude `count_adjustment` movements**
(they are explained by the count) to avoid double-flagging. `unit_cost_cents` drives loss
value; missing `cost_price_cents` → item flagged `cost_unknown`, value not fabricated.

## 7. Permissions (§12) & surface
- Counting/entry: `PERFORM_STOCK_COUNTS`. Approving adjustments: `ADJUST_INVENTORY` (or owner)
  — separation of duties from the counter noted.
- APIs: `/api/owner/stock-counts` (session CRUD), `/:id/items` (enter counts),
  `/:id/approve`. Dashboard: session list, count entry, variance report, approve.

## 8. Testing
Ledger-derived expected snapshot (NULL-location coalesced) · per-`(product,variant,location)`
enumeration · variance + cost-value math · **uncounted skipped, not zero** ·
**movement-during-count flag + resolution** · extreme-variance flag · approval posts
idempotent `count_adjustment` (ledger==physical after; re-approve no-op) · `stock_shrinkage`
anomaly above threshold via spec 3 · `stock_leaving_without_record` excludes count_adjustment ·
missing-cost flagged not fabricated · one-active-session-per-location constraint ·
`PERFORM_STOCK_COUNTS`/`ADJUST_INVENTORY` gating · transfer destination valid ·
tenant isolation (RLS).

## 9. Deferred
§5 service recipes + units-of-measure · multi-location beyond a default (modeled, optional) ·
handwritten count-sheet upload (Phase 4 multimodal).

## 10. Implementation order
1. Migration: `inventory_locations` (+ seed defaults), `inventory_movements.location_id`,
   `stock_count_sessions`, `stock_count_items` (+ RLS, constraints, rollbacks).
2. Snapshot/variance service (ledger-derived expected, per-location).
3. Count entry (dashboard + spec 2 `record_stock_count` attach) with validation + flags.
4. Approval → idempotent `count_adjustment` posting.
5. `stock_count.approved` event + spec 3 `stock_shrinkage` rule + exclude count_adjustment
   from `stock_leaving_without_record`.
6. APIs + dashboard (session list, entry, variance report, approve).
7. Docs update.

Ship as small reviewable units.
