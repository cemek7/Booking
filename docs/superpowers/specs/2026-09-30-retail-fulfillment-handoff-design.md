# Retail Fulfilment Onboarding and Human Handoff — Design

**Date:** 2026-09-30
**Status:** Approved direction; implementation pending plan
**Product:** Booka AI Revenue Front Desk
**Default vertical:** Beauty, while remaining cross-vertical

## 1. Objective

Booka must not collect money for a physical product while silently assuming the tenant can deliver it. Product-selling tenants configure fulfilment during onboarding. Booka resolves pickup or a known delivery policy before payment and escalates uncertain delivery arrangements to a human without losing the customer, order, payment or conversation context.

This design uses Booka's existing retail orders, payment lifecycle, canonical conversation threads, escalation queue and human takeover controls. It does not build a courier marketplace.

## 2. Current gap

The current retail flow can:

- build a tenant-scoped cart and order;
- generate a Paystack payment link;
- mark a retail order paid from verified webhook evidence;
- decrement inventory idempotently;
- retain `unfulfilled`, `preparing` and `fulfilled` order states;
- add a delivery fee through owner commerce commands;
- hand a canonical conversation to a human.

It does not currently:

- record whether the tenant offers pickup, owns a rider, or uses a manually booked courier;
- collect an order-scoped fulfilment method before payment;
- prevent the AI from inventing delivery availability, fees or ETAs;
- create a fulfilment escalation when payment succeeds without a delivery plan;
- keep the AI paused until the human explicitly releases the conversation.

The existing payment-success message therefore confirms payment but only says that fulfilment updates will follow.

## 3. Product principles

1. **Resolve delivery before payment when possible.** The final payment amount should include every known delivery fee.
2. **Never invent logistics.** Booka must not claim a rider is available, estimate a third-party fee, or promise an ETA without verified tenant or human input.
3. **Keep the sale alive.** Uncertain fulfilment becomes a contextual human handoff, not a dead end or a request for the customer to repeat details.
4. **Payment remains valid.** A paid order with unresolved delivery stays paid and unfulfilled; it is never silently cancelled or charged again.
5. **Human release is explicit.** A fulfilment hold does not expire back into AI control merely because a timer elapsed.
6. **Cross-vertical, conditional onboarding.** Service-only tenants never see irrelevant courier questions. Beauty tenants that sell hair, skincare or other products do.

## 4. Tenant fulfilment configuration

The canonical configuration lives in `tenants.settings.retailFulfillment` and is validated by the existing tenant-settings API.

```ts
type RetailFulfillmentMethod =
  | 'customer_pickup'
  | 'own_dispatch'
  | 'third_party_manual';

type RetailFulfillmentProvider = 'bolt' | 'indrive' | 'other';

type RetailDeliveryFeePolicy =
  | 'included'
  | 'fixed'
  | 'quote_required'
  | 'manual';

interface RetailFulfillmentSettings {
  methods: RetailFulfillmentMethod[];
  thirdPartyProviders: RetailFulfillmentProvider[];
  serviceAreas: string[];
  feePolicy: RetailDeliveryFeePolicy;
  fixedFeeCents?: number;
  customerNotice?: string;
}
```

Validation rules:

- `methods` is unique and allowlisted.
- `thirdPartyProviders` is allowed only with `third_party_manual`.
- `fixedFeeCents` is required and non-negative only for `fixed`.
- `serviceAreas` and `customerNotice` are trimmed, bounded strings.
- Missing configuration is not treated as delivery-ready.
- Secrets, courier credentials and customer addresses never belong in tenant settings.

Derived readiness is deterministic:

- `customer_pickup` is ready without a delivery fee.
- `own_dispatch` is ready when the fee policy is `included` or `fixed`; `quote_required` and `manual` require a human.
- `third_party_manual` always requires a human quote/arrangement in the initial release.
- an empty or missing method list requires a human.

## 5. Onboarding and settings UX

The onboarding `Offerings` step already captures products and derives sales/inventory capabilities. After at least one valid product is entered, or when the commercial motion is `sales` or `hybrid`, onboarding shows a concise fulfilment section:

1. How can customers receive product orders?
   - Pick up from us
   - Our rider/dispatch team delivers
   - We arrange Bolt, inDrive or another local courier
2. Which areas do you normally serve?
3. How is the delivery fee determined?
   - Included
   - Fixed amount
   - Quoted for each order
   - Arranged manually
4. Optional customer-facing fulfilment note.

The same configuration is editable later from a dedicated `Order fulfilment` card in Business Settings. The UI explains that Bolt/inDrive are manually arranged initially and that Booka will involve staff before collecting a delivery-dependent total.

Service-only `booking` or `enquiry` tenants with no products skip the section. Skipping a relevant fulfilment section is allowed during onboarding but produces the safe unconfigured state and a launch warning for product payments.

## 6. Order-scoped fulfilment state

Customer addresses and selections are order facts, not long-term customer-memory facts. They are stored only in the retail order metadata and active structured conversation state.

```ts
interface RetailOrderFulfillmentContext {
  method: 'customer_pickup' | 'own_dispatch' | 'third_party_manual' | null;
  provider: 'bolt' | 'indrive' | 'other' | null;
  deliveryAddress: string | null;
  serviceArea: string | null;
  feeStatus: 'not_required' | 'known' | 'quote_required' | 'confirmed';
  deliveryFeeCents: number | null;
  arrangementStatus:
    | 'not_started'
    | 'awaiting_customer_choice'
    | 'awaiting_human'
    | 'arranged'
    | 'completed';
  conversationThreadId: string | null;
}
```

The AI prompt receives only the active order's bounded fulfilment context. Delivery addresses are excluded from verified cross-visit customer memory, logs, metrics and model-training records.

## 7. Conversational sales flow

### 7.1 Before payment

When a customer is ready to buy:

1. Booka loads the tenant's fulfilment readiness.
2. If multiple methods are available, Booka asks the customer to choose pickup or delivery.
3. Pickup proceeds without a delivery fee and records pickup as the chosen method.
4. Own dispatch with an included or fixed fee collects the delivery address, validates only that it is non-empty and within a configured service-area label when one is explicitly selected, then applies the known fee before generating the payment link.
5. A quoted/manual own-dispatch fee, third-party courier, or missing configuration moves the order to `awaiting_human` before payment.

For the manual path, Booka says that a team member will confirm the delivery arrangement and final amount. It creates a contextual escalation and holds the thread until release. Booka does not send a payment link until a human confirms the method and fee.

### 7.2 Human resolution

The operator sees:

- customer and channel;
- canonical conversation summary;
- order items and subtotal;
- requested fulfilment method/provider;
- order-scoped delivery address when supplied;
- the unresolved fee/area reason;
- actions already completed.

The Orders workspace adds one tenant-scoped `Confirm fulfilment` action. It requires the method, confirmed fee and a short operator note when the order is awaiting a human. The server applies the delivery fee exactly once, marks the arrangement confirmed, generates or reuses the order's payment link, sends the customer the confirmed total, and releases the conversation. A failure before all durable writes complete leaves the escalation open and is safe to retry.

The operator can also reply through the existing chat surface while researching a courier. Sending an ordinary message keeps the fulfilment escalation open; only `Confirm fulfilment`, explicit escalation resolution, or the existing authorized release/close action returns the thread to AI control. Booka resumes from the same order state without asking the customer to repeat their cart or address.

### 7.3 Post-payment safety net

Payment can arrive from an older link, a public storefront, or a race with configuration changes. After verified retail payment success, Booka reevaluates the order's fulfilment context.

If no arrangement is confirmed:

- the order remains `paid` and `unfulfilled`;
- the sales journey becomes `awaiting_fulfillment_handoff`;
- exactly one order-scoped escalation is created;
- the canonical thread is held until explicit release when a thread exists;
- the customer receives an accurate payment receipt stating that a team member will arrange delivery or pickup;
- no second payment link, payment confirmation or escalation is produced on webhook replay.

If a public-storefront order has no canonical conversation thread, the order-level escalation is still created and appears in the owner's operational queue. Booka must not fabricate a chat thread solely to satisfy handoff plumbing.

## 8. Durable handoff and idempotency

Migration 159 adds an optional `retail_order_id` reference and allowlisted `reason_code` to `escalation_queue`. A partial unique index on `(tenant_id, retail_order_id, reason_code)` where `reason_code = 'retail_fulfillment'` permits at most one fulfilment escalation per tenant and retail order without preventing unrelated support escalations. RLS remains enabled; server-only mutation and tenant-scoped operator reads follow the existing escalation model.

`createHumanHandoff` gains an order-aware path that:

- verifies tenant and order ownership and, when supplied, thread ownership;
- reuses the existing escalation on replay;
- snapshots canonical state without duplicating raw message history;
- records a stable reason code separately from customer-facing text.

An order without a canonical thread creates the same order-scoped escalation with null conversation fields. Thread-only takeover operations are skipped, but the paid/unfulfilled order remains visible to the operator.

Human takeover gains an explicit `untilReleased` mode. Existing 30-minute operator takeover behavior remains unchanged. An until-released hold is represented distinctly and is cleared only by the existing release/close action. Compatibility projection mirrors the hold without making the legacy conversation authoritative.

Payment webhook processing remains retryable. If paid-order finalization succeeds but fulfilment escalation or hold persistence fails, the handler returns an error so the provider retries. The already-paid transition, inventory movement, confirmation and escalation paths must all be idempotent.

## 9. Customer messages

Messages are factual and method-specific:

- **Manual before payment:** “A team member will confirm delivery availability and the final delivery fee here before you pay.”
- **Paid but unresolved:** “Payment received ✅ Your order is confirmed. A team member is arranging delivery or pickup and will reply here with the details.”
- **Pickup:** “Payment received ✅ Your order is confirmed for pickup. We’ll share the pickup details here.”
- **Own dispatch arranged:** “Payment received ✅ Your order is confirmed for delivery. We’ll keep you updated here.”

Tenant-configured customer notes may supplement these messages but cannot override payment truth, claim a courier booking, or introduce an unverified ETA.

## 10. Third-party delivery boundary

The first release records Bolt, inDrive or another provider as a tenant preference only. Staff books the courier outside Booka and confirms the outcome in the conversation.

No direct API integration is included because:

- [Bolt Stores API](https://developer.bolt.eu/stores) access is support enabled and oriented to Bolt Food/Stores merchant integrations;
- a suitable public, self-service Nigerian inDrive merchant dispatch API has not been verified;
- courier fees, service areas, availability and data-sharing terms require provider-specific contracts.

A future provider adapter may expose quote, create-delivery, status and cancellation operations only after official credentials, Nigerian availability, privacy terms and webhook behavior are verified. The manual handoff remains the fallback for every provider.

## 11. Security and privacy

- Every order, escalation, conversation and configuration lookup is tenant-scoped.
- Customer addresses are never stored in tenant settings, customer memory, metric labels or logs.
- Service-role operations remain server-only; public and authenticated grants are explicit and minimal.
- Any new `SECURITY DEFINER` function is pinned to `search_path=public, pg_temp`, revoked from `PUBLIC`, `anon` and `authenticated`, and granted only to `service_role`.
- Operator APIs continue to require tenant membership and owner/manager/staff authorization.
- Payment confirmation comes only from verified provider evidence or an authorized merchant action.
- Booka never represents itself as the courier or guarantees third-party performance.

## 12. Observability

Aggregate, identifier-free metrics cover:

- fulfilment configuration readiness;
- pre-payment fulfilment handoffs;
- paid orders awaiting fulfilment;
- duplicate escalation prevention;
- time from handoff creation to human claim and release;
- orders released without a confirmed fulfilment context;
- webhook retries caused by handoff persistence failures.

Logs may contain tenant and order identifiers under existing operational policy, but never customer addresses, phone numbers, payment authorization data or courier credentials.

## 13. Testing

Required automated coverage:

- tenant-settings schema accepts valid fulfilment configurations and rejects inconsistent combinations;
- onboarding shows fulfilment only for product-selling/sales-capable tenants and persists it;
- settings can edit the same canonical configuration;
- pickup and known own-dispatch fees proceed without handoff;
- fixed delivery fee is included exactly once before payment-link creation;
- quote-required, third-party and unconfigured paths create one pre-payment handoff and no payment link;
- order and conversation state retain the customer's choice and address without writing a long-term memory fact;
- payment success with unresolved fulfilment produces one paid/unfulfilled order, one escalation, one confirmation and one until-released hold;
- webhook replay duplicates none of those effects;
- public-storefront payment without a thread creates an order-level escalation without fabricating a conversation;
- cross-tenant order/thread combinations are rejected;
- AI processing remains suppressed during an until-released hold and resumes after authorized release;
- existing booking, deposits, wallet top-ups, retail payments and timed human takeover tests remain green.

## 14. Rollout

1. Ship migration 159 and verify RLS, grants, function security and idempotency index.
2. Deploy with `BOOKA_RETAIL_FULFILLMENT_MODE=off`.
3. Configure the controlled pilot tenant through onboarding/settings.
4. Set the global mode to `shadow`, verify decisions without changing payment links or replies, then set `tenants.settings.rollouts.retailFulfillment = 'live'` for the pilot. Tenant `live` is ignored unless the global mode is `shadow` or `live`.
5. Test pickup, manual third-party quote, own-dispatch fixed fee, paid fallback, replay and human release.
6. Review sanitized evidence before broader tenant onboarding.

Disabling the tenant feature flag restores the current retail flow without deleting configuration or order evidence. Open escalations and paid orders remain visible for human resolution.

## 15. Non-goals

- Automatically booking Bolt, inDrive or another courier.
- Live courier price or ETA calculation.
- Courier location tracking.
- A fleet-management product.
- Persisting delivery addresses as reusable customer-memory facts.
- Automatically refunding a paid order merely because delivery remains unresolved.
