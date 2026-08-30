# Wallet-exhaustion follow-ups — design

**Date:** 2026-08-30
**Status:** §3 landed in full; §1 and §2 proposed
**Depends on:** `2026-08-28-whatsapp-message-metering-design.md`, migrations 139–143

## Why

The metering branch shipped the mechanism that refuses a send when a tenant's message wallet
is empty. It deliberately did **not** ship what happens around that moment. Three gaps were
surfaced by review and left open:

1. **Auto-recharge is inert.** The column and the call site exist; the implementation is a stub.
2. **Owners are not told.** They get a dashboard row they must already be logged in to see.
3. **Opt-out compliance.** A customer texting STOP into an exhausted wallet was answered with a
   handoff. Fixed 2026-08-30; the residue is documented in §3.1.

All three share a trigger and a deadline: **2026-10-01**, when Meta begins billing every
delivered service message and an empty wallet stops being theoretical.

The unifying failure they describe is the same one: *the tenant finds out their bot is silent
from a customer complaint.* Everything below exists to make that impossible.

---

## 1. Auto-recharge

### Current state — verified, not assumed

- `ai_wallets.auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false` (migration 139), plus
  `auto_recharge_threshold_credits` and `auto_recharge_amount_credits`.
- `attemptAutoRecharge()` in `src/lib/billing/messageWallet.ts` returns `false` unconditionally,
  with a doc comment saying why.
- The repo has **zero** uses of `authorization_code` or `charge_authorization`.
- `src/app/api/payments/paystack/route.ts:49` handles `charge.success` but never reads
  `data.authorization`, so no reusable card token has ever been captured.
- `src/lib/paystack.ts` exposes transfers, subaccounts, plans, subscriptions
  (`createPlan`, `createSubscription`, `cancelSubscription`, `fetchSubscription`). It does **not**
  expose `initializeTransaction`, `verifyTransaction`, or any charge-authorization call.

So there is no card-on-file capability to switch on. This is a build, not a wiring job.

### Two candidate designs

**A. Card-on-file (`POST /transaction/charge_authorization`).** Capture and store a reusable
`authorization_code` per tenant, then debit on threshold.

**B. Paystack Subscription.** A recurring fixed top-up on a plan, using functions already in the
repo, with Paystack holding the card.

**Recommendation: A.** B is less work and stores no card reference of ours, but it bills on a
fixed cadence — it cannot respond to a wallet draining faster than expected, which is precisely
the failure auto-recharge exists to prevent. A tenant who exhausts on the 8th of the month waits
until the 1st. B is a reasonable *separate* feature ("monthly plan top-up"); it is not this one.

### Design (A)

**Consent is the gate, not the schema.** Storing a reusable card token is a commitment the tenant
makes, so it must be an explicit opt-in that states the trigger amount, the recharge amount, and
how to cancel — captured at a checkout the tenant completes themselves, never inferred from a
past payment. Enabling `auto_recharge_enabled` without a stored consent record must be impossible.

New table `tenant_payment_authorizations`:

| column | purpose |
|---|---|
| `tenant_id` | FK, one active row per tenant |
| `authorization_code` | Paystack's reusable token |
| `card_last4`, `card_brand`, `card_exp` | for the UI and for expiry pre-warning |
| `customer_email` | Paystack ties authorizations to a customer |
| `consented_at`, `consented_by_user_id` | who agreed, when |
| `consent_terms` | JSONB snapshot of the amounts shown at consent time |
| `revoked_at` | soft delete; never hard-delete a consent record |

Capture path: extend the existing `charge.success` webhook to persist
`data.authorization.authorization_code` **only when** `data.authorization.reusable === true` and
the transaction was initiated from the auto-recharge consent flow (carry a marker in `metadata`).
Do not opportunistically harvest tokens from ordinary customer payments — those customers did not
consent to anything, and the payer is frequently not the tenant.

Debit path: `attemptAutoRecharge(admin, tenantId)` replaces the stub —

1. Load the wallet and the active authorization. No authorization → return false (grace → handoff,
   which already works).
2. Check the guardrails in §1.1. Any breach → return false and alert.
3. `POST /transaction/charge_authorization` for `auto_recharge_amount_credits`.
4. On success, call `topup_ai_wallet` so the credit lands as a ledger row like every other
   movement. **Never** write `balance_credits` directly.
5. Record the attempt either way, and notify the tenant with a receipt.

### 1.1 Guardrails — non-negotiable

An automatic debit that misfires is worse than no automatic debit. All of these are hard limits,
not settings:

- **Idempotency key** per (tenant, threshold-crossing) so a retry storm cannot double-charge.
- **Max 1 recharge per tenant per hour**, and **max 3 per day**, regardless of balance.
- **A daily currency cap** the tenant sets at consent time and can lower but not raise without
  re-consenting.
- **Fail open to grace, never to a retry loop.** A declined card must return false immediately.
  The grace → handoff chain already handles it safely.
- **Three consecutive declines disables auto-recharge** and alerts the tenant. A card that keeps
  failing is a card that will keep failing.

### 1.2 Must be verified against live Paystack docs before any code

Per the standing dependency rule, and because this moves real money:

- The current endpoint, request shape and response shape for charge-authorization.
- Whether `reusable` authorizations are available on this account for **NGN cards** specifically.
- Paystack's own idempotency mechanism, if any, so ours composes with it rather than duplicating.
- The failure taxonomy — which decline codes are retryable and which are terminal.

Report those findings before writing the implementation.

### 1.3 Out of scope

Bank-transfer and USSD top-ups (not reusable), multi-currency, and any UI beyond the consent
screen and a receipt.

---

## 2. Owner notification

### Current state — verified

`notifyOwner` in `src/lib/billing/messageHandoff.ts` writes a `notifications` row and sends a line
to **Booka's own** ops Telegram channel (process-level `TELEGRAM_CHAT_ID`), capped at one per
tenant per day via `ai_wallets.message_handoff_warned_on` (migration 143). The tenant receives no
push of any kind.

Available in-repo: `src/lib/integrations/notification-aggregator.ts` (`email` | `sms` | `whatsapp`),
backed by `email-service.ts`, `sms-service.ts`, `whatsapp-service.ts`.

### The design change that actually matters

**Warn before zero, not at zero.** `ai_wallets.low_balance_threshold_credits` already exists
(migration 077, `DEFAULT 25`) and nothing reads it on the message path. Alerting at exhaustion is
alerting after the damage — the bot is already silent and customers are already being handed off.
The primary alert should fire when the balance crosses the threshold *downward*, while the tenant
still has room to act.

Two alerts, different urgency:

| Trigger | Channel | Cadence |
|---|---|---|
| Balance crosses `low_balance_threshold_credits` | email + in-app | once per crossing, re-armed by a top-up |
| Wallet exhausted, handoff issued | email + WhatsApp-to-owner + in-app | once per tenant per day (existing cap) |

**The WhatsApp-to-owner message must be unmetered.** It is a message, so a metered send would
reserve credit against the very wallet that is empty, be refused, and trigger a handoff — the
alert would fail at exactly the moment it is needed, and would recurse. Use
`getTenantWhatsAppProviderClientUnmetered`, as the customer handoff does, and treat it as
platform-funded. This is the single most important detail in this section.

Cadence is bounded by the existing per-tenant-per-day column, so an owner with 200 live
conversations still gets one alert.

### 2.1 Also

- The `notifications` table has no severity column, so "urgent" survives only as title text. Either
  add one or accept that the dashboard cannot sort by it — decide explicitly rather than by default.
- Route to the tenant **owner**, not to every `tenant_users` row. Staff cannot top up.

---

## 3. Opt-out compliance

### 3.1 Landed 2026-08-30 (commit `2248314`)

`handleOptOutSignal` (`src/lib/whatsapp/v2/pipeline.ts`) built its client with
`getProviderClient(config)`. After the metering branch, that config carries a `tenantId`, so the
client was **metered** — meaning a customer who texted STOP into an exhausted wallet got
*"a member of our team will reply to you here shortly"* instead of *"You're unsubscribed."* The
handoff was also itself an unsolicited message to someone who had just unsubscribed, sent through
a client that bypasses `sendGovernedInitiated`'s opt-out checks entirely.

Fixed two ways:

- Opt-out confirmations now use the **unmetered** client. They are regulatory messages, not
  commercial ones: Booka funds them and they send regardless of the tenant's balance. Refusing to
  confirm an opt-out is a compliance risk far exceeding the ~₦22 the message costs.
- `triggerWalletHandoff` now refuses any customer with `whatsapp_conversations.opted_out_at` set.
  Because the handoff bypasses the governed-send path, this is the **only** opt-out guard on it.
  A failed lookup proceeds rather than suppressing — a broken query must not silently kill a
  feature the tenant depends on — but a real opt-out always wins.

### 3.2 Remaining

- ~~**The 24-hour service window is not asserted.**~~ **Landed 2026-08-30.** The handoff sends
  free-form text, which Meta permits only inside the customer-service window. This was *implicitly*
  safe — a handoff needs a `chats` row and only inbound conversations have one — but that was a
  property of the call graph, not a check. `readConversationGuards` now reads
  `whatsapp_conversations.last_inbound_at` in the **same query** as the opt-out check (same row, no
  extra round trip) and returns `outside_service_window` when it is older than 24h. Fails toward
  sending on a read error or a missing row, matching the opt-out guard.
- **Instagram.** `triggerWalletHandoff` returns `unsupported_channel` for Instagram. When that
  channel is supported, the opt-out check must be extended: Instagram opt-out state does not live
  in `whatsapp_conversations`.
- **Copy review.** The handoff says a team member "will reply shortly". If the tenant has no staff
  monitoring the inbox, that is a promise Booka makes on their behalf and cannot keep. Consider
  making the copy conditional on the tenant having an active human handler, or softening it.

---

## Sequencing

§3.2 and §2 are small and reduce risk before the cutover. §1 is a payments feature with its own
verification step and should not be rushed to meet 2026-10-01 — the grace → handoff chain already
degrades safely without it, and shipping a half-verified automatic debit is worse than shipping
none. Recommended order: **§3.2 → §2 → §1.**

Until §1 ships, `auto_recharge_enabled` must stay `false` for every tenant, and the operations
guide says so.
