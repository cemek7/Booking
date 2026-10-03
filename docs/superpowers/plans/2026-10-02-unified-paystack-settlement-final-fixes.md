# Final-review fix wave — findings with binding controller rulings

Branch head at dispatch: bc3689d. Spec: docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md (authority). Global constraints: global-constraints.md in this folder. Ledger rulings R1–R25 in progress.md.

All fixes: test-first where practical, commit locally with explicit paths, never push/checkout/stash/reset/rebase, never connect to a database. Keep commits grouped (one per numbered group below is fine).

## Group A — Critical (must fix)

### A1. Paid retail orders are never marked paid
`getRetailPaymentContext` (src/lib/payments/lifecycle.ts ~1353-1378) reads `raw.retail_order_id`, `raw.external_customer_ref`, `raw.channel`; the boundary's `raw` never has them, so retail success falls through and returns.
Ruling: the processor passes `subjectId` (the row's `subject_id`) as well as `subjectType` into `handlePaymentSuccess` (add `subjectId?: string | null` to its input). When `subjectType === 'retail_order'`, resolve the order by `subject_id` (tenant-scoped, admin client): `external_customer_ref` from `retail_orders`, channel from `retail_orders.metadata.payment.channel` (fallback 'whatsapp'), amountMinor from the processor's verified amount. Keep the old raw-based lookup only as the fallback for callers that pass no subjectType (Stripe). Same subject routing for `handlePaymentFailure`/`handlePaymentRefund` retail branches if they use `getRetailPaymentContext`.
Required seam test (new file, e.g. src/__tests__/lib/payments/settlementSeams.test.ts): build the transactions row exactly as `initializeTenantPayment`'s default store writes it (subject_type/subject_id, raw without retail fields), run `processPaystackWebhook` with a verified charge.success, and assert the retail order gets marked paid (the `mark_paid`/update path is called with the order id). Mock only Supabase I/O and Paystack.

### A2. Webhook-driven lifecycle functions run on the anon client
`handlePaymentSuccess` (createServerSupabaseClient, ~1837), `getRetailPaymentContext`, `handlePaymentFailure`, `handlePaymentRefund` and the retail success/failure/refund helpers they call use the anon/cookie client in webhook context, where RLS makes updates silent no-ops.
Ruling: these webhook-driven functions use `createSupabaseAdminClient()`; every query stays tenant-bound (`.eq('tenant_id', tenantId)`). Don't change functions that run in user request context. Seam tests from A1 must also cover a reservation subject: reservation updated to 'confirmed' via the admin client.

### A3. Migration 124's subject_type CHECK rejects 'payment_link'
db/migrations/124_ledger_columns.sql:3 adds an inline (auto-named) `CHECK (subject_type IN ('reservation','retail_order'))`.
Ruling: in migration 160, add a DO-block that finds any CHECK on public.transactions whose definition mentions `subject_type` (contype='c'), drops it, and adds `transactions_subject_type_check CHECK (subject_type IS NULL OR subject_type IN ('reservation','retail_order','payment_link'))` — same pattern as the revenue_type swap. Add a verifier row and a manual-fallback block. Re-validate in a throwaway postgres:16-alpine container (stub `transactions` WITH the 124-style inline CHECK), run the migration twice and the verifier.

## Group B — Important (must fix)

### B1. One transient post-claim failure strands a paid subject (supersedes R15)
Ruling: add column `settlement_effects_completed_at timestamptz` to transactions in migration 160 (+ verifier + fallback). In `settleVerifiedCharge`: after the verified claim, run ledger insert (23505 ignored) and `onSuccess`, then set `settlement_effects_completed_at = now()`. When a row is already 'verified' but `settlement_effects_completed_at IS NULL`, re-run the idempotent ledger insert + `onSuccess` and then stamp it (return 'verified'). Only when stamped return 'already_verified'. Tests: onSuccess throws once → retry re-runs it and stamps; already stamped → no effects.

### B2. Refund webhook branch overwrites partial refunds / ignores state
Ruling: in the refund branch, refunded amount = `Number(data.amount)` when it's a positive integer (kobo), else treat as full. Skip (log + 200) rows whose settlement_verification_status is not 'verified'. New cumulative = max(existing refund_amount*100, cumulative from this event) — use: `refundedTotalMinor = min(amount_minor, round(refund_amount*100) + eventAmount)` unless the existing recorded total already ≥ eventAmount-based total (Booka-initiated refunds already recorded by refundTenantPayment: if `round(refund_amount*100) >= eventAmount` treat the event as already recorded, don't add again). Set status 'refunded' and call onRefund only when refundedTotalMinor === amount_minor; otherwise 'partially_refunded' and update refund_amount (major units). Also make the verified claim in settleVerifiedCharge refuse rows whose status is 'refunded' or 'partially_refunded'. Tests for partial, full, Booka-recorded partial not double-counted, unverified row skipped, late charge.success on refunded row not confirming.

### B3. An older retail checkout stays payable and settles at the old amount
Ruling: in `handleRetailPaymentSuccess`, compare the verified `amountMinor` (from the processor) with the order's current `total_cents`. If lower → do NOT mark paid; open a retail escalation (reuse existing escalation helpers / escalation_queue with reason_code 'payment_settlement', session_id `settlement:<reference>`, customer_phone = order external ref or `retail-order:<id>`) and log. Update the transaction by the PAID reference, never by `metadata.payment.reference`. If the order is already paid and a second verified payment arrives for the same subject → don't re-mark, escalate as a possible double payment. Tests for underpaid old checkout, exact payment, second payment.

### B4. Settlement mismatch has no operator alert (spec §8 step 9)
Ruling: on 'mismatch', insert an escalation_queue row (reason_code 'payment_settlement', session_id `settlement:<reference>`, customer_phone = `settlement:<reference>`, conversation_thread_id null, reason 'Paystack payment did not match the expected settlement — manual review', status 'pending'); 23505 = already alerted. Test.

### B5. `not_successful` consumes the charge.success event
Ruling: for charge.success, outcome 'not_successful' → release the marker and return 503 so Paystack retries. Test.

### B6. Pending checkouts can't be superseded
Ruling: in `initializeTenantPayment`, a pending row WITH a checkout URL whose snapshot differs AND whose `createdAt` is older than 24h (`SUPERSEDE_PENDING_MS = 24*60*60*1000`) is superseded: release its key (do NOT mark failed — its settlement_verification_status stays 'pending' so a late payment still verifies and settles by reference) and continue. Younger → IDEMPOTENCY_CONFLICT (unchanged). Fix the retail conflict message to: "A different payment link was created for this order in the last 24 hours. Use that link or try again later." Tests.

### B7. Reactivation can't restore payments
Ruling: `reactivate` in src/lib/offboarding/offboardService.ts resets `tenant_payment_accounts` rows with status 'suspended' to 'pending' (tenant-scoped), so the owner re-verifies via Settings → Payments. Test. Update the ops-guide line about suspended accounts accordingly.

### B8. Public booking deposit catch opens no handoff (triage: must fix)
Ruling: in `maybeCreateBookingDeposit`'s outer catch, when the reservation id is known, call `openReservationPaymentHandoff` (wrapped in its own try/catch + log) before returning paymentUnavailable. Test.

## Group C — Minor promoted (cheap money-safety)

- C1. refund/route.ts: a lookup error on the settled-row check → 500 (fail closed), never fall through to legacy. `PaymentService.processRefund` refuses rows with non-null `amount_minor` (`{ success:false, error:'Use the settled refund path' }`). Tests.
- C2. webhook/route.ts generic Stripe/Flutterwave path: skip (log, 200) any transactions row with non-null `amount_minor` so it can't mark a Paystack-settled row success without Paystack verification. Test.
- C3. dialogBookingBridge.ts deposit lookups: use `createSupabaseAdminClient()` for the services/tenants reads with `.eq('tenant_id', tenantId)` on services, so the deposit rule can't silently become 0 in background context. Test asserts tenant filter.
- C4. Public booking: pass `getCustomerEmail(input.email ?? null, <customer phone if available>)` (src/lib/payments/customerEmail.ts) per owner decision 4. Test.

## Not in scope (do not do)
Everything else in the final review's Minor list and the ledger's deferred minors.

## Verification
Run: `npx jest src/__tests__/lib/payments src/__tests__/app/api/payments src/__tests__/lib/commerce src/__tests__/lib/whatsapp/v2 src/__tests__/lib/offboarding src/__tests__/app/api/jobs src/__tests__/lib/dialogBookingBridge.deposit.test.ts src/__tests__/lib/publicBooking.deposit.test.ts --runInBand`, then the full `npm test -- --runInBand` (must be 0 failed, as at bc3689d), `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` (0 errors in files changed since 175933806de7), and the container validation for migration 160.
