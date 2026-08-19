# Booka Customer Commerce Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One customer identity per tenant with a unified cross-commerce profile (appointments, products, orders, payments, balances, preferences), phone-based identity resolution, and a history-preserving merge workflow.

**Architecture:** Extend `customers`/`customer_profile_summary`; add `customer_merge_candidates`. Deterministic metric recompute on relevant `business_events` + periodic job. Merge repoints FKs atomically and preserves history.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-customer-commerce-memory-design.md`.

## Global Constraints
- Depends on specs 1–2 (`reservations`/`retail_orders`/`transactions`/`business_events`). Migrations after spec-7.
- Extend existing customer tables (do not replace). `customers` already has `name/phone/email` + legacy `customer_name/phone_number`; `messaging_consents` exists (migration 111).
- Deterministic metrics (SQL/aggregation), not LLM. Notes access-controlled; outreach respects consent.
- Merge **preserves history** (loser retained, soft-linked via `merged_into`); FK repoint atomic.

## File Structure
- `db/migrations/133_customer_memory.sql`(+rollback) — `customers.normalized_phone`/`merged_into`; profile-summary columns; `customer_merge_candidates`.
- `src/lib/customers/identity.ts` — `normalizePhone(raw): string`, `resolveCustomer(admin, tenantId, phone): Promise<string>` (get-or-create).
- `src/lib/customers/profile.ts` — `recomputeProfile(admin, tenantId, customerId)`.
- `src/lib/customers/merge.ts` — `detectDuplicates`, `mergeCustomers` (atomic FK repoint).
- `src/app/api/owner/customers/[id]/route.ts` (profile), `.../merge/route.ts`.

---

## Task 1: Migration
- [ ] **Step 1:** `133_customer_memory.sql`:
```sql
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS normalized_phone text, ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_norm_phone ON public.customers (tenant_id, normalized_phone) WHERE merged_into IS NULL;
ALTER TABLE public.customer_profile_summary
  ADD COLUMN IF NOT EXISTS lifetime_value_cents bigint, ADD COLUMN IF NOT EXISTS avg_spend_cents bigint,
  ADD COLUMN IF NOT EXISTS outstanding_balance_cents bigint, ADD COLUMN IF NOT EXISTS repeat_interval_days integer,
  ADD COLUMN IF NOT EXISTS preferred_staff_id uuid, ADD COLUMN IF NOT EXISTS no_show_count integer,
  ADD COLUMN IF NOT EXISTS cancellation_count integer, ADD COLUMN IF NOT EXISTS last_computed_at timestamptz;
CREATE TABLE IF NOT EXISTS public.customer_merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_a uuid NOT NULL, customer_b uuid NOT NULL, score numeric NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed')), created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS service_role policies.
```
Rollback drops added columns + the candidates table. (If `customer_profile_summary` columns already exist, `IF NOT EXISTS` no-ops — verify current columns first: `\d customer_profile_summary`.)
- [ ] **Step 2:** Apply + verify. **Commit** `feat(customers): identity/profile columns + merge candidates`.

---

## Task 2: Identity resolution
**Interfaces:** `normalizePhone(raw): string` (E.164, Nigeria default +234); `resolveCustomer(admin, tenantId, phone): Promise<string>` (get non-merged by normalized_phone, else create).
- [ ] **Step 1:** Test `normalizePhone('08031234567')==='+2348031234567'`; `'+234 803 123 4567'` same. `resolveCustomer` returns existing id for a known phone, creates for a new one, and never returns a `merged_into` row.
- [ ] **Step 2:** Implement. Backfill `normalized_phone` for existing rows in a one-off step within the migration or a script. **Commit** `feat(customers): phone normalization + identity resolution`.

---

## Task 3: Deterministic profile metrics
**Interfaces:** `recomputeProfile(admin, tenantId, customerId): Promise<void>`.
- [ ] **Step 1:** Test with fixtures: LTV = Σ successful payments; avg_spend = LTV/orders+reservations; no_show_count from reservations status; outstanding from unpaid orders + `record_outstanding_balance`. Assert the summary row is updated.
- [ ] **Step 2:** Implement aggregation queries; call it from a subscriber on `business_events` (sale/booking/payment) + a nightly job. **Commit** `feat(customers): deterministic profile metric recompute`.

---

## Task 4: Duplicate detection + merge
**Interfaces:** `detectDuplicates(admin, tenantId): Promise<Candidate[]>`; `mergeCustomers(admin, tenantId, survivorId, loserId, actorId)`.
- [ ] **Step 1:** Test `mergeCustomers` repoints `reservations`, `retail_orders`, `transactions`, consents from loser→survivor in one transaction, sets loser `merged_into=survivor`, preserves all rows, emits `customer.merged` (before/after). Assert no history lost and the merge is atomic (a mid-way failure rolls back).
- [ ] **Step 2:** Implement merge (prefer a Postgres function `merge_customers_tx` for atomicity). Implement `detectDuplicates` (same `normalized_phone`, or fuzzy name+email) → `customer_merge_candidates`.
- [ ] **Step 3:** Guard with capability `merge_customers` (§12 seam; use `roles:['owner']` now). **Commit** `feat(customers): duplicate detection + atomic history-preserving merge`.

---

## Task 5: APIs + consent/notes access-control
- [ ] **Step 1:** `GET /api/owner/customers/[id]` returns the unified profile + history; `POST .../merge`. Notes gated by `VIEW_CUSTOMER_NOTES` (§12 seam). Outreach helpers check `messaging_consents` before returning contactable status. Test consent gating.
- [ ] **Step 2:** Implement + dashboard profile view (optional in this spec; API is the deliverable). **Commit** `feat(customers): profile API + consent/note access-control`.

---

## Self-Review
**Spec coverage:** columns → Task 1; identity → Task 2; metrics → Task 3; merge → Task 4; API/consent → Task 5. **Placeholder scan:** clean (verify existing `customer_profile_summary` columns before ALTER). **Type consistency:** `normalizePhone`/`resolveCustomer`/`recomputeProfile`/`mergeCustomers` consistent. **Boundaries:** recommendations/reactivation deferred to spec 11 (this is the data layer).
