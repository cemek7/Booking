# Unified Paystack Settlement Design

**Date:** 2026-10-02 (revision 2, same day, after code + docs self-review)  
**Status:** Implemented on `feat/retail-fulfillment-handoff` — not deployed  
**Repository baseline:** `175933806de79598205df0a8dd7ff9005d9df0f5`  
**Scope:** Paystack customer payments, tenant settlement, platform fees, webhook verification, and payment-settings disclosure. Booka wallet top-ups remain a separate platform-revenue path.

## 1. Outcome

Every Booka customer-payment route must initialize Paystack through one service that:

- accepts money only in minor units;
- requires an active tenant Paystack subaccount;
- applies one explicit Booka platform-fee policy;
- makes the tenant subaccount bear Paystack processing fees;
- records an immutable settlement snapshot;
- verifies amount, currency, tenant, subaccount, and reference before confirming payment;
- fails closed without collecting money when configuration is missing or unsafe.

The controlled pilot uses a Booka platform fee of **1%**, capped at **NGN 2,000 per transaction**. Both values are explicit policy values, not fallbacks. Owner decisions are recorded in Section 13.

## 2. Why the Existing Design Is Unsafe

### 2.1 Unit conventions

The repository contains two payment abstractions with different unit conventions:

- `src/lib/paymentService.ts:97` sends `params.amount * 100`; verify divides by 100 (`:157`); refund multiplies by 100 (`:198`).
- `src/lib/paymentsAdapter.ts` treats `amount_minor_units` as already converted and sends it unchanged.

Public booking (`publicBookingService.ts:84-86`) and WhatsApp v2 (`customerBooking.ts:679-681`) calculate deposits in minor units, then pass them to `PaymentService`, which multiplies again. A displayed NGN 5,000 deposit can initialize as NGN 500,000. The dashboard deposit route's unit is ambiguous: `deposits/route.ts:34` describes the bound in kobo, then the value is multiplied again.

The legacy `transactions.amount` column holds **mixed units**:

| Writer | Unit written to `amount` |
|---|---|
| `PaymentService.initializePayment` (`paymentService.ts:616`) | whatever the caller passed — minor for public booking and WhatsApp v2 |
| `api/payments/links/route.ts:86` | major |
| `commerce/retail-orders.ts:607` | major (`cents / 100`) |
| `paymentsAdapter.ts:279` `recordDepositTransaction` | major |

Readers assume major (`lifecycle.ts:1409` multiplies by 100). `PaymentService` also writes a `ledger_entries` row at initialization, before any money moves (`paymentService.ts:671`).

### 2.2 Settlement behavior by entry point

| Customer-payment entry point | Current engine | Current subaccount / bearer behavior |
|---|---|---|
| Public booking deposit | `PaymentService` | Subaccount from tenant metadata when present; fails open when absent; `bearer: 'account'` |
| WhatsApp/Instagram v2 booking | `PaymentService` | Omits subaccount; `bearer: 'account'` |
| Legacy WhatsApp dialog booking | `PaymentsAdapter.createDeposit` | No subaccount input; charges **full service price** as the deposit (`dialogBookingBridge.ts:582`) |
| Dashboard deposit | `PaymentService` | Subaccount when present; fails open; `bearer: 'account'` |
| Ad-hoc payment link | `createStandalonePaymentLink` | Subaccount when present; fails open; default bearer `account`; transaction inserted **after** the provider call |
| Retail-order payment (5 callers, Section 6) | `createStandalonePaymentLink` | Subaccount when present; fails open; transaction write failure is only logged (`retail-orders.ts:630`) |
| `PaymentLifecycleService.createPayment` (`lifecycle.ts:845-880`) | direct `fetch` | No subaccount. Exported, currently uncalled |
| Wallet top-up | `initializeTransaction` (`paystack.ts:549`) | Correctly settles to Booka; excluded from tenant settlement |

Today Booka's main account bears Paystack fees on every tenant path that sends a subaccount.

### 2.3 Subaccount setup

There are two creation endpoints:

- `/api/payments/subaccounts` sets `percentage_charge` from `PAYSTACK_PLATFORM_FEE_PERCENT`, default 5 (`route.ts:7`). Its `PUT` changes the settlement bank with no re-verification or acceptance (`route.ts:97-115`).
- `/api/tenants/[tenantId]/payments/setup` lets the owner choose `percentageCharge` 0–100 (`route.ts:11`).

Both store the code in `tenants.metadata.paystack_subaccount_code`. Owners can update their own `tenants` row through RLS (`supabase/migrations/029_fix_rls_policies.sql:230`), so that field is tenant-writable and must never decide settlement. Offboarding reads the same field and does not close the subaccount (`lib/offboarding/teardownTasks.ts:54-61`). The concierge runbook tells operators to set it by hand (`docs/runbooks/concierge-onboarding-test-salon.md:33`).

### 2.4 Webhooks

- `/api/payments/webhook` runs with `auth: false`, so `ctx.supabase` is the anon route client (`route-handler.ts:368`). The replay-marker insert (`webhook/route.ts:155`), transaction lookup (`:216`), and update (`:241`) depend on RLS that the migrations define inconsistently (`supabase/migrations/024`, `031`). A failed replay insert only logs (`:166`), which silently disables replay protection.
- Provider verification falls back to the webhook's own status on error (`:235`) and runs only when the status differs. Amount, currency, and subaccount are never compared, and `amountMinor` is never passed to `handlePaymentSuccess`.
- `handlePaymentSuccess` prefers the payload's `metadata.reservation_id` over the transaction row (`lifecycle.ts:1890`).
- `/api/payments/paystack` has no wallet branch, no replay marker, no provider verification, and an unawaited `handlePaymentSuccess` (`paystack/route.ts:67`).
- Webhooks older than 72 hours are acknowledged and dropped (`webhook/route.ts:131`).
- The documented Paystack dashboard URL is `/api/payments/webhook` (`concierge-onboarding-test-salon.md:17`). Wallet credit only happens on that route.

### 2.5 Ledgers

`tenant_revenue_ledger.amount_credits` is `NUMERIC(20,6)` in **credits** (1 credit = NGN 1, `walletTopup.ts:20`), and its `revenue_type` CHECK does not include a transaction-fee type (`db/migrations/079_finance_ledgers.sql:8`). The unique index `(tenant_id, revenue_type, reference)` already provides idempotency when `reference` is set.

## 3. Commercial Policy

Booka charges two distinct fees. They must never be presented as one fee:

1. **Paystack processing fee:** charged by Paystack and borne by the tenant subaccount.
2. **Booka platform fee:** Booka revenue for operating the payment, conversation, reconciliation, and support path.

The platform fee is configurable by Booka plan through a policy table (Section 4.1). It is not editable by tenant owners. A tenant must see and accept the applicable policy before its payment account becomes active.

### 3.1 Pilot policy

- Policy code `pilot_ngn_v1`, version `1`.
- Platform fee: `100` basis points (1%).
- Per-transaction cap: `200000` minor units (NGN 2,000).
- Paystack fee bearer: `subaccount`.
- Subaccount base `percentage_charge`: `0`.
- Wallet top-ups: excluded; 100% remains Booka revenue.

### 3.2 Fee arithmetic

All arithmetic is integer. Rounding is floor (rounding favors the tenant):

```text
uncappedFeeMinor = floor(amountMinor * platformFeeBasisPoints / 10_000)
platformFeeMinor = capMinor == null ? uncappedFeeMinor : min(uncappedFeeMinor, capMinor)
tenantGrossMinor = amountMinor - platformFeeMinor
```

`tenantGrossMinor` is before Paystack's fee. The tenant's net settlement is `tenantGrossMinor - provider_fee_minor`, recorded only from verified provider data.

### 3.3 Provider contract

Checked against Paystack's official OpenAPI spec (`PaystackOSS/openapi`, `dist/paystack.yaml`, commit dated 2026-06-09):

- `POST /transaction/initialize` accepts `amount` "in smallest denomination of the currency", `subaccount`, `transaction_charge` ("a flat fee to charge the subaccount for a transaction; this overrides the split percentage set when the subaccount was created"), and `bearer` (`account` | `subaccount`).
- `GET /transaction/verify/{reference}` returns `amount`, `requested_amount`, `currency`, `fees`, `fees_split`, `fees_breakdown`, `split`, and `subaccount`.

Not stated by the spec and therefore a test-mode release gate (Section 10.2): the unit of `transaction_charge` (assumed minor units, matching `amount`), Paystack's behavior when `transaction_charge` is `0`, and the exact shape of `fees_split`.

Initialization sends `subaccount`, `transaction_charge: platformFeeMinor`, and `bearer: "subaccount"`. Because `transaction_charge` overrides the stored percentage, plan changes never mutate the remote subaccount.

## 4. Canonical Data Model

### 4.1 Fee policy and tenant payment account

Add `payment_fee_policies` (service-role managed, read-only to tenants):

- `code text`, `version integer`, primary key `(code, version)`;
- `currency text` constrained to `NGN`;
- `platform_fee_basis_points integer` with `CHECK (0..10000)`;
- `platform_fee_cap_minor bigint` nullable, `CHECK (>= 0)`;
- `fee_bearer text` constrained to `subaccount`;
- `active boolean`, timestamps.

Plans map to a policy `(code, version)`. Policy rows are immutable once referenced; a change is a new version.

Add `tenant_payment_accounts`, one row per tenant and currency (unique `(tenant_id, provider, currency)`):

- `tenant_id uuid`;
- `provider text` constrained to `paystack`;
- `currency text` constrained to `NGN`;
- `subaccount_code text`;
- `status text`: `pending`, `active`, `suspended`, or `invalid`;
- `bank_code text`, `account_last4 text`, `account_name text`;
- `policy_code text`, `policy_version integer`, foreign key to `payment_fee_policies`;
- `accepted_by uuid`, `accepted_at timestamptz`;
- timestamps.

The full bank account number is sent to Paystack during setup but is not retained.

**No transition read of `tenants.metadata.paystack_subaccount_code`.** There are no tenant subaccounts today and that field is tenant-writable, so runtime resolution uses only `tenant_payment_accounts`. A plan change that moves a tenant to a different policy sets the account to `pending` until the owner accepts the new policy.

RLS is enabled on both tables. `service_role` has full access. Authenticated owners may read only their tenant's masked account row and the policy it references. Tenant users cannot insert or update either table. Subaccount creation and policy assignment run server-side.

### 4.2 Settlement snapshot

Add additive columns to `transactions`:

- `amount_minor bigint`;
- `platform_fee_minor bigint`;
- `tenant_gross_minor bigint`;
- `settlement_subaccount_code text`;
- `settlement_fee_bearer text`;
- `settlement_policy_code text`;
- `settlement_policy_version integer`;
- `settlement_idempotency_key text`, unique per tenant when present;
- `provider_amount_minor bigint` nullable;
- `provider_currency text` nullable;
- `provider_fee_minor bigint` nullable, from verified `fees`;
- `provider_subaccount_code text` nullable, from verified `subaccount`;
- `settlement_verification_status text`: `pending`, `verified`, `mismatch`, or `not_applicable`.

CHECK constraints: non-negative amounts; `platform_fee_minor + tenant_gross_minor = amount_minor` when all three are present.

The initialization insert writes the expected values before contacting Paystack. Verification writes only the `provider_*` columns and the status; it never changes the expected snapshot.

**Legacy `amount` during transition:** new code writes `amount = amount_minor / 100` (major units, numeric), matching the majority of existing writers and `lifecycle.ts:1409`. New readers use `amount_minor`. Removing the ambiguity of old rows is out of scope (Section 11).

The migration is additive and idempotent. It enables no new anonymous access. Existing transaction RLS remains in force. Schema verification checks column types, constraints, indexes, grants, and RLS.

### 4.3 Revenue ledger

A separate migration replaces the `tenant_revenue_ledger.revenue_type` CHECK (drop and re-add the named constraint; never `CREATE TABLE IF NOT EXISTS`) to add `platform_transaction_fee`. Entries record `amount_credits = platform_fee_minor / 100` (1 credit = NGN 1), `reference` = the Paystack reference, and the minor-unit values in `metadata`. The existing unique index makes the write idempotent. A manual SQL fallback ships with the migration.

## 5. One Customer-Payment Boundary

Create a focused server-only module, `src/lib/payments/tenantSettlement.ts`.

```ts
type TenantPaymentSubject =
  | { type: 'reservation'; id: string }
  | { type: 'retail_order'; id: string }
  | { type: 'payment_link'; id: string };

type InitializeTenantPaymentInput = {
  tenantId: string;
  amountMinor: number;
  currency: 'NGN';
  customerEmail: string;
  subject: TenantPaymentSubject;
  idempotencyKey: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

type SettlementSnapshot = {
  amountMinor: number;
  platformFeeMinor: number;
  tenantGrossMinor: number;
  subaccountCode: string;
  feeBearer: 'subaccount';
  policyCode: string;
  policyVersion: number;
};
```

`initializeTenantPayment` performs these actions in order:

1. Validate that `amountMinor` is a positive safe integer and `currency` is `NGN`.
2. Resolve an `active` tenant payment account and its accepted policy, using the admin client.
3. Calculate the capped platform fee (Section 3.2).
4. Return an existing pending checkout for the same `idempotencyKey` only if its subject, amount, and snapshot match exactly; otherwise continue.
5. Insert a pending transaction with `subject_type`, `subject_id`, and the immutable expected snapshot.
6. Initialize Paystack with the unchanged minor-unit amount, `subaccount`, `transaction_charge`, and `bearer: "subaccount"`.
7. Store the provider reference and checkout URL. Write no ledger entry.

Typed failures: `INVALID_AMOUNT_MINOR`, `CURRENCY_NOT_SUPPORTED`, `SETTLEMENT_NOT_CONFIGURED`, `POLICY_NOT_ACCEPTED`, `CUSTOMER_EMAIL_REQUIRED`, `TRANSACTION_INSERT_FAILED`, `PROVIDER_INITIALIZATION_FAILED`.

**Customer email:** Paystack requires one. The module does not invent placeholders such as `noemail@example.com`. Callers without a real email pass the existing deterministic phone-derived address from `getCustomerEmail`; the decision on that fallback is listed in Section 13.

**Allow-list:** no code may call `/transaction/initialize` except `tenantSettlement.ts` and the wallet top-up path (`billing/walletTopup.ts` via `paystack.ts`). `chargeAuthorization` (wallet auto-recharge) is also allow-listed. A repository guard test enforces this.

## 6. Route Migration

Migrate every customer-payment initialization path:

1. Public booking deposit — `src/lib/publicBookingService.ts`.
2. WhatsApp/Instagram v2 deposit — `src/lib/whatsapp/v2/flows/customerBooking.ts`.
3. Legacy dialog booking — `src/lib/dialogBookingBridge.ts`. Use the tenant's deposit policy, not the full service price.
4. Dashboard deposits — `src/app/api/payments/deposits/route.ts`. The request field becomes `amountMinor`; the UI converts naira at the boundary.
5. Payment links — `src/app/api/payments/links/route.ts`. Insert-before-provider through the module.
6. Retail payments — `createRetailOrderPaymentLink` in `src/lib/commerce/retail-orders.ts`, which serves five callers:
   - `src/app/api/retail/orders/[id]/payment-link/route.ts`;
   - `src/lib/publicStorefrontService.ts` (public storefront);
   - `src/lib/commerce/pos.ts`;
   - `src/lib/booking/action-validator.ts` (AI action);
   - `src/lib/commerce/retail-fulfillment-confirmation.ts`.

   Settlement runs **after** the existing fulfilment gate, which stays the first check. Existing-link reuse (`retail-orders.ts:537`) must also match the settlement snapshot, not only the amount. A transaction write failure becomes fatal (no link returned).
7. Remove `PaymentsAdapter.createDeposit`, `PaystackProvider.createDepositIntent`, and the uncalled `initiateDepositForReservation` / `recordDepositTransaction` helpers from `src/lib/paymentsAdapter.ts`.
8. Remove the uncalled Paystack branch of `PaymentLifecycleService.createPayment` (`src/lib/payments/lifecycle.ts:845-880`), or route it through the module.

Status and refund paths that must respect the snapshot:

- `PaymentService.retryFailedTransaction` (`paymentService.ts:856`), `api/payments/retry`, `api/payments/reconcile`, and the `payment_retry` job (`enhancedJobManager.ts:521`) may update provider status but must not confirm a subject. Confirmation goes through the same verification as the webhook (Section 8).
- `PaymentService.processRefund` and `api/payments/refund` must send minor units taken from `amount_minor`, never `amount * 100`.

All routes use integer minor units. Display conversion occurs only at UI/message boundaries.

**Missing configuration** never falls back to Booka's main account. Per channel:

| Channel | Behavior when settlement is not configured |
|---|---|
| WhatsApp/Instagram v2 and legacy dialog | Reservation stays `pending`; the thread enters human handoff; the customer is told a team member will confirm payment. Never confirmed, never silently converted to no-deposit. |
| Public booking page | Reservation stays `pending`; the response says payment is unavailable and the business will contact the customer; an owner notification is created. It must not return `depositRequired: false` (current behavior, `publicBookingService.ts:99-104`). |
| Dashboard deposit / payment link | Typed `SETTLEMENT_NOT_CONFIGURED` error pointing to Settings → Payments. |
| Retail (all callers) | Blocked before collection; no link created. |

These reservations must not be swept by `api/jobs/auto-cancel-unconfirmed` while a handoff is open (see Section 13, decision 2).

## 7. Subaccount Setup and UI

`/api/payments/subaccounts` is the only setup endpoint. `/api/tenants/[tenantId]/payments/setup` returns a deterministic deprecation response pointing to the canonical endpoint for one release, then is removed.

Setup (`POST`):

1. Resolve the tenant from the verified auth context (not `tenant_users ... .single()`, which breaks for multi-tenant users).
2. Resolve and display the bank account name.
3. Display the Booka fee and cap, and state that Paystack fees are deducted from tenant proceeds.
4. Require explicit owner acceptance of the current policy version.
5. Create the Paystack subaccount with `percentage_charge: 0`.
6. Fetch it back and compare bank, account, and percentage.
7. Save only the subaccount code, masked account details, accepted policy, and status `active`.

Bank change (`PUT`): repeats steps 2–7. The account is `pending` (collection disabled) until the fetch-back comparison passes. `PAYSTACK_PLATFORM_FEE_PERCENT` is removed.

Payment settings (`src/components/settings/PaymentSettingsSection.tsx`) shows the settlement account and status, the Booka fee rate and cap, tenant responsibility for Paystack fees, an example settlement calculation, and a warning that collection is disabled until setup is active. It stops presenting `100 - percentageCharge` as the tenant share.

Offboarding (`teardownTasks.ts`) reads `tenant_payment_accounts` and sets the row to `suspended`.

Because there are no tenant subaccounts today, no remote percentage migration is required. A read-only pre-deployment gate (Paystack `GET /subaccount` list plus a query for non-null `metadata.paystack_subaccount_code`) must confirm that remains true. If any appear before release, deployment stops for reconciliation.

## 8. Webhook and Reconciliation

Extract one internal processor used by both `/api/payments/webhook` (canonical) and `/api/payments/paystack` (delegating during transition). The processor uses the **admin client** for `webhook_events`, `transactions`, and subject updates. The legacy route is retired after the Paystack dashboard URL is confirmed as `/api/payments/webhook`.

For `charge.success`, the processor:

1. verifies the HMAC signature over the raw body;
2. handles `bokawallet_` references through the existing wallet path, unchanged;
3. claims the replay marker; if the claim fails for any reason other than a duplicate, returns an error so Paystack retries;
4. loads the transaction by server-created reference;
5. calls `GET /transaction/verify/{reference}`; if verification errors, returns an error so Paystack retries — never falls back to the webhook's status;
6. compares verified `status`, `amount`, `currency`, `reference`, and `subaccount` with the snapshot;
7. records `provider_*` values;
8. on a match, marks settlement `verified`, then confirms the subject resolved from `transactions.subject_type` / `subject_id`;
9. on a mismatch, marks `mismatch`, creates an operator alert, and does not confirm the subject.

Provider metadata never decides tenant identity **or subject identity**. Replayed events perform no second state transition, ledger write, wallet credit, or notification. The 72-hour staleness rule acknowledges the event but logs it for manual reconciliation instead of dropping it silently.

Ledger effects on verification:

- Booka platform fee → `tenant_revenue_ledger`, type `platform_transaction_fee` (Section 4.3).
- Paystack processing fee → `tenant_cost_ledger` only if Booka bears it; under the pilot policy, none.
- No ledger entry is written at initialization.

Tenant-facing reconciliation and the daily-close report use the settlement snapshot, not a recalculation from the tenant's current plan.

## 9. Failure Behavior

- Missing account or policy: no Paystack request; typed configuration failure; channel behavior per Section 6.
- Non-integer, unsafe, or non-NGN amount: no transaction insert; validation failure.
- Database insert failure: no Paystack request.
- Paystack initialization failure: transaction marked failed; no booking confirmation.
- Verification error: webhook returns an error; Paystack retries; nothing confirmed.
- Amount/currency/subaccount mismatch: `mismatch`, operator alert, no confirmation.
- Duplicate initialization: return the existing pending checkout only when subject, amount, and snapshot match exactly.
- Duplicate webhook: success without repeating effects.
- Wallet top-up: unchanged; `not_applicable` for tenant settlement.

## 10. Test and Release Gates

### 10.1 Automated tests

- Unit tests for minor-unit validation and capped, floored fee calculation, including `amountMinor` below 100 and above the cap boundary (200,000,000).
- Provider contract test asserting the exact Paystack initialize JSON.
- Characterization tests for every path in Section 6, including all five retail callers.
- Missing settlement configuration makes zero provider calls, per channel, with the Section 6 user-visible behavior.
- A NGN 5,000 deposit sends `500000`, never `50000000`; refunds send `amount_minor`.
- Subaccount, `transaction_charge`, and `bearer: "subaccount"` are attached everywhere.
- Webhook tests: signature, replay, replay-claim failure, verification error, amount/currency/subaccount mismatch, subject from `subject_id` (payload `reservation_id` ignored), both URLs behave identically, wallet branch unchanged.
- Retry/reconcile cannot confirm a subject without verification.
- Ledger: one `platform_transaction_fee` entry per verified reference, in credits.
- Wallet regression: top-ups remain platform-only and idempotent.
- RLS/grant tests for `payment_fee_policies` and `tenant_payment_accounts`.
- Static guard test for the initialize allow-list.
- Existing retail fulfilment, booking, deposit, and wallet suites stay green.

### 10.2 Staged release

1. Deploy schema and dormant code with tenant payments disabled.
2. Run database validation and RLS tests in a throwaway `postgres:16-alpine` container, then on staging (the owner runs migrations).
3. Confirm Paystack test keys and that the dashboard webhook URL is `/api/payments/webhook`.
4. Create the pilot tenant's test-mode subaccount through the UI.
5. Run one test transaction per path. In Paystack, confirm the `transaction_charge` unit, the split, who bore the fee, and the `fees` / `fees_split` / `subaccount` fields on verify.
6. Replay each webhook and prove one state change and one ledger effect.
7. Test a refund in test mode and record what happens to the platform fee.
8. Run one NGN 100 live controlled payment only after all test-mode gates pass.
9. Confirm tenant settlement, Booka fee, fee bearer, refund behavior, and ledger reconciliation.

Production customer-payment collection remains disabled until these gates pass. Wallet top-ups may remain enabled because they use a separate verified path.

### 10.3 Documentation updates

- `docs/runbooks/concierge-onboarding-test-salon.md` §3: replace the manual `metadata.paystack_subaccount_code` step with UI setup and acceptance.
- `docs/superpowers/specs/2026-06-16-30-day-launch-hardening-design.md` deposit-failure rule: align with Section 6 and decision 2.
- `docs/superpowers/specs/2026-07-15-booka-business-ledger-daily-close-design.md` §7: recorded payments use `amount_minor` and state gross vs net (decision 3).
- `docs/operations-guide.md`: add settlement mismatch triage and the `platform_transaction_fee` ledger type.

## 11. Explicit Non-Goals

- Building a complete subscription-billing catalogue (only the plan → fee-policy mapping).
- Supporting non-NGN Paystack settlement in this release.
- Changing wallet-credit economics.
- Automatically creating subaccounts during a customer conversation.
- Collecting customer money into Booka's account for later manual tenant payout.
- Rewriting historical `transactions.amount` values.
- Stripe and Flutterwave paths.

## 12. Self-Review Decisions

- **Route completeness:** eight initialization sites found (Section 2.2), plus five retail callers and four status/refund paths. All are classified.
- **Money units:** the new boundary accepts only `amountMinor`; the legacy `amount` write rule is fixed at major units.
- **Settlement drift:** `transaction_charge` overrides the subaccount split per the Paystack spec, so plan changes do not touch remote subaccounts.
- **Tenant-writable settlement:** no runtime read of `tenants.metadata`.
- **Missing setup:** all paths fail closed before a provider call, with defined per-channel behavior.
- **Webhook trust:** admin client, mandatory verification, no fallback to payload status, subject from the transaction row.
- **Auditability:** expected values stored before initialization; provider values stored separately.
- **Ledger units:** credits, with the CHECK constraint replaced explicitly.
- **Security:** tenants cannot edit policy or account rows; new tables get explicit RLS and grants.
- **Unverified:** `transaction_charge` unit and zero-value behavior are gated in test mode, not assumed.

## 13. Owner Decisions (recorded 2026-10-02)

1. **Refunds:** Booka refunds its platform fee on **full** refunds only, recorded as a negative `refund` entry in `tenant_revenue_ledger`. Partial refunds keep the fee.
2. **Handoff vs auto-cancel:** reservations held for a payment handoff are **exempt** from `api/jobs/auto-cancel-unconfirmed` until staff resolve or release the handoff.
3. **Daily close:** tenant payments are reported **gross** (customer paid), with the Booka platform fee and the Paystack fee as separate lines.
4. **Customer email:** default accepted — keep the deterministic phone-derived email from `getCustomerEmail`; never a shared placeholder.
5. **Pilot policy:** confirmed — **1%**, capped at **NGN 2,000** per transaction (`pilot_ngn_v1`, version 1).
