# Retail Fulfilment Pilot Runbook

**Scope:** Controlled Booka pilot for pickup, business dispatch, and manually arranged third-party delivery.

**Safety rule:** Bolt, inDrive, and `other` are labels for a tenant or human operator to arrange manually. This release makes no courier API call, does not book a rider, and must not promise courier availability, price, or ETA.

## 1. Release order

1. Confirm the candidate application commit and immutable image.
2. If the target database has not already passed the continuity gate, run `db/releases/2026-09-30-conversation-continuity-all-in-one.sql` in the Supabase SQL editor.
3. Run `db/releases/2026-09-30-retail-fulfillment-handoff.sql` in the Supabase SQL editor.
4. Run the read-only verifier `scripts/sql/verify_retail_fulfillment_handoff.sql` if an independent recheck is needed.
5. Require the final readiness row:

   ```text
   retail_fulfillment_handoff_schema_ready
   ```

6. Deploy the matching application image with the global feature mode still `off` or `shadow`.
7. Validate `/api/version`, `/api/health`, `/api/ready`, startup logs, and database validation before selecting a pilot tenant.

The release SQL is additive and replay-safe. Do not replay or replace older migrations merely because their numbers differ from a local checkout. The user has already confirmed both the conversation-continuity and retail-fulfilment readiness rows for the current database; no additional migration is required for that database unless the schema changes again.

## 2. Feature flags and tenant opt-in

Global runtime flag:

```dotenv
BOOKA_RETAIL_FULFILLMENT_MODE=off
```

Allowed values:

- `off`: no evaluation, persistence, handoff, or customer message caused by this feature.
- `shadow`: evaluate and emit sanitized decision telemetry, but do not mutate fulfilment state, pause AI, or send a fulfilment message.
- `live`: still behaves as shadow for every tenant except an explicitly selected tenant.

Select one controlled pilot tenant by setting both of these in its canonical settings:

```json
{
  "rollouts": {
    "retailFulfillment": "live"
  },
  "retailFulfillment": {
    "methods": ["customer_pickup", "own_dispatch", "third_party_manual"],
    "thirdPartyProviders": ["bolt", "indrive", "other"],
    "serviceAreas": ["Lekki", "Victoria Island"],
    "feePolicy": "quote_required",
    "customerNotice": "Delivery timing and the final fee are confirmed in chat."
  }
}
```

Use the authenticated Settings or onboarding flow so the server validates the complete nested object. Do not patch fragments directly into `tenants.settings`; preserve unrelated keys. Set the global flag to `live` only after confirming the selected tenant configuration.

## 3. Pre-smoke gate

For the pilot tenant, verify:

- an owner or manager can sign in and open Settings, Orders, Chats, and escalations;
- at least one active, in-stock product has an integer NGN price;
- the chosen fulfilment policy is visible after saving and reloading;
- WhatsApp or Instagram is tenant-mapped if the smoke test starts from a channel;
- Paystack is configured for the tenant if payment is in scope;
- the conversation has a canonical tenant-scoped thread so Booka can pause and release AI;
- baseline order, transaction, escalation, message, and inventory counts are recorded.

Never paste access tokens, customer addresses, phone numbers, reusable-card authorization codes, or webhook payloads into logs or the handoff report.

## 4. Controlled cases

### A. Customer pickup

1. Create an order and choose customer pickup.
2. Generate the payment link.
3. Verify the server records zero delivery fee once and does not create a fulfilment escalation.
4. Complete payment once and replay the same signed webhook once.
5. Verify one payment transition, one inventory effect, one customer receipt, and no duplicate ledger or order effect.

### B. Business dispatch with fixed or included fee

1. Configure `own_dispatch` with `included` or one fixed fee.
2. Supply an order-scoped delivery address.
3. Generate the payment link.
4. Verify the final total is `subtotal + delivery fee - discount` exactly once and the payment metadata stores that amount.
5. Verify no address is copied to customer memory or emitted in telemetry.

### C. Manual Bolt, inDrive, or other provider

1. Choose `third_party_manual`, a provider, and an order-scoped address.
2. Attempt to continue to payment while the arrangement or fee is unresolved.
3. Verify Booka blocks server-side payment-link creation, creates one pending `retail_fulfillment` escalation, changes the journey to `awaiting_fulfillment_handoff`, and sets the canonical conversation to `until_released`.
4. In Orders, confirm the provider, final fee, and an optional bounded operator note.
5. Verify the escalation resolves, the canonical conversation is released, and one current payment link is returned for an unpaid order.

### D. Payment arrives before fulfilment is resolved

1. Use a legitimate signed provider event for an existing retail transaction whose fulfilment remains unresolved.
2. Verify the order stays `paid` and `unfulfilled`; never cancel it or create a second charge.
3. Verify one fulfilment escalation and one explicit-until-release hold.
4. Verify the customer receives a factual receipt stating that payment is confirmed and a teammate is arranging delivery.
5. Confirm the delivery in Orders. A paid order must not create a new payment link.
6. Replay the same webhook and verify no second transaction, inventory decrement, ledger effect, escalation, message, or balance change.

## 5. Expected server-side evidence

Capture identifiers and counts in the restricted staging handoff, redacting customer data:

- application commit/image plus healthy and ready responses;
- verifier readiness row;
- effective global mode and the selected tenant's rollout state;
- retail order status, payment status, fulfilment status, subtotal, delivery fee, total, and safe fulfilment state;
- exactly one matching `escalation_queue` row per tenant/order/reason;
- canonical conversation status and `human_handling_mode=until_released` before operator confirmation, then cleared after explicit release;
- transaction and ledger counts before/after payment;
- inventory count changed once after the first valid success event;
- webhook replay returned success/replay semantics without repeating business effects;
- reusable-card handling remains whatever the payment lifecycle recorded from verified provider data; this feature neither fabricates nor logs authorization details;
- sanitized telemetry labels only: `mode`, `surface`, `status`, `reason`, and `provider`.

Delivery address and operator notes may exist on the tenant-scoped order for operations. They must not appear in customer memory, AI/chat summary projections, metrics, or ordinary logs.

## 6. Rollback

1. Set `BOOKA_RETAIL_FULFILLMENT_MODE=off` and redeploy/restart the same release configuration. This immediately stops new feature decisions and side effects.
2. If application rollback is required, pin the previously verified immutable image and run the normal health/readiness/database gates.
3. Do not drop migration 159 columns, indexes, constraints, or recorded fulfilment context during an incident. They are additive and older application code can ignore them.
4. Do not bulk-release active conversations. Review pending `retail_fulfillment` escalations and paid/unfulfilled orders tenant by tenant, arrange delivery manually, then release each conversation explicitly.
5. Preserve payment, ledger, inventory, webhook, and escalation evidence for reconciliation.

## 7. Go/no-go

The pilot is a go only when all four controlled cases pass, webhook replay is idempotent, no customer must repeat their delivery facts, and a human can take over and explicitly release the conversation. Any duplicate financial effect, cross-tenant result, unbounded log data, invented courier promise, or AI reply during an active fulfilment hold is a release blocker.
