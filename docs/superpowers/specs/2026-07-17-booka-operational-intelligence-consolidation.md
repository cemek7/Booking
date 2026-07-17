# Booka Operational Intelligence — Cross-Spec Consolidation

**Date:** 2026-07-17
**Purpose:** Integration checklist across the Operational Intelligence sub-project specs, so
overlapping gaps and shared concerns are resolved once, not per-spec. Read alongside the
individual design docs. This is a living index — update as specs are added.

## Spec stack & dependency order

| # | Spec | File | Depends on |
|---|------|------|-----------|
| 1 | Business Ledger & Daily Close | 2026-07-15-booka-business-ledger-daily-close-design.md | — |
| 2 | Owner Commerce Commands | 2026-07-16-booka-owner-commerce-commands-design.md | 1 |
| 3 | Revenue Assurance | 2026-07-16-booka-revenue-assurance-design.md | 1, 2 |
| 4 | Granular Permissions | 2026-07-17-booka-granular-permissions-design.md | 2, 3 (rewires their stub) |
| 5 | Inventory Variance & Shrinkage | 2026-07-17-booka-inventory-variance-shrinkage-design.md | 2, 3, 4 |
| 6 | Discount, Refund & Adjustment Controls | 2026-07-17-booka-discount-refund-controls-design.md | 2, 3, 4 |
| 7 | Service-to-Inventory Recipes | 2026-07-17-booka-service-inventory-recipes-design.md | 2, 5, hook §A |
| 8 | Customer Commerce Memory | 2026-07-17-booka-customer-commerce-memory-design.md | 1, 2 |
| 9 | Multimodal Capture | 2026-07-17-booka-multimodal-capture-design.md | 2, 5 |
| 10 | Conversational Analytics & Briefings | 2026-07-17-booka-conversational-analytics-briefings-design.md | 1, 2, 3 |
| 11 | AI Recommendations | 2026-07-17-booka-recommendations-design.md | 2, 5, 8, 10 |

**Build order: 1 → 2 → 3 → 4 → 5**, then 6–11 (looser coupling; 6/8 can follow 4, 7 after 5,
9 after 5, 10 after 3, 11 last as it consumes 8 + 10). (4 rewires the capability stub 2 & 3
ship with; 5 adds a rule to 3's registry and a column to 2's table.)

**Specs 6–11 had scope self-decided** (flagged in each doc's header) rather than via the
scoping dialogue used for 1–5 — worth a user pass before planning those.

## Cross-spec action items (resolve during implementation)

### A. Reservation completion hook is unowned  *(spec 1 ↔ spec 2)* — **BLOCKING for spec 1**
`'completed'` reservation status is used widely, but there is **no `mark_completed` action**
in `action-validator.ts` and spec 2 did not add one. Spec 1's `price_cents_snapshot` must be
written on the completion transition.
- **Do:** identify the code path(s) that set `reservations.status='completed'` (auto-complete
  job? dashboard? calendar sync?) and write `price_cents_snapshot` there.
- **Do:** add a `mark_service_completed` owner command (backlog §1 lists "Mark appointment
  204 as completed") — belongs in spec 2's service coverage; add it there or as a spec-2 addendum.
- **Risk if missed:** completed services have NULL price snapshot → close-report expected
  revenue is understated. High impact on the whole ledger.

### B. Inventory stock-rule double-flagging  *(spec 3 ↔ spec 5)*
Spec 3's `stock_leaving_without_record` rule and spec 5's `stock_shrinkage` rule can both
fire on the same shortage.
- **Do:** `stock_leaving_without_record` must **exclude `count_adjustment` movements** (they
  are explained by an approved count). Spec 5's `stock_shrinkage` is the sole flag for
  count-confirmed loss.

### C. Business-event action registry  *(all specs)*
Specs emit ad-hoc action strings (`order.refunded`, `retail_sale.recorded`,
`payment.recorded`, `staff.permission_changed`, `command.denied`, `access.denied`,
`anomaly.*`, `reconciliation.computed`, `stock_count.approved`, …). No single source of truth.
- **Do:** create a shared `BUSINESS_EVENT_ACTIONS` constant (in spec 1's `business_events`
  module) and reference it everywhere. Spec 3's real-time rule `triggerActions` and any
  analytics keys must use it. Prevents silent drift that breaks rules/analytics.

### D. Capability → permission rewire checklist  *(spec 4 rewires 2 & 3)*
Specs 2 & 3 ship an ad-hoc `capability` enum
(`refund|discount|adjust_stock|delete|manage_staff|approve_anomalies`). Spec 4 replaces it.
- **Do:** enumerate every call site before rewiring: owner-command dispatcher (spec 2, all
  write handlers), `set_staff_capability` (spec 2), anomaly APIs + PATCH (spec 3),
  stock-count APIs (spec 5). Map each to a `PERMISSIONS.*` constant per spec 4 §3.4.
- **Risk if missed:** a handler left on the removed stub → unguarded action.

### E. `inventory_movements.location_id` forward-compat  *(spec 2 ↔ spec 5)*
Spec 5 adds `location_id` to spec 2's `inventory_movements`. If built together, fold it into
spec 2's table definition; if sequential, spec 5's additive migration covers it. Either way,
spec 2's stock projection must key by `(product, variant, location)` once spec 5 lands.

### F. WhatsApp evening delivery is one message  *(spec 1 ↔ spec 3)*
Spec 1's daily close report and spec 3's anomaly digest both deliver in the evening. Spec 3
**folds** its digest into spec 1's close-report payload — implement as a single owner message,
not two. Real-time high/critical anomaly alerts (spec 3) are the only separate sends.

### G. Permissions on specs 1 & 3 routes  *(spec 4)*
Specs 1 & 3 ship with `roles:[]` checks; spec 4 adds `permissions:[]`. Suggested mapping:
close-report APIs → `VIEW_REVENUE`; anomaly APIs → `APPROVE_ANOMALIES` (read) /
resolution → `APPROVE_ANOMALIES`; stock-count APIs → `PERFORM_STOCK_COUNTS`/`ADJUST_INVENTORY`.
Populating `effectivePermissions` must not regress routes still using only `roles:[]`.

## Shared conventions (apply to every spec)
- **Money:** integer cents; currency carried on the record.
- **Tenant isolation:** RLS mirroring the existing service-role + tenant policy pattern.
- **Append-only tables** (`business_events`, `inventory_movements`): REVOKE UPDATE/DELETE.
- **Idempotency:** domain-appropriate unique key (ledger: `(tenant, business_date)`;
  AI actions: `ai_action_log.idempotency_key`; anomalies: partial-unique `dedup_key`;
  count adjustments: per-item reference).
- **Determinism:** all financial/stock math outside the LLM; LLM only composes grounded prose.
- **Migrations:** additive/nullable, paired `_rollback.sql`, no premature historical backfill.

## Additional cross-spec items (specs 6–11)

### H. Completion hook is load-bearing for spec 7 too  *(spec 1 ↔ 7, see §A)*
Spec 7 (recipes) consumes materials on reservation completion — the **same** hook that writes
`price_cents_snapshot` (§A). Implement the completion hook once, fire both snapshot + recipe
consumption from it. §A is now doubly blocking.

### I. Single anomaly producer holds for specs 5 & 7  *(spec 3)*
`stock_shrinkage` (spec 5) and `unusual_consumption` (spec 7) are both **rules added to spec 3's
registry**, triggered by `stock_count.approved` / service-completion events. No spec creates
anomalies directly — all go through spec 3's engine (consolidation §C action names apply).

### J. Approval framework vs stock-count approval  *(spec 6 ↔ 5)*
Spec 5's count approval and spec 6's `approval_requests` are separate mechanisms. Routing
count adjustments through spec 6 is **optional** (spec 5 has its own approve step) — do not
double-gate. Discounts/refunds use spec 6; stock counts use spec 5.

### K. Everything executes through spec 2  *(specs 9, 11)*
Multimodal capture (9) and recommendations (11) never write business tables directly — a
confirmed extraction / an accepted recommendation runs its `proposed_action` through spec 2's
`validateAction`/`executeAction` (idempotent via `ai_action_log`), inheriting §12/§11 gates.

### L. Evening delivery stays one message  *(specs 1, 3, 10)*
Close report (1) + anomaly digest (3) + evening briefing (10) are the **same** WhatsApp
message (consolidation §F). Only real-time high/critical anomaly alerts and recommendation
nudges are separate, debounced sends.

## Grounding corrections from the 2026-07-17 thorough review (apply everywhere)

### M. `inventory_movements` PRE-EXISTS — extend, never create  *(specs 2, 5, 7)* — **BLOCKING**
The table already exists and is in active use via `src/lib/services/inventory-service.ts` + a
`p_quantity_change` stored procedure. Canonical facts for all inventory specs:
- Signed column is **`quantity_change`** (NOT `quantity_delta`); projection columns
  `previous_quantity`/`new_quantity` are RPC-maintained; `reference_id` is **text**.
- `movement_type` existing values: `sale`, `damage`, `adjustment`. New causes
  (`refund_restock`, `return`, `transfer_in`/`out`, `count_adjustment`, `service_consumption`,
  `expiry`, `purchase`) are **added to the existing CHECK/enum** — keep `sale` for retail sales
  (no `retail_sale`).
- **All** stock changes route through the existing `inventory-service.ts` / RPC (extended for
  new types + `unit_cost_cents`) — no parallel write path.
- Immutability by convention (no UPDATE/DELETE code paths), **not** a REVOKE (the RPC updates
  projection columns).
- Spec 2 adds `unit_cost_cents`; spec 5 adds `location_id`.

### N. Reservations are MULTI-SERVICE  *(specs 1, 7)* — **BLOCKING**
`reservation_services` (`reservation_id`, `service_id`, `quantity`) — a booking has one *or
more* service lines. Revenue = `Σ (services.price_cents × quantity)` over the lines;
`price_cents_snapshot` is the reservation total. Recipe consumption (spec 7) iterates the lines.
Any "reservation × one service" assumption is wrong.

### O. Deposits exist  *(specs 1, 3)*
`transactions.type` includes `deposit` (+ `payment`, `sale`, `refund`); a deposits module
exists. Deposits are partial payments: spec 1 counts them in recorded payments and nets them
in outstanding; spec 3's `deposits_not_applied` is a **shipped** rule, not deferred.

### P. movement_type is a shared vocabulary  *(specs 2, 3, 5, 7)*
One canonical `movement_type` list (item M) is referenced by: spec 2 (commerce causes),
spec 3 rules (`stock_leaving_without_record` excludes `count_adjustment`), spec 5
(`count_adjustment`), spec 7 (`service_consumption`). Define it once (with the action-name
registry, §C) and reference everywhere.

## Backlog coverage
All 17 backlog sections are now specced across sub-projects 1–11. Not yet specced: tenant-defined
**custom roles** (deferred by §12), and any Phase-by-Phase UI polish beyond each spec's surface.
