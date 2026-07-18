# Booka Discount, Refund & Adjustment Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an approval-workflow + threshold layer: over-limit discounts/refunds/stock-adjustments become pending `approval_requests` instead of executing; approval re-validates and executes with separation of duties.

**Architecture:** Per-role `tenant_approval_policies`; a generic `approval_requests`/`approval_actions` framework; the owner-command dispatcher (spec 2) creates a pending request when an action exceeds the actor's limit and executes the stored `action_payload` on approval.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-discount-refund-controls-design.md`.

## Global Constraints
- Depends on specs 2 (dispatcher + `AIResponse` payload), 3 (reuse its alert path), 4 (approval permissions).
- Numeric thresholds here; boolean gates in §12. Reasons required above threshold + for all refunds.
- **Approver ≠ requester**; approver holds `required_permission`. Approval **re-validates** payload before executing (prices/stock may have changed). Idempotent (no double-execute).
- Refunds link to `original_transaction_id` + subject; restore inventory via spec 2's `refund_sale` — §11 adds only the gate. Migrations after spec-5.

## File Structure
- `db/migrations/131_approvals.sql`(+rollback) — policies, requests, actions; seed default tiers.
- `src/lib/approvals/policy.ts` — `resolveLimit(role, requestType, policies)`.
- `src/lib/approvals/requests.ts` — `createApprovalRequest`, `decideApproval` (guards + execute).
- Modify: spec 2 dispatcher (over-limit → pending), `src/lib/booking/handlers/staff.ts` (`resolve_approval` command).
- `src/app/api/owner/approvals/route.ts`, `.../[id]/route.ts` (list, decide).
- `src/app/(dashboard)/owner/approvals/page.tsx` + policy editor.

---

## Task 1: Migration + default policies
- [ ] **Step 1:** `131_approvals.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.tenant_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('discount','refund','stock_adjustment')),
  role text NOT NULL, max_self_approve numeric NOT NULL, requires_permission text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT tap_unique UNIQUE (tenant_id, request_type, role)
);
CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_type text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_by uuid, subject_type text, subject_id uuid, amount numeric, percent numeric, reason text,
  action_payload jsonb NOT NULL, required_permission text NOT NULL, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.approval_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  actor_id uuid, decision text NOT NULL CHECK (decision IN ('approve','reject')), note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS service_role policies for all three.
```
Rollback drops all three. Seed default tiers (staff discount 5, manager discount 15) in a follow-up `INSERT ... SELECT` per tenant or lazily in `resolveLimit`.
- [ ] **Step 2:** Apply + verify. **Commit** `feat(approvals): policy/request/action tables`.

---

## Task 2: Threshold resolution + request lifecycle
**Interfaces:** `resolveLimit(role, requestType, policies): number` (defaults staff 5%/manager 15% for discount when no row); `createApprovalRequest(admin, {...})`; `decideApproval(admin, {requestId, actorId, actorPerms, decision, note})`.
- [ ] **Step 1:** Test `resolveLimit`: staff discount → 5; manager → 15; owner → Infinity.
- [ ] **Step 2:** Implement policy resolution.
- [ ] **Step 3:** Test `decideApproval` guards: approver == requester → throws; approver lacks `required_permission` → throws; expired request → throws; valid approve → executes `action_payload` and sets status `approved`.
- [ ] **Step 4:** Implement `createApprovalRequest` (emits `approval.requested`) and `decideApproval` — on approve, **re-run spec 2 `validateAction` then `executeAction`** on `action_payload` (idempotent), record an `approval_actions` row, emit `approval.approved`/`approval.rejected`.
- [ ] **Step 5:** PASS; **Commit** `feat(approvals): threshold resolution + guarded decision + re-validated execution`.

---

## Task 3: Dispatcher integration
- [ ] **Step 1:** In the spec 2 dispatcher, before executing a discount/refund/stock-adjust write, compute the actor's limit; if exceeded, call `createApprovalRequest` with the `AIResponse` as `action_payload` and reply "sent for approval" (do NOT execute). Test: a 20% discount by staff → pending request, no execution; a 3% discount → executes directly.
- [ ] **Step 2:** Enforce reason: above the reason threshold (discount) or any refund without a reason → validation error requesting a reason.
- [ ] **Step 3:** PASS; **Commit** `feat(approvals): over-limit actions route to pending approval`.

---

## Task 4: resolve_approval command + APIs + dashboard
- [ ] **Step 1:** Add a `resolve_approval` owner command (spec 2 handler) → `decideApproval`. Test "approve 12" / "reject 12: reason".
- [ ] **Step 2:** APIs: `GET /api/owner/approvals` (pending queue, filters), `PATCH /api/owner/approvals/[id]` (decide). Reuse spec 3 alert path to notify approver on new request (debounced).
- [ ] **Step 3:** Dashboard: approvals queue + approve/reject + policy editor.
- [ ] **Step 4:** PASS + typecheck; **Commit** `feat(approvals): resolve command + approvals APIs + dashboard`.

---

## Self-Review
**Spec coverage:** tables → Task 1; policy+lifecycle+guards → Task 2; dispatcher gate → Task 3; command+APIs+UI → Task 4. **Placeholder scan:** clean. **Type consistency:** `resolveLimit`/`createApprovalRequest`/`decideApproval` consistent; reuses spec 2 `validateAction`/`executeAction`. **Cross-spec:** §J (stock-count approval stays in spec 5, not double-gated) noted — this framework gates discounts/refunds; routing stock adjustments through it is optional.
