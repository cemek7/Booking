# WhatsApp Message Metering — Design

- **Date:** 2026-08-28
- **Status:** Design approved, implementation not started
- **Branch:** `feat/whatsapp-message-metering` (off `staging`)
- **Deadline:** live and charging by **2026-10-01**

---

## 1. Why

From **2026-10-01** Meta bills WhatsApp **service messages** per delivered message.
Today a free-form reply inside the 24-hour customer service window is free; after
that date it is not. Utility templates also lose their free-in-window status.

The provisional Nigerian rate is **$0.0101 ≈ ₦14 per delivered message**. Meta
publishes final country rates by **2026-09-01**, so ₦14 is a placeholder that must
live in configuration, never in code.

The consequence for Booka is direct: every automated reply becomes a variable
cost paid to Meta in USD, billed to a business earning in NGN. A flat unlimited
plan at ₦3,000–₦5,000 is not survivable at 8 replies per booking. Booka must be
able to answer, per tenant and per message, *"did this cost us money, how much,
and who should pay for it"* — and it must be able to stop spending when a tenant
has not paid.

This spec covers **only the metering ledger**: the mechanism that reserves, gates,
settles and reconciles the cost of every outbound message. Pricing tiers, flow
compression and the cost-intelligence dashboard are separate specs that all read
from what is built here.

### What is *not* changing

- The **72-hour free entry-point window** (Click-to-WhatsApp ads, Facebook Page
  CTA) survives 2026-10-01 unchanged and still covers service messages. It becomes
  Booka's cheapest acquisition path.
- **Volume tier discounts** continue to apply to utility and authentication
  templates. Service messages get none — flat rate, forever. This is a genuine
  arbitrage that argues for templatising every repeatable message, and it is the
  reason `pricing_category` is persisted per message below.
- The rules-first **L1 rules → L2 Flash-Lite → L3 Flash** stack stays. Meta
  Business Agent is *not* a cheaper alternative: at $2.00/million tokens it lands
  at roughly 4–5¢ per message, about 4× the service-message rate in Nigeria.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **Booka pays Meta and resells message credits to tenants.** | Tenants cannot hold Meta billing relationships. Booka already models prepaid credits as a liability in `ai_wallets`. |
| D2 | **One wallet, two meters.** Extend `ai_wallets` / `ai_wallet_ledger` with a `meter` dimension rather than building a second wallet. | A second wallet duplicates reserve/settle/cap logic and splits the balance a tenant has to reason about. |
| D3 | **Reserve at the provider adapter, settle from the webhook.** | The reservation is the *gate* (it can refuse a send); the webhook is the *truth* (Meta states whether the message was billable). |
| D4 | **Charge from Meta's own `pricing` object, never from a local model of Meta's rules.** | Makes the same code correct on both sides of 2026-10-01 with no deploy. |
| D5 | **Never bill a message that was not delivered.** Unsettled reservations are released after 24h. | Enforces "meter delivered, not attempted" structurally rather than by convention. |
| D6 | **Auto-recharge → grace overdraft → handoff**, in that order, when a wallet empties. | A silent dead bot is the worst outcome for an SME. Every step degrades loudly. |
| D7 | **Ship in shadow mode in September; flip to live on 2026-10-01.** | Six weeks of real replies-per-booking data per tenant, gathered before the numbers have to be right. Also de-risks the deadline: the code is in production and proven weeks early, and 2026-10-01 is a config flag, not a release. |
| D8 | **Tier allowances are recorded as a provisional straw-man (Appendix A), not as spec.** | Commercial conversations need numbers now. But they cannot be finalised before the 2026-09-01 rate publication and shadow-mode data, so they are quarantined from the normative body. |

### Rejected

- **Metering inside `governedSend`** (`src/lib/whatsapp/v2/deliverability/governedSend.ts`).
  It looks like the natural home, but it gates *business-initiated* sends only.
  Service-window replies — precisely what becomes billable — bypass it entirely.
  Metering there would leak the majority of post-October cost.
- **Editing `MetaAdapter.sendPayload` directly.** Covers one provider, mixes billing
  into a transport adapter, and gives no Instagram or WAHA path.
- **Renaming `ai_wallets` to something meter-neutral.** Touches the RPCs, `ai-wallet.ts`,
  the billing routes and the UI for zero functional gain. The naming debt is carried
  openly instead.

---

## 3. Prerequisite: webhook idempotency bug

**This blocks everything below and must land first.**

`src/app/api/webhooks/whatsapp/meta/route.ts` (statuses loop, L171) dedupes status
webhooks on `status.id`:

```ts
for (const status of value.statuses ?? []) {
  if (!status.id) continue;
  await handleIdempotency(
    supabase, 'meta', `${metaPhoneNumberId}:status`, status.id, { ... }
  );
}
```

`statuses[].id` **is the wamid**. Meta emits `sent`, then `delivered`, then `read`
as separate webhooks all carrying the same `id`. Today the `sent` event wins and
every later event is discarded as a duplicate.

Settlement fires on `delivered`. Left unfixed, metering would pass every test in
development and silently never charge anyone in production — reservations would
accumulate and be swept as anomalies 24 hours later.

**Fix:** key on `${status.id}:${status.status}`.

The `statuses` type declaration (L39–43) is also impoverished — `id`, `status`,
`timestamp` only. It must be widened to carry `pricing` and `conversation`.

---

## 4. Data model

> Migrations are plaintext, idempotent and RLS-aware, validated in a throwaway
> `postgres:16-alpine` container. **The user runs migrations on the VPS.** Each
> migration ships with a `_rollback.sql` companion, per the `136`/`137` convention.
>
> `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throughout. Never
> `CREATE TABLE IF NOT EXISTS` against an existing table — it silently skips.

### 139 — meter dimension and wallet knobs

```sql
ALTER TABLE public.ai_wallets
  ADD COLUMN IF NOT EXISTS message_rate_credits NUMERIC(20,6),              -- NULL = platform default
  ADD COLUMN IF NOT EXISTS grace_overdraft_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_recharge_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_recharge_threshold_credits NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS auto_recharge_amount_credits NUMERIC(20,6);

ALTER TABLE public.ai_wallet_ledger
  ADD COLUMN IF NOT EXISTS meter TEXT NOT NULL DEFAULT 'llm'
    CHECK (meter IN ('llm', 'whatsapp'));

CREATE INDEX IF NOT EXISTS idx_ai_wallet_ledger_tenant_meter_created_at
  ON public.ai_wallet_ledger (tenant_id, meter, created_at DESC);
```

The `DEFAULT 'llm'` backfills every existing row correctly — all historical spend
is LLM spend.

### 140 — `whatsapp_message_charges`

Correlates a wamid to a wallet reservation. This is the table the whole design
turns on.

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_message_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                     -- meta | waha | evolution | instagram
  wamid TEXT,                                 -- NULL until the send returns
  wallet_reservation_id UUID,                 -- ai_wallet_ledger.id of the reservation
  reserved_credits NUMERIC(20,6) NOT NULL DEFAULT 0,
  settled_credits NUMERIC(20,6),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','settled','released','failed')),
  billable BOOLEAN,                           -- from Meta's pricing object
  pricing_category TEXT,                      -- service | utility | marketing | authentication
  pricing_type TEXT,                          -- free_customer_service | free_entry_point | paid
  pricing_model TEXT,                         -- PMP
  delivery_status TEXT,                       -- sent | delivered | read | failed
  message_kind TEXT,                          -- freeform | template | interactive | media
  mode TEXT NOT NULL DEFAULT 'live'
    CHECK (mode IN ('shadow','live')),
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_message_charges_tenant_wamid
  ON public.whatsapp_message_charges (tenant_id, wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_sweeper
  ON public.whatsapp_message_charges (sent_at) WHERE status = 'reserved';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_charges_tenant_sent_at
  ON public.whatsapp_message_charges (tenant_id, sent_at DESC);

ALTER TABLE public.whatsapp_message_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges;
CREATE POLICY whatsapp_message_charges_service_role
  ON public.whatsapp_message_charges
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Notes:

- The partial unique index on `(tenant_id, wamid)` is what makes settlement
  idempotent — a replayed `delivered` webhook cannot double-charge.
- `mode` is stamped per row so shadow-period rows are never mistaken for revenue
  during reconciliation.
- `attribution` carries `{conversation_id, booking_id, flow, ai_layer}`. That one
  column is what turns cost-per-booking, cost-per-flow, cost-per-customer and
  cost-per-tenant into a `GROUP BY` later instead of a migration later. It is the
  only part of the cost-intelligence workstream landing now, and it is cheap.

### 141 — overdraft-aware reservation

`reserve_ai_wallet_spend` currently hard-fails with no overdraft path
(`077_ai_wallets.sql` L157):

```sql
IF wallet.balance_credits < p_amount_credits THEN
  RETURN QUERY SELECT false, wallet.balance_credits, NULL::UUID, 'insufficient_balance';
  RETURN;
END IF;
```

Add `p_allow_overdraft_credits NUMERIC DEFAULT 0` and change the check to:

```sql
IF wallet.balance_credits
     + LEAST(p_allow_overdraft_credits, wallet.grace_overdraft_credits)
   < p_amount_credits THEN
```

Also add `p_meter TEXT DEFAULT 'llm'` and write it to the ledger row.

**The old 7-argument signature must be `DROP FUNCTION`-ed explicitly.** Postgres
would otherwise keep both overloads, and Supabase's named-parameter RPC resolution
goes ambiguous at runtime rather than at deploy time. New `GRANT EXECUTE` to
`service_role` for the new signature.

`settle_ai_wallet_spend` gains the same `p_meter` passthrough. Its existing
`adjustment := p_estimated_credits - p_actual_credits` logic already handles
settle-to-zero correctly (full refund), so no other change is needed.

---

## 5. The send gate

New module: `src/lib/billing/messageWallet.ts`.

```ts
reserveOutboundMessage(params): Promise<
  | { allow: true;  chargeId: string; mode: 'paid' | 'grace' | 'free' | 'shadow' }
  | { allow: false; reason: 'handoff' }
>
settleOutboundMessage(params): Promise<void>
releaseStaleReservations(olderThanMs: number): Promise<{ released: number }>
```

### Chain

1. **Non-Meta provider** (WAHA / Evolution) → write a charge row at 0 credits, no
   reservation, allow. Free, but *recorded* — which makes Meta-vs-WAHA economics
   directly comparable per tenant. That comparison is the reasoning
   `graduationAdvisor.ts` should have been doing all along.
2. **`checkCaps`** (`spendCaps/spendGuard.ts`) → velocity or daily cap hit → handoff.
3. **Reserve** at the tenant's resolved `message_rate_credits`. On
   `insufficient_balance`:
   - auto-recharge enabled → charge the card on file via Paystack → retry the
     reserve **once**;
   - otherwise, or if the recharge fails → retry with
     `p_allow_overdraft_credits = grace_overdraft_credits`;
   - still refused → **handoff**.
4. **Handoff** — one final message to the customer pointing them at the owner's
   own number, an alert to the owner, an urgent dashboard task.

### Two things that are easy to get wrong

**The handoff message itself costs money**, and by definition the wallet is empty
when it fires. It must bypass the gate against a small platform-funded allowance,
and must be idempotent — once per conversation, flagged on `chats.metadata`.
Without this the failure mode is exactly the silent wall the design exists to
prevent.

**`checkCaps` currently fails open** (`spendGuard.ts` L156–165, `console.warn`
then `allowed: true`). For LLM spend that is a defensible call. For Meta spend it
means unbounded external cost on a transient DB error. But failing *closed*
silences every tenant's bot on that same error. Resolution: a cap-check **error**
(as distinct from a cap-check *refusal*) falls through to the grace-overdraft
path rather than to either extreme. The overdraft the design already has doubles
as the bound on fail-open.

### Where it attaches

New module: `src/lib/whatsapp/providers/metered.ts` — a
`withMetering(client, { tenantId, provider })` decorator implementing
`WhatsAppProviderClient`, applied in `getTenantChannelProviderClient`.

It wraps all four send methods (`sendTextMessage`, `sendTemplateMessage`,
`sendMediaMessage`, `sendInteractiveMessage`) uniformly, keeps the adapters pure,
and covers every provider including Instagram for free.

Requires adding `tenantId?: string` to `ProviderConfig` in `providers/types.ts`.

`getDefaultWhatsAppProviderClient()` has no tenant, so **platform-level sends stay
unmetered**. That is deliberate and needs an explicit code comment so nobody
"fixes" it into a crash.

Ordering inside the decorator: reserve → call the underlying send → on
`success: false`, immediately release the reservation and mark the charge row
`failed`; on `success: true`, write the returned wamid onto the charge row. The
wamid is already available — `MetaAdapter.sendPayload` returns
`{ success, messageId }` extracted from `data.messages[0].id`.

---

## 6. Settlement and reconciliation

### Settlement

In the statuses loop of `webhooks/whatsapp/meta/route.ts`, after the idempotency
fix from §3. Resolve the charge row by `(tenant_id, wamid = status.id)`, then:

| `status.status` | Action |
|---|---|
| `sent` | Record `delivery_status` only. **Do not settle** — Meta bills on delivery. |
| `delivered` | Settle. Actual = `status.pricing.billable ? tenant rate : 0`. |
| `read` | Settle only if `delivered` was missed. Otherwise record `delivery_status`. |
| `failed` | Settle at 0, status `released`. |

`pricing.category`, `pricing.type` and `pricing.model` are persisted verbatim.
A charge row already in `settled` or `released` is a no-op — the unique index
plus a status guard make replay safe.

Booka never decides whether a message was billable. Meta does, in the payload.
That is D4, and it is the single reason this code does not need to change on
2026-10-01.

### Sweeper

Worker route under `src/app/api/worker/`, following the existing
`api/worker/whatsapp` pattern, every 15 minutes:

- release reservations where `status = 'reserved' AND sent_at < now() - interval '24 hours'`;
- increment an anomaly counter;
- alert when the release rate crosses a threshold.

A rising release rate is the only early warning available that the webhook
subscription has broken. Without the sweeper, a broken subscription silently
drains every tenant's balance into reservations that never settle.

### Monthly reconciliation

Sum `settled_credits WHERE billable = true AND mode = 'live'` per calendar month
and compare against Meta's billing export. Alert on **>2% drift**. This is how FX
movement and rate-card drift surface before they eat a quarter's margin, and it
is the check that catches a category being mis-billed at scale.

---

## 7. Rate policy and modes

New module: `src/lib/billing/messageRates.ts`.

Resolution order mirrors `getTenantTokenRate` in `ai-wallet.ts` (L126):

1. `ai_wallets.message_rate_credits` (per-tenant override)
2. `BOOKA_MESSAGE_RATE_CREDITS` (platform default)
3. hard-coded fallback

Sell price = Meta cost × `BOOKA_MESSAGE_MARKUP` (**default 1.6**), giving ≈₦22.40
against a ₦14 cost. The markup covers FX movement, BSP and tax overhead, failed
and retried sends, and operating margin.

When Meta publishes Nigeria's confirmed rate on **2026-09-01**, this is **one
environment-variable change**, not a code change or a deploy.

### `BOOKA_MESSAGE_METERING_MODE`

| Value | Behaviour |
|---|---|
| `shadow` | Writes every charge row, computes what *would* have been charged, stamps `mode='shadow'`. **Settles at 0. Never gates a send. Never triggers handoff.** |
| `live` | Full chain: reserve, gate, settle, handoff. |

Shadow is the default until 2026-10-01. Note that during shadow mode Meta's own
`pricing.billable` is still `false` for service messages, so shadow-mode charge
rows record the *volume* truthfully but the *billable flag* only becomes
meaningful on 2026-10-01. Shadow-period value is therefore in per-tenant message
volume and flow attribution — which is exactly the input the tier numbers need.

### New environment variables

| Variable | Default | Purpose |
|---|---|---|
| `BOOKA_MESSAGE_METERING_MODE` | `shadow` | shadow / live |
| `BOOKA_MESSAGE_RATE_CREDITS` | provisional ₦14 equivalent | platform Meta cost per message |
| `BOOKA_MESSAGE_MARKUP` | `1.6` | resale multiplier |
| `BOOKA_MESSAGE_GRACE_CREDITS` | small non-zero | default grace overdraft for new wallets |
| `BOOKA_MESSAGE_RECONCILE_DRIFT_PCT` | `2` | monthly reconciliation alert threshold |

---

## 8. Testing

- **Unit** — rate resolution across all three tiers of the fallback chain; every
  branch of the send-gate chain including both auto-recharge outcomes; the
  cap-check-error → grace path.
- **Webhook fixtures** — `sent` / `delivered` / `read` / `failed`, each with
  `billable: false` *and* `billable: true` pricing objects. This proves the
  October behaviour now rather than discovering it then, and is the highest-value
  test in the suite.
- **Duplicate `delivered`** — asserts exactly-once settlement. This test would
  have caught the §3 bug.
- **Out-of-order webhooks** — `delivered` arriving before `sent`.
- **Sweeper** — exactly-once release; a settled row is never released.
- **Shadow mode** — asserts no send is ever gated and every settlement is 0.
- **Integration** — send → status → settle round trip on
  `jest.integration.config.cjs` against a stubbed Graph API.
- **Migrations** — validated in a throwaway `postgres:16-alpine` container,
  including the `139/140/141` up-then-rollback cycle and the function-overload
  drop in `141`.

---

## 9. Out of scope

Deliberately excluded. Each depends on this ledger existing and on shadow-mode
data, and each gets its own spec:

1. **Tier and allowance redesign** — blocked on the 2026-09-01 rate and shadow data.
2. **Conversational flow compression** in the v2 pipeline — removing unnecessary
   acknowledgements ("Okay", "Checking…"), merging multi-turn exchanges. This is
   where the largest cost reduction lives, but it needs the ledger first to prove
   the reduction is real.
3. **WhatsApp Cost Intelligence** read layer and dashboard — cost per conversation,
   booking, customer, tenant and workflow, with optimisation recommendations.
   Enabled by `attribution`.
4. **Broadcast and bulk-reminder cost preview** — show the cost before sending.
5. **CTWA 72-hour entry-point strategy** — routing acquisition through the free
   window.

---

## 10. Rollout

| When | What |
|---|---|
| Now | §3 idempotency fix, merged to `staging` independently. |
| Early September | Migrations 139–141 run on the VPS by the user. Metering deployed in `shadow`. |
| 2026-09-01 | Meta publishes Nigeria's confirmed rate → update `BOOKA_MESSAGE_RATE_CREDITS`. |
| Mid September | Read shadow data: actual replies per booking, per tenant. Finalise tier allowances (Appendix A becomes spec). |
| Late September | Tenant comms: new pricing, wallet, auto-recharge opt-in. |
| **2026-10-01** | `BOOKA_MESSAGE_METERING_MODE=live`. Config change, not a deploy. |

---

## Appendix A — Provisional tier straw-man

> **These numbers are not spec.** They are a working straw-man for commercial
> conversations, built on the provisional ₦14 rate. They will move once Meta
> publishes Nigeria's confirmed rate on 2026-09-01 and once shadow-mode data
> shows real replies-per-booking. Do not print them on a website.

At ₦14 cost and a 1.6× markup (≈₦22.40 sold), and assuming ~8 replies per booking:

| Tier | Price | Included messages | Approx. bookings/mo | Message cost at ₦14 | Gross margin |
|---|---|---|---|---|---|
| Starter | ₦15,000 | 450 | ~55 | ₦6,300 | ₦8,700 |
| Growth | ₦20,000 | 750 | ~95 | ₦10,500 | ₦9,500 |
| Pro | ₦50,000 | 2,200 | ~275 | ₦30,800 | ₦19,200 |

Overage is wallet recharge at the resale rate. All three tiers assume the
flow-compression work in §9.2 lands — at today's uncompressed reply counts the
margins above are optimistic, which is itself an argument for sequencing
compression immediately after this ledger.

**Credit expiry:** granted (tier-included) credits expire at period end;
purchased (wallet top-up) credits never expire. Defensible to customers, and it
stops allowance hoarding turning into an unbounded balance-sheet liability.

Tier credits land as a `topup` ledger row with
`reference = 'plan_grant:<tenant_id>:<period>'`, made idempotent through the
existing `onConflict` upsert.

---

## Appendix B — Files touched

| File | Change |
|---|---|
| `db/migrations/139_whatsapp_metering_wallet.sql` (+ rollback) | meter dimension, wallet knobs |
| `db/migrations/140_whatsapp_message_charges.sql` (+ rollback) | correlation table |
| `db/migrations/141_overdraft_reservation.sql` (+ rollback) | RPC overdraft + meter params |
| `src/app/api/webhooks/whatsapp/meta/route.ts` | **idempotency fix**, widened `statuses` type, settlement |
| `src/lib/billing/messageWallet.ts` | new — reserve / settle / release |
| `src/lib/billing/messageRates.ts` | new — rate resolution and markup |
| `src/lib/whatsapp/providers/metered.ts` | new — `withMetering` decorator |
| `src/lib/whatsapp/providers/types.ts` | add `tenantId?` to `ProviderConfig` |
| `src/lib/whatsapp/providers/providerSelection.ts` | apply decorator; comment the platform-send exemption |
| `src/app/api/worker/message-charges/route.ts` | new — sweeper |
| `src/lib/billing/spendCaps/spendGuard.ts` | cap-check error falls to grace, not open |
