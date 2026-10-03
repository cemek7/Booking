# SDD ledger — plan: docs/superpowers/plans/2026-10-02-unified-paystack-settlement.md

Spec: docs/superpowers/specs/2026-10-02-unified-paystack-settlement-design.md
Start HEAD: 1759338 (175933806de79598205df0a8dd7ff9005d9df0f5), branch feat/retail-fulfillment-handoff
Baseline (payments/commerce/jobs): 7 suites, 96/96 pass — see baseline-tests.txt

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T2→T4 | calculateSettlement/isValidAmountMinor/FeePolicy | consistent |
| T3→T4 | initializeSplitTransaction(params) | consistent (transactionChargeMinor) |
| T3→T9 | verifyTransaction → VerifiedPaystackTransaction | consistent |
| T4→T5 | SettlementFailureCode type import | consistent |
| T4→T6/T7/T8 | initializeTenantPayment result {ok,...} | consistent |
| T5→T6/T7 | openReservationPaymentHandoff, PAYMENT_HANDOFF_CUSTOMER_MESSAGE | consistent |
| T6→T7 | computeDepositMinor added in publicBookingService by T6, used by T7 | ordering OK |
| T6 | dialog bridge imports getCustomerEmail from customerBooking.ts | circular-import risk → ruling R3 |
| T9→T10 | settleVerifiedCharge(reference) | consistent |
| T9/T11 | both edit lifecycle.ts (handlePaymentSuccess vs createPaystackPayment) | disjoint sections, OK |
| T11/T12 | guard case `paystack_subaccount_code` red until T12 | plan runs subset in T11, full in T12 — OK |
| T12 | src/lib/offboarding/types.ts has 'close_paystack_subaccount' (not `_code`) | guard unaffected |
| T4 | `import 'server-only'` | package absent → plan already says drop it |
| T9/T10/T11/T13 | text says stripe.test.ts is a known baseline failure | FALSE: it passes at baseline → ruling R1 |
| T1 | Step 1 runs `git fetch origin` | read-only, allowed |
| Each task self-consistency | tests vs code checked for T2,T3,T4,T5 (code given) | T4 test `amount: 5000` matches amountMinor/100 ✓; T2 cap cases ✓ |

## Rulings
- Ruling R1: All payment suites incl. stripe.test.ts must pass (baseline 96/96); plan's "known baseline failure" text is void — measured baseline contradicts it — cost if wrong: none (stricter).
- Ruling R2: Drop `import 'server-only'` in tenantSettlement.ts (package not installed; no new deps) — cost if wrong: module could be imported client-side; mitigated by admin-client import failing in browser.
- Ruling R3: If importing getCustomerEmail from customerBooking.ts into dialogBookingBridge.ts creates a circular import or pulls heavy deps, move it to src/lib/payments/customerEmail.ts and import from both — cost if wrong: one extra tiny file.
- Ruling R4: Commits stay local on feat/retail-fulfillment-handoff; no push (outside-worktree side effect needs owner) — cost if wrong: owner pushes manually.
- Ruling R5: The untracked staging handoff runbook is never staged; implementers add explicit paths only.

## Progress
Task 1: dispatched (BASE 1759338, implementer a192430b48badc3bf, sonnet)
Task 1: ⚠️ resolved — container run + free migration number confirmed in implementer report (task-1-report.md); accepted.
Task 1: minor (deferred): verifier lacks checks for new indexes/transactions CHECKs/account unique+FK
Task 1: minor (deferred): uq_escalation_payment_settlement = one payment_settlement escalation per session ever (T5 treats 23505 as success, intentional)
Task 1: minor (deferred): owner SELECT exposes subaccount_code/account_name (no full account number stored)
Task 1: minor (deferred): policy immutability by convention only; policies readable by all authenticated users
Task 1: minor (deferred): rollback leaves widened CHECKs/index; header should name 079/159 dependency; ILIKE SELECT INTO takes first match
Task 1: complete (commits 1759338..447c2ca, review clean)
Task 2: dispatched (BASE 447c2ca, haiku)
Task 2: minor (deferred): no tests pinning capMinor 0, bps 0/10000 bounds, negative bps; calculateSettlement invalid-input test only covers 1.5
Task 2: complete (commits 447c2ca..8cb3468, review clean)
Task 3: dispatched (BASE 8cb3468, haiku)
Task 3: Ruling R6: paystackFetch may throw (network/timeout/non-JSON) — handled at call sites, no change to Task 3: T4 wraps initializeSplitTransaction in .catch → PROVIDER_INITIALIZATION_FAILED; T9 lets verify throws propagate → marker released → 500 → Paystack retries (desired) — cost if wrong: an uncaught throw in a later caller becomes a 500 (T4/T9 reviewers told to check).
Task 3: minor (deferred): no tests for omitted callback_url / throwing fetch; error may be undefined if provider omits message
Task 3: complete (commits 8cb3468..6c727eb, review clean + R6)
Task 4: dispatched (BASE 6c727eb, sonnet)
Task 4: review → Needs fixes (1 Important, plan-mandated: failed/abandoned attempt blocks retries forever under stable keys)
Task 4: Ruling R7: spec §5 step 4 "otherwise continue" binds over the plan's blanket IDEMPOTENCY_CONFLICT. Failed rows release their key (markFailed nulls settlement_idempotency_key; a found failed row is released then we continue); pending rows with no checkout URL older than 15 min are marked failed+released then we continue; a live pending row with a different snapshot still returns IDEMPOTENCY_CONFLICT (superseding a payable checkout risks double payment); success/verified rows still block — cost if wrong: a stale-but-live Paystack checkout could still be paid after a retry created a second (15-min window chosen to exceed checkout creation latency).
Task 4: Ruling R8: include Minor #4 (markInitialized ignores read error → raw clobbered) and Minor #5 (store DB errors escape as throws) in the fix: bail on read error; wrap pre-insert store calls and return new code SETTLEMENT_UNAVAILABLE — cost if wrong: one extra union member callers treat as generic failure.
Task 4: minor (deferred): 23505 loser logged as error (could re-read winner); reuse path ignores email change; defaultStore untested; not_applicable overloaded for failed init; insert-failure test prints console error; email PII in raw
Task 4: fix round 1/5 (3 addressed, 0 open — retry-after-failure, markInitialized raw clobber, typed DB-error result; commits 5f87075..36bb0ba)
Task 4: note for T9: a late charge.success on a row marked failed/abandoned (verification_status not_applicable) MUST still verify+settle (money was taken) — carry into T9 dispatch.
Task 4: minor (deferred): default markFailed swallows update errors (key may stay set; abandon path retries after 15 min); defaultStore exported for tests
Task 4: complete (commits 6c727eb..36bb0ba, review clean after 1 fix round)
Task 5: dispatched (BASE 36bb0ba, sonnet)
Task 5: minor (deferred): metadata RMW not atomic; customer_phone fallback 'reservation:<id>' not a phone (callers pass real phone); missing reservation → silent zero-row update; resolved handoff re-open swallowed by unique index (resolution = staff confirm/cancel reservation)
Task 5: complete (commits 36bb0ba..0a0a252, review clean)
Task 6: dispatched (BASE 0a0a252, sonnet)
Task 6: review → Needs fixes (2 Important: dialog creates deposit bookings 'confirmed' + "paid" reply confirms without payment; v2 handoff doesn't mute bot / leaves pending_confirmation → re-confirm/duplicate)
Task 6: Ruling R9: both Important findings are in scope (spec §6 "not falsely confirmed", "enter human handoff"); the plan's bare transitionThread is superseded by setHumanHandlingUntilReleased + clearing pending_confirmation without releasing the slot lock. Dialog creates deposit bookings as 'deposit_pending' (matches v2) — cost if wrong: a dialog booking status value differs from what dashboards expect (v2 already uses it).
Task 6: Ruling R10: promote cheap minors into the fix — dialog logs failure code; v2 handoff-helper throw must still mute bot + send handoff message; getCustomerEmail returns '' (→ CUSTOMER_EMAIL_REQUIRED → handoff) when there is neither email nor phone digits instead of the shared 'noemail+customer@example.com' — cost if wrong: such customers get handoff instead of a link.
Task 6: minor (deferred): publicBookingService fetches service before no-deposit early return (one extra query); dialog outer catch message when initializer throws
Task 6: fix round 1/5 (5 addressed, 0 open — dialog false confirm, v2 mute, handoff-throw, warn log, shared email; commits 5364c1b..6f769d5)
Task 6: out-of-scope resolved by controller: handlePaymentSuccess confirms any status not in (cancelled, completed, refunded) (lifecycle.ts:~1917) → deposit_pending confirms on payment ✓
Task 6: minor (deferred): dialog tenant-scope read not asserted by mock; no test for dialog warn log; v2 swallowed mute failure leaves bot active (cannot re-book)
Task 6: complete (commits 0a0a252..6f769d5, review clean after 1 fix round)
Task 7: dispatched (BASE 6f769d5, sonnet)
Task 7: review → Needs fixes (1 Important, plan-mandated: perpetual spinner after paymentUnavailable toast)
Task 7: Ruling R11: plan's bare `return` superseded — BookingContainer gets a terminal 'received' step with persistent copy (payment unavailable, business will contact you, booking reference if available); test asserts spinner gone + persistent text — cost if wrong: small extra UI state.
Task 7: minor (deferred): legacy /api/public route drops deposit info (check no UI uses it); catch path opens no handoff on early throw; test mocks paymentService needlessly
Task 7: fix round 1/5 (1 addressed, 0 open — terminal 'received' step; commits eba8cb2..8b99416; controller spot-checked diff: spinner gone + persistent text asserted)
Task 7: minor (deferred): no booking reference on received view (confirmation path shows none either)
Task 7: complete (commits 6f769d5..8b99416, review clean after 1 fix round)
Task 8: dispatched (BASE 8b99416, sonnet)
Task 8: review → Needs fixes (2 Important: retail early-return reuses legacy/stale links bypassing boundary + collection gate (plan-mandated); payment-links list loses description/copy link)
Task 8: Ruling R12: spec §6.6 binds over the brief — delete the retail metadata.payment early return; always call initializeTenantPayment (amount-keyed key + snapshot compare gives reuse/conflict). Update the inventory test that locks in legacy reuse — cost if wrong: an already-issued legacy link is no longer re-sent (customer gets a new settled link instead).
Task 8: Ruling R13: add optional `description?: string` to InitializeTenantPaymentInput, stored as raw.description by the boundary; links page falls back to raw.authorization_url — cost if wrong: one optional field on the boundary interface.
Task 8: Ruling R14: retail uses getCustomerEmail(order.customer?.email ?? null, order.customer?.phone ?? order.external_customer_ref ?? '') (owner decision 4) so WhatsApp retail isn't blocked; IDEMPOTENCY_CONFLICT message becomes neutral ("A different payment link is already active for this order…") — cost if wrong: phone-derived example.com emails on retail receipts.
Task 8: minor (deferred → final review): an older settled checkout at a previous total stays payable at Paystack; paying it would settle the order at the old amount — final reviewer to check handleRetailPaymentSuccess amount handling
Task 8: minor (deferred): deposits route treats reservation query error as not-found; links double-submit mints two checkouts; retail settlement test header copied from inventory test (fix in round); retail test written after code
Task 8: fix round 1/5 (5 addressed, 0 open — retail early return removed, link description, retail email fallback, conflict msg, test header; commits 50d0d01..2fad024)
Task 8: minor (deferred): no test for paid-order guard; metadata.payment.url now write-only legacy data
Task 8: complete (commits 8b99416..2fad024, review clean after 1 fix round)
Task 9: Ruling R15: keep the plan's claim-then-effects order; if onSuccess throws after the verified claim, the marker is released and the retry sees already_verified, so the subject is not re-confirmed — logged as error with reference for staff. Final review to weigh. — cost if wrong: a paid booking/order may need manual confirmation after a transient onSuccess failure.
Task 9: dispatched (BASE 2fad024, sonnet)
Task 9: review → Needs fixes (2 Important: charge.failed still runs onFailure on a verified payment (undoes paid booking); refund webhooks now ignored (plan-mandated))
Task 9: Ruling R16: charge.failed runs failure side effects only when the guarded update changed a row (never for verified rows) — cost if wrong: none (strictly safer).
Task 9: Ruling R17: restore refund-event parity — handle 'charge.refunded' (old event name) and 'refund.processed' (reference = data.transaction_reference ?? data.reference): tenant/subject from the row, transaction → 'refunded', call handlePaymentRefund; Booka fee reversal for dashboard-initiated refunds deferred to final review (app-initiated refunds reverse it in Task 10) — cost if wrong: Paystack-dashboard full refunds leave Booka's fee unreversed until reconciled manually.
Task 9: Ruling R18: promote cheap minors — NULL-safe verified claim; defaultLogger.error when PAYSTACK_SECRET_KEY empty; mismatch update guarded by not-verified condition — cost if wrong: none.
Task 9: minor (deferred): not_successful/not_found keep marker (event consumed); mismatch has log only, no operator alert (spec §8 step 9); no 72h staleness log; hex sig trailing chars; ledger 23505 branch untested in fake
Task 9: fix round 1/5 (5 addressed, 0 open — charge.failed guard, refund events, null-safe claim, secret log, mismatch guard; commits 0d6264d..43c628f)
Task 9: minor (deferred → final review): refund event on unverified row then late charge.success flips refunded→success; refund events carry no amount check (partial refund recorded as 'refunded', and will overwrite T10's 'partially_refunded'); test 19 race weak; onRefund re-runs on retry (benign)
Task 9: complete (commits 2fad024..43c628f, review clean after 1 fix round)
Task 10: dispatched (BASE 43c628f, sonnet)
Task 10: review → Needs fixes (2 Important: unchecked transactions update after Paystack refund (fee reversal written anyway; ledger error after money moved blocks retry) (plan-mandated); legacy `amount` on settled row silently becomes FULL refund)
Task 10: Ruling R19: check the post-Paystack transactions update; on failure log error (reference, amounts, no PII) and return { ok:false, error:'Refund was sent to Paystack but could not be recorded. Contact support before retrying.' } WITHOUT writing the fee reversal. Fee reversal is made self-healing: when the row is already fully refunded and no amountMinor is given, re-attempt the idempotent fee reversal and return { ok:true, refundedMinor:0, full:true } instead of a validation error; a non-23505 ledger error after a recorded refund logs error and still returns ok:true (money moved + recorded) — cost if wrong: an operator must reconcile one unrecorded refund manually (logged).
Task 10: Ruling R20: refund route rejects (400) a body containing `amount` for settled rows (amount_minor not null); settled rows accept only `amountMinor` (absent = full remaining) — cost if wrong: an old client must switch fields.
Task 10: minor (deferred → final review): no concurrency guard on refunds (lost update of refund_amount under concurrent partials); webhook refund branch overwrites partially_refunded with refunded; dashboard-initiated refunds don't reverse fee; route test eq ignores filters; retry_count update unchecked
Task 10: fix round 1/5 (2 addressed, 0 open — refund recording/self-heal fee reversal, legacy amount 400; commits d2d15b4..3e52f30)
Task 10: minor (deferred → final review): retry after "sent but not recorded" can double-refund (message warns only); self-heal returns refundedMinor 0
Task 10: complete (commits 43c628f..3e52f30, review clean after 1 fix round)
Task 11: dispatched (BASE 3e52f30, sonnet)
Task 11: ⚠️ resolved — implementer report shows payment suites 16/17 (only guard case 5 red, expected until T12) incl. stripe.test.ts
Task 11: Ruling R21: fix guard blind spots in Task 12 (which runs the full guard): pathspec `src` instead of `src/**/*.ts`, and a sanity assertion so `|| true` can't silently pass cases 4–5 — cost if wrong: none.
Task 11: minor (deferred): guard misses raw /charge endpoints; dead PaymentsAdapter still defaults to 'paystack' (delete later)
Task 11: complete (commits 3e52f30..2ada762, review clean)
Task 12: dispatched (BASE 2ada762, sonnet)
Task 12: review → Needs fixes (3 Important, plan-mandated: fetch-back compares settlement_bank to bank code (Paystack returns a string, separate integer `bank` id — likely the name); suspended tenant can reactivate via PUT/POST; POST on non-active row orphans old subaccount)
Task 12: Ruling R22: fetch-back verification = full account_number match (in memory, never stored) + typeof percentage_charge === 'number' && === 0; bank correctness relies on resolveBankAccount(accountNumber, bankCode) succeeding before create/update. Settlement_bank not compared (OpenAPI: free string + separate integer bank id) — cost if wrong: a Paystack-side bank change that keeps the account number would go unnoticed (account numbers are bank-specific NUBANs, so low).
Task 12: Ruling R23: POST and PUT return 409 when the row is 'suspended' (offboarded; ops/reactivation must reset it to 'pending' — reactivate wiring deferred to final review). POST with an existing subaccount_code (pending/invalid) updates that subaccount instead of creating a new one — cost if wrong: an owner whose subaccount is broken at Paystack must contact support.
Task 12: Ruling R24: promote cheap minors — PUT resolves the bank before setting 'pending' and checks that update's error; loadPolicy runs before any Paystack call in POST/PUT — cost if wrong: none.
Task 12: minor (deferred): concurrent POSTs; UI doesn't reload status after 502; teardown retry reports skipped; GET ignores account query errors; offboardService.reactivate doesn't reset suspended row
Task 12: fix round 1/5 (5 addressed, 0 open — fetch-back by full account + numeric 0%, suspended 409, reuse existing subaccount, PUT resolve-before-pending, loadPolicy first; commits 948d9c4..4d0e22e)
Task 12: minor (deferred): strict typeof number on percentageCharge (if Paystack returns string, all activations invalid — verify in test mode); PUT leaves 'pending' if provision throws
Task 12: complete (commits 2ada762..4d0e22e, review clean after 1 fix round)
Task 13: Ruling R25: Step 3 (booka-self-review agent) is done by the controller as part of the final whole-branch review, not by the implementer (implementers never dispatch subagents) — cost if wrong: none.
Task 13: dispatched (BASE 4d0e22e, sonnet)
Task 13: minor (deferred): migrationNumbering verify-file exemption mis-indented/widened in orderable-name check; 24 no-explicit-any lint errors remain in branch test files; bookingDepositFlow test deletion landed in docs commit
Task 13: complete (commits 4d0e22e..bc3689d, review clean; full suite 405 passed / 0 failed; tsc 0 errors in changed files)
Final review: dispatched (1759338..bc3689d, opus code-reviewer + booka-self-review)
Final: booka-self-review returned 1 high (retail success can't find order: getRetailPaymentContext reads raw.retail_order_id which boundary never writes), 3 medium (post-claim failure not retried = R15; webhook refund overwrites partial; fee reversal "not idempotent" — controller disputes: 079 has idx_tenant_revenue_ledger_unique_ref), 3 low (raw fetch in settings UI; IDEMPOTENCY_CONFLICT after paid; dialog services lookup lacks tenant filter)
Final review (opus): With fixes — 3 Critical (retail success can't find order; webhook lifecycle on anon client; 124 subject_type CHECK rejects payment_link), 7 Important (R15 strands subjects; refund branch partial/unverified; old retail checkout underpay/double pay; no mismatch alert; not_successful consumes event; no supersede; reactivate doesn't reset)
Final: Ruling R26: R15 withdrawn — effects become replayable via new column settlement_effects_completed_at — cost if wrong: one more nullable column.
Final: Ruling R27: fix wave = Groups A, B (incl. triage must-fix T7 catch handoff) and 4 cheap money-safety minors (C1–C4); all other minors stay deferred — see final-fix-findings.md for each ruling — cost if wrong: deferred minors surface in the §10.2 test-mode gate.
Final: Ruling R28: self-review medium #4 (fee reversal not idempotent) rejected — idx_tenant_revenue_ledger_unique_ref exists in 079:35 (final reviewer concurs) — cost if wrong: duplicate negative ledger rows if live DB lacks 079's index.
Final: fix wave dispatched (FIX_BASE bc3689d, opus implementer)
Final: fix wave interrupted by rate limit (no commits; 9 files modified uncommitted: migration 160 trio, retail-orders, offboardService, lifecycle, paymentHandoff, paystackWebhookProcessor, tenantSettlement; no report). Resuming same agent a878889fa42513a09.
Final: fix wave done (commits bc3689d..fc2b840: 600b00e, af10734, fc2b840; full suite 3034 passed/0 failed; tsc 0 in changed files; container 13/13). Scoped re-review dispatched.
Final: re-review — all 15 findings ADDRESSED, no new Critical/Important.
Final: parked — Ruling: duplicate customer confirmation possible when webhook retry and staff retry re-run unstamped effects concurrently — money safe (ledger unique index, retail paidReference) — cost if wrong: customer gets a confirmation twice.
Final: parked — Ruling: rows verified before migration 160 have NULL effects stamp → a replay re-runs effects — no live verified Paystack rows exist yet (no subaccounts) — cost if wrong: duplicate notification on replay.
Final: parked — Ruling: after a Booka-recorded partial refund, a smaller dashboard partial refund is treated as already recorded (ruled B2 math) — cost if wrong: one dashboard partial refund unrecorded until manual reconciliation.
Final: parked — Ruling: manual mark-paid then same checkout's webhook raises a false double-payment escalation (money-safe) — cost if wrong: one false alarm for staff.
