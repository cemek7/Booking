# Booka Discount, Refund & Adjustment Controls — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Sixth sub-project (§11). The approval-workflow + threshold layer that §12 (gates)
and spec 3 (detection) point to. Depends on specs 2 (commands), 3 (anomalies), 4 (permissions).

**Scope decisions (self-made, flagged):** generic `approval_requests`/`approval_actions`
framework covering `discount | refund | stock_adjustment`; per-role threshold policies in a
queryable table; over-limit actions become pending approval requests inside spec 2's
dispatcher rather than executing. Numeric thresholds live here; boolean permission gates stay
in §12.

---

## 1. Objective
Stop uncontrolled manual money changes: require reasons + approval for discounts/refunds
above configurable limits, route over-limit actions through an approval workflow with
separation of duties, and record who approved what.

## 2. Current-state findings
- No approval tables. `transactions` already has `refund_amount`, `refund_reason`,
  `original_transaction_id` (refund→original linkage exists).
- Spec 1 added `discount_cents`/`discount_reason` on `reservations` & `retail_orders`.
- Spec 2 executes discounts/refunds immediately (confirmation only). §12 defines gates
  `ISSUE_DISCOUNTS`, `ISSUE_REFUNDS`, `APPROVE_LARGE_DISCOUNTS`, `APPROVE_REFUNDS`.
- Spec 3 already detects `excessive_manual_discount`, `refund_without_reason` — §11 is the
  *preventive* layer to spec 3's *detective* layer.

## 3. Architecture

### 3.1 Threshold policies
`tenant_approval_policies` (per tenant): `request_type` (discount|refund|stock_adjustment),
`role` (staff|manager), `max_self_approve` (numeric — % for discount, cents for refund,
qty for stock_adjustment), `requires_permission` (which §12 permission approves above it).
Defaults seed the backlog example: staff discounts ≤5%, manager 5–15%, owner >15%.

### 3.2 Generic approval framework
- **`approval_requests`**: `request_type`, `status` (pending|approved|rejected|expired),
  `requested_by`, `subject_type`/`subject_id` (reservation|retail_order|transaction|product),
  `amount` / `percent`, `reason` (required above threshold), `action_payload jsonb` (the
  original `AIResponse`/params to execute on approval), `required_permission`,
  `expires_at`, `created_at`.
- **`approval_actions`** (append-only): `request_id`, `actor_id`, `decision`
  (approve|reject), `note`, `created_at` — the audit trail of who decided.

### 3.3 Dispatcher integration (spec 2)
When a write handler computes a discount/refund/adjustment that **exceeds the actor's
`max_self_approve`** for their role:
1. Do **not** execute. Create an `approval_request` (pending) with the `action_payload`.
2. Reply "Sent to <role> for approval" (WhatsApp) / show pending (dashboard).
3. On approval by a holder of `required_permission` (via dashboard or a `resolve_approval`
   WhatsApp command), **re-validate** the payload (prices/stock may have changed) and execute
   the original action in a transaction. Emit `business_events` `approval.requested`,
   `approval.approved`/`approval.rejected` + the underlying action event.
Below-threshold actions execute as today (reason still required above the reason-threshold).

### 3.4 Separation of duties
- **Approver ≠ requester** (enforced; can't approve your own request).
- Approver must hold `required_permission` (§12).
- Reasons mandatory above the reason threshold (discounts) and for all refunds.
- Refunds link to `original_transaction_id` + the sale's `subject_*` (spec 1) and restore
  inventory (spec 2 `refund_sale`) — §11 adds only the approval gate, not new refund mechanics.

## 4. Delivery & alerts
- Dashboard: pending-approvals queue (filter by type/requester), approve/reject with note;
  policy editor.
- WhatsApp: requester notified of pending; approver notified of new request (debounced,
  reuse spec 3 alert path); `resolve_approval` command.
- Pattern alerts reuse **spec 3** (`excessive_manual_discount`, refund spikes) — no parallel
  alerting.

## 5. Data model summary
`tenant_approval_policies` · `approval_requests` · `approval_actions` (append-only). All:
`id`, `tenant_id`, timestamps, RLS tenant-scoped, cents for money.

## 6. Testing
Below-threshold executes directly · over-threshold creates pending request, does NOT execute ·
approval re-validates + executes original in a transaction · **approver ≠ requester enforced** ·
approver lacking `required_permission` denied · reason required above threshold / all refunds ·
expired request can't be approved · policy tiers (staff 5% / manager 15% / owner) resolve
correctly · refund links to original + restores inventory once · idempotent approval (no
double-execute) · business_events emitted · tenant isolation.

## 7. Boundaries
- Boolean "can this user discount/refund at all" = §12; numeric limits + workflow = §11.
- Detection/anomalies = spec 3; §11 is prevention.
- Stock-adjustment approval: framework supports it; wiring spec 5's count approvals through
  `approval_requests` is optional (they already have their own approve step) — documented, not required.

## 8. Implementation order
1. Migrations: `tenant_approval_policies` (+ default seed), `approval_requests`,
   `approval_actions` (+ RLS, rollbacks).
2. Threshold resolution helper (role + policy → limit).
3. Dispatcher hook: over-limit → pending request (spec 2 handlers).
4. Approval execution path (re-validate + execute payload) + separation-of-duties guards.
5. `resolve_approval` command + dashboard approvals queue + policy editor.
6. business_events wiring; reuse spec 3 alerts.
7. Docs update.
