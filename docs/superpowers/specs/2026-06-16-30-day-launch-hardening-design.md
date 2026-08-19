# 30-Day Launch / Hardening Spec — Booka WhatsApp Operations Loop

**Date:** 2026-06-16
**Parent:** [Post-Meta strategy](./2026-06-16-post-meta-strategy.md)
**Status:** Design — awaiting user review before implementation plan.

## Goal (exit criteria)

One real, concierge-onboarded salon (the existing **test salon**) running the full operations
loop **live in production** within 30 days:

> inbound WhatsApp → booking → **Paystack** deposit → reminder → no-show recovery → rebooking

A real (small) deposit must flow through Paystack — this is the operations-moat proof, not a
booking-only beta. Paystack is the **only** payment rail in scope.

## Quality bar

- Core-path code green: the ops-loop unit tests pass.
- One **end-to-end smoke test** simulating the full loop for a tenant.
- The remaining ~107 suite failures are **triaged, not fixed** — they are pre-existing,
  non-core WIP and must not block launch.

## Grounding (verified state of the repo, 2026-06-16)

All six loop stages already exist in code (this is a hardening job, not a build job):

| Stage | File | Lines |
|---|---|---|
| Inbound worker | `src/app/api/worker/whatsapp/route.ts` | 186 |
| Customer booking flow | `src/lib/whatsapp/v2/flows/customerBooking.ts` | 538 |
| Deposits | `src/app/api/payments/deposits/route.ts` | 121 |
| Payment lifecycle | `src/lib/payments/lifecycle.ts` | 1440 |
| Reminders | `src/app/api/reminders/run/route.ts` | 223 |
| Auto-cancel unconfirmed | `src/app/api/jobs/auto-cancel-unconfirmed/route.ts` | 199 |
| Nightly rebooking | `src/app/api/cron/nightly/route.ts` | 841 |

No-show scoring lives in migration `077_customer_no_show_score.sql` (`customers.no_show_count`,
`customers.risk_score`), additive-only.

**Migration ordering hazard (must be resolved manually against prod, NOT auto-renumbered):**
genuine same-prefix forward-migration collisions exist at **065, 077, 079**:

- `065_chats_unique_constraint.sql` + `065_messages_read_columns.sql`
- `077_ai_wallets.sql` + `077_customer_no_show_score.sql`  ← on the no-show path
- `079_finance_ledgers.sql` + `079_whatsapp_message_queue_channel.sql`

(`078`/`082` also share prefixes but the extra files are `_rollback` scripts, not forward
ordering hazards.)

## Approach

Four workstreams. The riskiest/slowest (DB + payments) start day 1. Salon goes live in week 3,
with week 4 reserved for live-fire fixes. The test salon is already identified, so onboarding
preparation (Workstream D) begins in week 1.

### Workstream A — DB hygiene (blocking, week 1)

- **Document** the 065/077/079 collisions and the exact apply-order ambiguity. Produce a
  **guarded manual resolution runbook + SQL script** to be run by a human against prod after
  verifying which member of each pair is already applied. **Do not auto-renumber** — renumbering
  an already-applied migration risks corruption.
- Audit `IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` silent-skip risks on the core-path tables
  (`customers`, `reservations`, `transactions`), per project migration rules.
- Provide a manual SQL fallback for the no-show / deposit columns (mig 077) in case the migration
  was previously skipped.

### Workstream B — Paystack deposit path (blocking, weeks 1–2)

- Harden: deposit init → **webhook signature verification** → reconcile → reservation state
  transition.
- Idempotency on webhook replay (uses `idempotency_keys` + migration 060 constraints).
- Failure handling: deposit declined/abandoned → reservation stays `pending` and is swept by the
  existing `auto-cancel-unconfirmed` job.
- Stripe is explicitly left as-is.

### Workstream C — Ops-loop continuity + smoke test (weeks 2–3)

- Verify every handoff end-to-end: booking → deposit → reminder → no-show → rebooking.
- Confirm `no_show_count` / `risk_score` (mig 077) actually feed no-show recovery.
- Author **one end-to-end smoke test** exercising the whole loop for a tenant.
- Bring core-path unit tests to green.

### Workstream D — Concierge onboarding + live cutover (weeks 1 prep, 3–4 cutover)

- Provision the identified test salon: WhatsApp provider config, services, staff, deposit %,
  reminder timing.
- Go live in week 3; week 4 reserved for live-fire fixes from real traffic.

## Out of scope (explicit)

Instagram / Messenger; Stripe hardening; self-serve onboarding UX; the ~107 non-core test
failures; vertical packs; data/analytics moat work.

## Top risks

1. **Migration corruption** — renumbering or re-applying a migration already live in prod.
   Mitigated by document-only + guarded manual runbook.
2. **Paystack under real money** — webhook signature / idempotency / reconciliation edge cases.
3. **Single-tenant dependency** — entire launch rides on one test salon's availability and real
   message traffic; week 4 buffer absorbs slippage.

## Success criteria (checklist)

- [ ] 065/077/079 collisions documented + manual resolution runbook delivered.
- [ ] Core-path tables verified to have no skipped columns/constraints in target prod DB.
- [ ] Paystack deposit init → webhook → reconcile → reservation transition hardened + idempotent.
- [ ] Declined/abandoned deposit correctly auto-cancels.
- [ ] End-to-end smoke test passes for the full loop.
- [ ] Core-path unit tests green; remainder triaged.
- [ ] Test salon onboarded and live in production.
- [ ] At least one real booking with a real Paystack deposit completed end-to-end live.
