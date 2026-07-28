# Plan: make `PaymentLifecycleService` functional (payment tracking)

**Date:** 2026-07-28 · **Status:** planned · **File:** `src/lib/payments/lifecycle.ts`

## Why it exists (its usecase)
`PaymentLifecycleService` is the intended **unified transaction-lifecycle tracker** — one place to see and drive every payment's state: **live (pending/processing), completed, failed, and hanging** (stuck pending), plus refunds, retries with a dead-letter queue, ledger reconciliation, and fraud scoring. Nothing else provides this: the live path (`handlePaymentSuccess/Failure/Refund` + `paymentService.ts`) only handles individual webhook events — there is no unified status view or hanging-transaction detection today. So the service fills a real gap; we keep it and wire it.

## Why it can't run today (root cause)
It was written against a **different `transactions` schema** than what's live. It reads/writes columns that don't exist, so every query errors (and it's imported nowhere, so it's silently dead).

**Authoritative `transactions` columns:** `id, tenant_id, amount, currency, type, status, raw, created_at, original_transaction_id, refund_amount, refund_reason, retry_count, last_retry_at, next_retry_at, provider_reference, reconciliation_status, reconciled_at, updated_at, subject_type, subject_id`.

**Column mapping to fix (service term → real column):**
| Service uses (ghost) | Real column | Notes |
|---|---|---|
| `booking_id` (~15) | `subject_id` + `subject_type='reservation'` | reservation id |
| `provider_transaction_id` (~9) | `provider_reference` | the live handlers already use this |
| `parent_transaction_id` (~4) | `original_transaction_id` | for refunds |
| `payment_method` | `raw.payment_method` | store in the `raw` jsonb |
| `provider` | `raw.provider` | no `provider` column |
| `metadata` | `raw` | the jsonb payload column |

## Plan (phased, each phase independently shippable + tested)

**Phase 1 — Schema alignment (code-only, no DB change).**
Rewrite the class's column usage to the real schema via the mapping above:
- `createTransaction`: insert `subject_id`/`subject_type`, `provider_reference`, `original_transaction_id`, and fold `provider`/`payment_method`/`metadata` into `raw`.
- `updateTransactionStatus`: write `raw` (merged, not clobbered) + `updated_at`; stop writing `metadata`.
- All `.eq('provider_transaction_id', …)` → `.eq('provider_reference', …)`; `.eq('booking_id', …)` → `.eq('subject_id', …).eq('subject_type','reservation')`; refund lookups by `original_transaction_id`.
- `recordLedgerEntry` already targets `ledger_entries` (real table) — verify its columns (`transaction_id, entry_type, amount, currency, description, reference_id, metadata`).
Gate: unit tests for create/complete/fail/refund against a schema-accurate mock; typecheck + suite green.

**Phase 2 — Hanging-transaction detection (the headline need).**
Add `listTransactions(tenantId, {status?, staleMinutes?})` and a derived status:
- **live** = status in (`pending`,`processing`)
- **hanging** = live AND `created_at < now() - staleMinutes` (default 30m), no terminal event
- **failed** = status `failed`
Backed by a single tenant-scoped query on real columns. No DB change.

**Phase 3 — Wiring / surfacing.**
- Ops/admin endpoint `GET /api/payments/transactions?status=…` (owner/superadmin) returning the live/failed/hanging lists, powering a small ops panel.
- Optionally route the three webhook handlers through the service so create/complete/fail/refund all flow through one lifecycle (keeps a single source of truth). Lower priority — the standalone handlers already work.
- Optional cron: sweep hanging transactions → re-query the provider (the class already has `getProviderTransactions`) and reconcile.

**Phase 4 — Retry/dead-letter + reconciliation.**
`transactions` already has `retry_count, last_retry_at, next_retry_at, reconciliation_status, reconciled_at` — wire `evaluatePaymentRetry` and `reconcilePayments` to those real columns (no `jobs`-table dead-letter unless we choose to).

## What we need for it to function (checklist)
- [ ] Phase 1 column rewrite (no DB change) — unblocks everything.
- [ ] Confirm `ledger_entries` column names used by `recordLedgerEntry`.
- [ ] Decide subject convention: `subject_type='reservation'`, `subject_id=<reservation id>` (already the pattern `handlePaymentSuccess` implies).
- [ ] Phase 2 tracking query + status derivation.
- [ ] Phase 3 ops endpoint (owner/superadmin, tenant-scoped) + minimal UI.
- [ ] Tests per phase.

No schema migration is required — the real `transactions` table already has everything (`subject_id/type`, `provider_reference`, `original_transaction_id`, `raw`, retry/reconcile columns). The whole gap is code aligning to it.
