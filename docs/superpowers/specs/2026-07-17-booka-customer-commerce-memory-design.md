# Booka Customer Commerce Memory — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Eighth sub-project (§10). Unified customer profile across services + retail.
Depends on specs 1–2 (reservations/retail_orders/transactions/business_events).

**Scope decisions (self-made):** extend the existing customer tables rather than replace;
phone-based identity resolution; a review-gated merge workflow that preserves history;
consent-respecting. Cross-commerce *recommendations* are Phase 6 — §10 provides the data.

---

## 1. Objective
One customer identity per tenant with a complete cross-commerce history (appointments,
products, orders, payments, balances, preferences) — the data layer other features read.

## 2. Current-state findings
`customers` (name/phone/email + legacy `customer_name`/`phone_number`), `customer_analytics`,
`customer_profile_summary`, `customer_feedback` exist. `messaging_consents` (migration 111)
exists. `reservations.customer_id`, `retail_orders.customer_id` link commerce to customers.

## 3. Architecture
- **Identity resolution**: normalize phone (E.164) as the primary key for matching; resolve
  inbound WhatsApp/orders to one `customers` row per tenant (reuse the normalization from
  `identityResolver`).
- **Unified profile** (extend `customer_profile_summary`, recomputed): appointment history,
  product purchases, orders, payment history, **outstanding balance** (from unpaid orders /
  `record_outstanding_balance`, spec 2), average spend, lifetime value, preferred staff,
  preferred times, favourite products, repeat-purchase interval, cancellation/no-show counts,
  communication history, notes, consent/marketing prefs.
- **Derived metrics are deterministic** (SQL/aggregation), refreshed on relevant
  `business_events` (sale/booking/payment) and/or a periodic job.

## 4. Duplicate detection & merge
- **`customer_merge_candidates`**: detected pairs (same normalized phone / fuzzy name+email),
  `score`, `status` (pending|merged|dismissed).
- **Merge workflow** (owner/`MANAGE_STAFF`-ish, capability `merge_customers`): choose
  survivor → **repoint all FKs** (reservations, retail_orders, transactions, consents, notes)
  in one transaction → mark loser `merged_into`. **History preserved, never deleted.** Emit
  `customer.merged` business event (before/after). Reversible-by-audit (loser retained,
  soft-linked), not hard-reversible.

## 5. Access control & consent
- Sensitive **notes** are access-controlled (a `VIEW_CUSTOMER_NOTES` permission; §12 seam).
- Marketing/communication respects `messaging_consents` — any outreach built on this profile
  checks consent first.

## 6. Data model summary
Extend `customers` (`tags` from spec 2, `merged_into uuid null`, `normalized_phone`),
extend/rebuild `customer_profile_summary`, new `customer_merge_candidates`. RLS tenant-scoped.

## 7. Testing
Phone normalization + identity resolution (one identity per tenant) · profile metrics
correctness (LTV, avg spend, repeat interval, no-show count) · duplicate detection scoring ·
**merge repoints all FKs, preserves history, is atomic** · merged customer excluded from
active lists · consent respected before outreach · note access-control · tenant isolation.

## 8. Boundaries
Recommendations/next-best-actions = Phase 6. Reactivation/replenishment reminders consume
this profile but are built there. §10 is the identity + history + metrics layer only.

## 9. Implementation order
1. Migrations: `customers.normalized_phone`/`merged_into`, `customer_merge_candidates`,
   profile-summary columns (+ RLS, rollbacks).
2. Identity resolution + phone normalization (shared helper).
3. Deterministic profile metric recompute (event-driven + periodic).
4. Duplicate detection scorer.
5. Merge workflow (atomic FK repoint) + `customer.merged` event + capability.
6. Consent/note access-control checks.
7. Profile API + dashboard; docs.
