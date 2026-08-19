# Booka AI Recommendations & Next-Best Actions — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Eleventh sub-project (§9, Phase 6). Deterministic, grounded recommendations.
Depends on specs 2 (movements/sales), 5 (stock), 10 (customer memory), 5-analytics.

**Scope decisions (self-made):** recommendations are **deterministically generated from Booka
data**; the LLM only writes the human explanation (grounded, no fabricated impact); owners
accept/dismiss/snooze; outcomes tracked to tune thresholds.

---

## 1. Objective
Move from reporting to action: grounded suggestions (reorder, reactivate, rebook, upsell,
underbooked slot) each showing *why*, with tracked outcomes.

## 2. Current-state findings
`predictiveAnalytics.ts`, `smartBookingRecommendations.ts`, `machineLearningService.ts` exist.
No recommendation store or outcome tracking. Grounding data now available: `inventory_movements`
(velocity), customer memory (spec 10), sales/orders.

## 3. Architecture — deterministic signal, LLM explanation
- **Generators** (code, one per type) compute a signal from data with an explicit basis:
  - *Inventory*: `likely_stockout` (avg daily usage from movements vs current stock →
    days-to-stockout), `overstock`, `dead_stock`, `reorder_qty`.
  - *Sales*: `bundle`/`upsell`/`cross_sell` (from `frequently_bought_together` + co-purchase),
    `repeat_purchase_due`, `reactivation` (lapsed via spec 10).
  - *Services*: `underbooked_slot`, `overbooked_staff`, `high_demand`, `poor_margin`.
  - *Customers*: `churn_risk`, `rebook_due`, `high_value_followup`, `outstanding_reminder`.
- Each recommendation records `basis jsonb` (the numbers). `estimated_impact` is **computed,
  never fabricated**; if it can't be grounded, it's omitted.
- The LLM composes `title`/`reason`/`recommended_action` prose from the basis only.

## 4. Data model (new; RLS tenant-scoped)
- **`business_recommendations`**: `type`, `title`, `reason`, `recommended_action`,
  `basis jsonb`, `estimated_impact jsonb|null`, `confidence`, `status`
  (pending|accepted|dismissed|snoozed|expired), `snooze_until`, `entity_type`/`entity_id`,
  `created_at`.
- **`recommendation_outcomes`**: `recommendation_id`, `outcome` (acted|ignored|expired),
  `observed_effect jsonb` (e.g. did the stockout occur / did the customer return),
  `created_at`. Feeds threshold tuning.

## 5. Lifecycle
Generators run on a schedule (+ event triggers). Dedup by `(tenant, type, entity)` while
pending. Owners accept/dismiss/snooze (dashboard + WhatsApp). Outcomes observed by a follow-up
job → `recommendation_outcomes` → periodic threshold tuning (deterministic, per-tenant).

## 6. Delivery
Dashboard recommendations feed; high-value ones surface in the weekly briefing (Phase 5) and
as WhatsApp nudges (debounced). `VIEW_ANALYTICS`/relevant §12 permission to view; acting on a
recommendation runs the underlying action through spec 2 (e.g. reorder → purchase) with its
own permission checks.

## 7. Testing
Each generator: correct signal from fixture data · **no fabricated impact** (omitted when
ungrounded) · dedup while pending · accept/dismiss/snooze transitions · outcome observation
correctness · snooze expiry · threshold tuning from outcomes · permission gating · tenant
isolation · LLM explanation grounded strictly in `basis`.

## 8. Boundaries
Recommendations never auto-execute — they propose; execution goes through spec 2 + §11/§12
gates. Deterministic signal is authoritative; the LLM cannot invent recommendations or numbers.

## 9. Implementation order
1. Migrations: `business_recommendations`, `recommendation_outcomes` (+ RLS, rollbacks).
2. Generator framework + basis/impact contract; first generators (stockout, reactivation, repeat-purchase).
3. Grounded LLM explanation composer.
4. Lifecycle (dedup, accept/dismiss/snooze) + APIs + dashboard feed.
5. Outcome observation job + threshold tuning.
6. Remaining generators (services, upsell, churn); briefing/WhatsApp surfacing; docs.
