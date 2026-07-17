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

**Build order: 1 → 2 → 3 → 4 → 5.** (4 rewires the capability stub 2 & 3 ship with; 5 adds
a rule to 3's registry and a column to 2's table.)

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

## Remaining backlog (not yet specced)
§11 discount/refund controls (owns thresholds + approval workflow; seam with spec 4) ·
§5 service-to-inventory recipes + units-of-measure (continues spec 5) ·
§10 customer commerce memory · Phase 4 multimodal capture (§2) ·
Phase 5 analytics & briefings (§7/§8) · Phase 6 recommendations (§9).
