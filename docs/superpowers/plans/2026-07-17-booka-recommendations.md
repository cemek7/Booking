# Booka AI Recommendations & Next-Best Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Deterministically generate grounded recommendations (reorder, reactivate, rebook, upsell, underbooked slot), each showing its basis, with accept/dismiss/snooze and tracked outcomes.

**Architecture:** Per-type generators compute a signal from data with an explicit `basis`; the LLM only composes prose from that basis (no fabricated impact). `business_recommendations` + `recommendation_outcomes`; owners act; a follow-up job observes outcomes to tune thresholds.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest, BullMQ. Spec: `docs/superpowers/specs/2026-07-17-booka-recommendations-design.md`.

## Global Constraints
- Depends on specs 2 (movements/sales), 5 (stock), 8 (customer memory), 10 (analytics). Migrations after spec-10.
- **Deterministic signal is authoritative**; the LLM cannot invent recommendations or numbers. `estimated_impact` computed or omitted — **never fabricated**.
- Recommendations never auto-execute; acting runs the underlying action through spec 2 (+ §11/§12 gates).
- Dedup by `(tenant, type, entity)` while pending. Money in cents.

## File Structure
- `db/migrations/136_recommendations.sql`(+rollback) — `business_recommendations`, `recommendation_outcomes`.
- `src/lib/recommendations/generators/*.ts` — one per type; each returns `{ basis, signal }`.
- `src/lib/recommendations/registry.ts` — `GENERATORS` + `runGenerators(admin, tenantId)`.
- `src/lib/recommendations/explain.ts` — grounded LLM prose from `basis`.
- `src/lib/recommendations/outcomes.ts` — `observeOutcomes(admin, tenantId)` + threshold tuning.
- `src/app/api/owner/recommendations/route.ts`, `.../[id]/route.ts` (accept/dismiss/snooze).

---

## Task 1: Migration
- [ ] **Step 1:** `136_recommendations.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.business_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL, title text NOT NULL, reason text NOT NULL, recommended_action text NOT NULL,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb, estimated_impact jsonb, confidence numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed','snoozed','expired')),
  snooze_until timestamptz, entity_type text, entity_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.recommendation_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recommendation_id uuid NOT NULL REFERENCES public.business_recommendations(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('acted','ignored','expired')), observed_effect jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS service_role policies. Dedup: partial unique (tenant_id, type, entity_id) WHERE status='pending'.
```
Rollback drops both. **Commit** `feat(reco): recommendation + outcome tables`.

---

## Task 2: Generator framework + inventory/customer generators
**Interfaces:** `interface Generator { type: string; generate(admin, tenantId): Promise<Array<{ entityType, entityId, basis, confidence, estimatedImpact?, recommendedAction }>>; }` ; `runGenerators(admin, tenantId)`.
- [ ] **Step 1:** Test `likely_stockout`: avg daily usage (from `inventory_movements` outflow over N days) vs current stock → days-to-stockout; produces a recommendation with `basis={avgDailyUsage, currentStock, daysLeft}` and NO fabricated impact when it can't be grounded.
- [ ] **Step 2:** Implement generators: `likely_stockout`, `overstock`, `dead_stock`, `reorder_qty`; `reactivation` (lapsed via spec 8), `repeat_purchase_due`. `runGenerators` dedups vs pending and inserts.
- [ ] **Step 3:** Test `estimatedImpact` is omitted when ungrounded. **Commit** `feat(reco): generator framework + inventory/customer generators`.

---

## Task 3: Grounded explanation + remaining generators
- [ ] **Step 1:** `explain.ts` — compose `title`/`reason`/`recommended_action` prose strictly from `basis` (LLM prompt includes only the basis numbers). Test the prose contains the basis figures and no invented ones.
- [ ] **Step 2:** Implement service/sales generators: `underbooked_slot`, `overbooked_staff`, `poor_margin_service`, `bundle`/`upsell`/`cross_sell` (from `frequently_bought_together` + co-purchase), `churn_risk`. **Commit** `feat(reco): grounded explanations + service/sales generators`.

---

## Task 4: Lifecycle, outcomes, APIs
- [ ] **Step 1:** APIs: `GET /api/owner/recommendations` (feed, filters), `PATCH /api/owner/recommendations/[id]` (accept/dismiss/snooze). Accept → runs the underlying action through spec 2 (e.g. reorder → purchase) with its permission checks. Test snooze sets `snooze_until` and hides until then.
- [ ] **Step 2:** `outcomes.ts` — a job observes whether the predicted event occurred (stockout happened? customer returned?) → `recommendation_outcomes`; a periodic tuner adjusts per-tenant thresholds deterministically. Test outcome observation.
- [ ] **Step 3:** Scheduler runs `runGenerators` per tenant; high-value recs surface in the weekly briefing (spec 10) + debounced WhatsApp nudges. **Commit** `feat(reco): lifecycle + outcome tracking + APIs + scheduling`.

---

## Self-Review
**Spec coverage:** tables → Task 1; generators+framework → Tasks 2–3; grounded prose → Task 3; lifecycle/outcomes/APIs → Task 4. **Placeholder scan:** clean. **Type consistency:** `Generator`/`runGenerators`/`observeOutcomes` consistent. **Boundaries:** never auto-executes (acts via spec 2 + §11/§12); no fabricated impact; deterministic signal authoritative over LLM prose.
