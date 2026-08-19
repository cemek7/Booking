# Returning-Customer Context Recall — Design Spec

**Date:** 2026-06-26
**Status:** Approved (design) — pending implementation plan
**Scope:** Spec 3 of the "WhatsApp Trust" program (Spec 1 Branding ✅, Spec 2 Off-boarding ✅, Spec 4 Deliverability ✅, Spec 5 Cost-Caps ✅).
**Addresses:** Landmine #12 (returning-customer recall) + #4 (multi-tenant customer disambiguation).

## Problem

When a returning customer messages on WhatsApp, the AI greets them generically. The pipeline's
context assembler (`grounding-service.getGroundingData`, from the recent AI front-desk refactor)
grounds **services / staff / slots** for booking and, for **owner** queries, analytics — but for a
**customer** it does **not** assemble that customer's own history. So the AI can't say "Welcome back,
Ada — time for your usual trim with Sarah? 😊"; it has no last-service / usual-staff / last-visit
context. `customers.last_visit` and `total_bookings` exist, but nothing feeds per-customer recall
into the prompt.

### Current state (verified against code)

- `getGroundingData(tenantId, message, conv, route)` (no `userRole` param) assembles tenant/services/
  staff/slots/bookings; `buildFrontDeskPrompt({ grounding, message, conv, userRole, retryContext })`
  renders the prompt. `conv.role` (`ConvRole`) and `conv.phone_number` are available. ✅
- Bookings: `reservations.service_id` is set directly (the v2 flow does **not** use a
  `reservation_services` junction); staff is **`tenant_staff_id`** (FK → `tenant_users.id`); the
  customer is **`customer_id`** (FK → `customers`, resolved by `customers.eq('tenant_id').eq('phone')`).
  `customers.last_visit` + `total_bookings` updated at booking time. ✅
- Status values are mixed; **`'confirmed'` dominates**, `'completed'` is rare. A "visit" = a past,
  non-cancelled reservation, NOT `status='completed'`. ✅
- **WhatsApp** writes `phone_number = externalId`; **Instagram** writes `phone_number = null`
  (keyed by `external_id`). So phone-keyed recall is WhatsApp-only. ✅
- No `is_active` flag on `tenant_users` — "staff still active" = the row still exists for the tenant. ✅

## Decisions (locked during brainstorming + two self-reviews)

| Decision | Choice |
|---|---|
| Primary use | **Personalize the AI reply** — inject recall into the front-desk prompt; no new booking UI. |
| Signals | **Last service + usual staff**, **last-visit recency + visit count**, **rebooking-due**. |
| Framing | **Soft hints, not facts** — the AI offers "your usual" and confirms; never asserts; degrades if staff left. |
| Home | Extend **`grounding-service`**: a focused `getCustomerRecall` unit + a `customerRecall` field on `GroundingResult`. |
| Visit definition | Past reservation with `status NOT IN ('cancelled','no_show','refunded','refund_pending')` — not `='completed'`. |
| Customer key | `customer_id` (resolved via `customers` by `tenant_id` + `phone`); staff via `tenant_staff_id` → `tenant_users.name`. |
| Counts/recency | `visitCount` from the visit set (accurate); recency from `customers.last_visit`. (`total_bookings` counts created-not-completed → not used for the count.) |
| Multi-tenant (#4) | Strictly tenant-scoped (customer_id resolved per-tenant; reservations filtered by `tenant_id`). No cross-tenant leak. |
| Channel | **WhatsApp only** (phone-keyed). Instagram (`phone_number = null`) gets no recall — documented scope limit. |

## Architecture

### Unit 1 — `customerRecall.ts`: `getCustomerRecall(admin, tenantId, phone)` → `CustomerRecall | null`

```ts
interface CustomerRecall {
  lastService: string | null;      // services.name of the most recent past visit
  usualStaff: string | null;       // tenant_users.name of a clear, still-present favorite
  lastVisitAt: string | null;      // customers.last_visit (fallback: newest visit start_at)
  visitCount: number;              // size of the visit set
  rebookingDue: boolean;           // (now − lastVisitAt) ≥ lastService.rebooking_interval_days
}
```

Logic (≈2 queries + ≤1 for the staff name):
1. Resolve customer: `customers.select('id, last_visit').eq('tenant_id', t).eq('phone', phone).maybeSingle()`. None → `null` (new customer).
2. Visit set: `reservations.select('start_at, status, service_id, tenant_staff_id, services(name, rebooking_interval_days)').eq('tenant_id', t).eq('customer_id', id).lt('start_at', nowIso).not('status', 'in', '("cancelled","no_show","refunded","refund_pending")').order('start_at', { ascending: false }).limit(20)`. Empty → `null`.
3. `lastService` = `visits[0].services?.name ?? null`.
4. `usualStaff`: tally **non-null** `tenant_staff_id` over the visit set; pick the max **iff its count ≥ 2**; resolve the name via `tenant_users.select('name').eq('id', staffId).eq('tenant_id', t).maybeSingle()` → `null` if the row is gone (staff left) or no clear favorite.
5. `lastVisitAt` = `customer.last_visit ?? visits[0].start_at`.
6. `visitCount` = `visits.length`.
7. `rebookingDue` = `interval = visits[0].services?.rebooking_interval_days` is set **and** `now − Date.parse(lastVisitAt) ≥ interval × 86400_000`.

### Unit 2 — Grounding integration (`grounding-service.ts`)

Add `customerRecall?: CustomerRecall | null` to `GroundingResult`. In `getGroundingData`, when
`conv.role === 'customer'` **and** `conv.phone_number` is non-null, call
`getCustomerRecall(supabaseAdmin, tenantId, conv.phone_number)` and attach it. Owner/staff and
Instagram conversations get `customerRecall: null` (skipped — no extra queries).

### Unit 3 — Prompt rendering (`buildFrontDeskPrompt`)

When `grounding.customerRecall` is present, render a **"Returning customer"** block, e.g.:

> Returning customer — last had **{lastService}**{ with **{usualStaff}**} about **{recency}** ago
> ({visitCount} visits){; may be due for a rebook}. Greet them warmly and you may offer their usual,
> **but confirm what they actually want** — don't assume. If {usualStaff} isn't available, offer
> alternatives.

Soft-hint framing only; the model decides whether/how to use it.

## Error handling & testing

- **Fail-quiet:** any recall query error → `customerRecall: null` (log) — recall is an enhancement,
  never blocks a reply.
- **Tests (`getCustomerRecall`):** new customer (no `customers` row) → null; customer with no past
  visits → null; single visit → `lastService` set, `usualStaff` null, `visitCount` 1; ≥2 visits to one
  staff → `usualStaff` named; favorite-but-staff-row-gone → `usualStaff` null; rebooking-due true/false
  by interval; status filter excludes cancelled/no_show. **Grounding:** attaches recall only when
  `conv.role==='customer' && conv.phone_number`; Instagram (`phone_number=null`) → null. **Prompt:**
  renders the block with soft-hint framing when recall present; omits it when null. Reuse the
  queue-based Supabase mock + PostgREST nested-select shape from the v2 tests.

## Open items for the plan

- Confirm the PostgREST nested-select alias (`services(name, rebooking_interval_days)`) returns an
  object vs array under the deployed client; adjust the accessor.
- Confirm `customers.phone` is the right column (code uses `.eq('phone', …)`); fall back if the live
  column is `phone_number`.
- Decide the recency wording helper ("about 5 weeks ago") — a small `humanizeSince()` util.

## Non-goals

- "Rebook your usual" structured shortcut / booking-flow changes (recall only enriches the prompt).
- Instagram recall (no phone key) — future: capture phone for IG customers.
- Cross-tenant unification of a customer's history (deliberately tenant-scoped).
- Owner-facing analytics (already handled by grounding's owner path).
