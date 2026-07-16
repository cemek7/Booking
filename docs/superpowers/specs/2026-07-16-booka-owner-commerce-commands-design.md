# Booka Owner Commerce Commands — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Second sub-project of the "Booka Operational Intelligence" backlog (§1 Natural-Language
Business Operations, commerce coverage). Depends on the Business Ledger & Daily Close spec
(2026-07-15) for `business_events` and reconciliation fields.

---

## 1. Objective

Extend Booka's **existing** owner/staff WhatsApp command pipeline to cover the commerce
domains — products, retail sales, orders, inventory, customers, and richer staff queries —
so owners run operations by message instead of navigating forms. The AI proposes; the
backend validates and executes deterministically. Every action is logged, idempotent, and
capability-gated.

This is **not** a new command system. The spine — LLM proposes an action → deterministic
server-side validation → confirmation for writes → execute — already exists and is reused.

## 2. Current-state findings (grounding)

Verified against `src/` and `db/schema/baseline_2026-07-06.sql`:

- **Owner command pipeline exists**: `src/lib/whatsapp/v2/flows/ownerCommands.ts`
  (`handleOwnerCommand`), fully LLM-driven, with a working write-action **confirmation flow**
  (`pending_action` + `awaiting_confirmation` in `flow_data`).
- **Identity**: `src/lib/whatsapp/v2/identityResolver.ts` maps inbound phone →
  `owner`/`staff`/`customer`/`unknown`. Owner + staff both route to `handleOwnerCommand`
  (no per-action gating today).
- **Validation/execution**: `src/lib/booking/action-validator.ts` — `AIAction` union,
  `AIResponse { action, params, reply, confidence }`, `validateAction`, `executeAction`.
  **1237 lines, single switch.** Existing actions cover services/bookings/staff/quoting/
  catalog/upsell + `create_retail_payment_link`. No operational commerce commands
  (add stock, record sale, refund, restock, mark delivered, etc.).
- **Products** (`public.products`): `stock_quantity`, `cost_price_cents`,
  `low_stock_threshold`, `track_inventory`, `price_cents`. `product_variants` also has
  `stock_quantity`. Stock is a **mutable field today** — no movement ledger.
- **Retail** (migration 120 + ledger spec): `retail_orders` with `status`,
  `payment_status`, `fulfillment_status`, `total_cents`, and (from ledger spec)
  `discount_cents`/`delivery_fee_cents`/`amount_paid_cents`. `cart_id` is **nullable**.
- **Analytics**: `OWNER_COMMAND_USED` event already fires.

## 3. Architecture decisions

### 3.1 Strangler registry, not a big-bang refactor
`action-validator.ts` is 1237 lines on the **live path for both customer and owner AI
flows**. Adding ~20 actions to the switch pushes it past 2000 lines; rewriting existing
actions risks regressions in production booking/payment flows.

**Decision:** introduce a per-domain **action-handler registry**. Each new action is a
self-contained handler:
```ts
interface ActionHandler {
  action: AIAction;
  capability?: Capability;          // gating (§3.3)
  requiresConfirmation: boolean;    // destructive/high-risk
  validate(tenantId, params, ctx): Promise<ValidationResult>;
  execute(tenantId, params, ctx): Promise<ExecResult>;
}
```
Handlers live in domain files: `src/lib/booking/handlers/{commerce,inventory,customers,staff}.ts`.
`validateAction`/`executeAction` become thin dispatchers: **try the registry first, fall
back to the existing switch** for legacy actions. The legacy switch is left untouched.
Migrating old actions into handlers is opportunistic future cleanup, **not** part of this spec.

### 3.2 Retail sales reuse `retail_orders`
"Sold two shirts for ₦30k cash" creates a `retail_order` directly with null `cart_id`,
`payment_status='paid'`, `fulfillment_status='fulfilled'`, `metadata.source='pos'`, and a
linked `transaction` (via the ledger spec's polymorphic `subject_type='retail_order'`).
Chosen over a separate `retail_sales` table so the close-report reconciliation has a
**single path** and the discount/refund/payment-linkage fields aren't duplicated. The
conversational cart→order flow is unchanged; this is the instant-POS entry into the same model.

### 3.3 Minimal capability gating (not full §12)
A per-action `capability` enum: `refund | discount | adjust_stock | delete | manage_staff`.
The dispatcher enforces `hasCapability(role, capability)` server-side before execution.
Default map: owner = all; staff = safe subset (record sale, create booking, add note, read
queries), **not** refund/discount/adjust_stock/delete/manage_staff. Denied attempts emit a
`command.denied` business event. Full tenant-defined permission groups + management UI are
the deferred §12 spec; this table-free map is the precursor.

### 3.4 Minimal inventory movement ledger (not full Phase 3)
Stock changes write an append-only movement row; `products.stock_quantity` becomes a cached
projection updated in the same transaction. Phase 3 grows stock counts / variance /
shrinkage on top. See §5.1.

## 4. New actions

| Domain | Actions |
|---|---|
| Products | `add_product`, `adjust_stock` (signed delta), `set_price`, `set_availability`, `low_stock_query` |
| Retail sales | `record_retail_sale`, `refund_sale`, `record_outstanding_balance` |
| Orders | `create_order`, `set_order_fulfillment` (delivered/pickup), `add_delivery_fee`, `cancel_order_restock` |
| Inventory | `restock`, `record_stock_count`, `record_damage`, `transfer_stock`, `inventory_variance_query` |
| Customers | `lapsed_customers_query`, `add_customer_note`, `customer_history`, `set_customer_tag` |
| Staff extras | `staff_sales_query`, `staff_discount_query`, `set_staff_capability` |

Confirmation-required (destructive/high-risk): `refund_sale`, `cancel_order_restock`,
`record_damage`, `adjust_stock` beyond a threshold, `set_staff_capability`, `set_price`.

## 5. Data model

### 5.1 `inventory_movements` (new, append-only)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| tenant_id | uuid not null | RLS-scoped |
| product_id | uuid not null → products | |
| variant_id | uuid null → product_variants | |
| movement_type | text | purchase \| retail_sale \| service_consumption \| return \| refund_restock \| damage \| expiry \| transfer_in \| transfer_out \| manual_adjustment \| count_adjustment |
| quantity_delta | integer not null | signed (+in / −out) |
| unit_cost_cents | integer null | from products.cost_price_cents, for later loss valuation |
| reason | text null | required for damage / manual_adjustment |
| actor_type | text | user \| staff \| ai \| system |
| actor_id | uuid null | |
| source | text | whatsapp \| dashboard \| api \| system |
| reference_type | text null | e.g. retail_order, transaction |
| reference_id | uuid null | |
| created_at | timestamptz | |

- Append-only (REVOKE UPDATE/DELETE); RLS tenant-scoped.
- Indexes: `(tenant_id, product_id, created_at)`, `(tenant_id, movement_type, created_at)`.
- **Projection**: `products.stock_quantity` updated in the same DB transaction as each
  insert; a reconcile query (`Σ quantity_delta` per product) rebuilds/verifies it.

### 5.2 `ai_action_log` (new)
Satisfies §1 ("log original message, parsed intent, validation result, final action,
actor") and §15 (idempotency). Columns: `id`, `tenant_id`, `actor_type`, `actor_id`,
`channel`, `raw_message`, `action`, `params jsonb`, `idempotency_key` (unique per tenant),
`validation_result jsonb`, `outcome` (executed | rejected | needs_confirmation |
duplicate | denied), `model`, `created_at`. Unique `(tenant_id, idempotency_key)` is the
duplicate guard.

### 5.3 Column additions (backward-compatible)
- `customers`: `tags text[] default '{}'` (for `set_customer_tag`, e.g. wholesale),
  `notes` handling — reconcile with existing notes column during implementation.
- `retail_orders`: `metadata.source` usage (no schema change; jsonb already present).
- `AIResponse` type gains `idempotency_key?: string` and `requires_confirmation?: boolean`
  (currently inferred from an `isWriteAction` list — make it explicit per handler).

## 6. Cross-cutting mechanics

- **Idempotency**: every write action carries an `idempotency_key` (client-provided from the
  inbound message id, else derived from tenant+actor+action+params+time-bucket). Before
  execution the dispatcher checks `ai_action_log`; a hit returns the prior outcome instead
  of re-executing — defends WhatsApp webhook retries (§15).
- **Ambiguity → clarification**: when entity resolution is ambiguous ("the blue dress"
  matches 2 products; unknown customer; multiple staff named Mary), the handler returns a
  focused clarification via the existing `needs_info` path instead of executing.
- **Pidgin / Nigerian English**: extraction prompt carries NG-English/Pidgin examples;
  **word-number and Naira parsing is deterministic in code** ("thirty thousand" →
  `3_000_000` cents), never left to the LLM.
- **Business events**: every executed action emits a `business_events` row (from the ledger
  spec) — `product.stock_adjusted`, `retail_sale.recorded`, `order.refunded`,
  `stock.transferred`, `customer.tagged`, `staff.capability_changed`, `command.denied`, etc.

## 7. Safety & reliability

- Server-side validation on every action; AI never writes directly.
- Confirmation required for destructive actions (§4).
- **DB transactions** for multi-record ops with rollback:
  - `record_retail_sale` → retail_order + retail_order_items + inventory_movements
    (retail_sale, negative) + transaction (paid) + optional outstanding balance.
  - `refund_sale` → refund transaction + inventory_movements (refund_restock, positive) +
    order status update.
  - `cancel_order_restock` → order cancel + inventory_movements (return/restock).
- Capability gating server-side (§3.3); denied → logged.
- Tenant isolation on all reads/writes.
- Deterministic calc (amounts, stock math) outside the LLM.

## 8. Testing

- Per-domain `validate`/`execute` (happy path + invalid IDs/quantities/prices).
- **Idempotent duplicate message** (same key → single execution, prior outcome returned).
- Capability denial (staff attempts refund/adjust_stock/delete → denied + logged).
- `record_retail_sale` atomic rollback (a mid-transaction failure leaves no order/movement/
  payment).
- `refund_sale` → restock movement; `cancel_order_restock` → restock movement.
- Stock projection equals `Σ inventory_movements.quantity_delta`.
- Pidgin / word-number amount parsing.
- Ambiguity clarification (multi-match product/customer/staff).
- `low_stock_query`, `lapsed_customers_query`, `inventory_variance_query` correctness.
- Tenant isolation (RLS) on `inventory_movements`, `ai_action_log`.
- Regression: existing legacy-switch actions unchanged after registry introduction.
- Test types: unit (parsing, capability map), integration (transactions, idempotency,
  detection queries), DB constraint (RLS, append-only), permission (denial).

## 9. Migrations & rollback

- Forward migrations (numbered after the ledger spec's): `inventory_movements` (+ grants/RLS),
  `ai_action_log`, `customers.tags`. Each with a paired `_rollback.sql`.
- `products.stock_quantity` is **not** backfilled into movements historically; the ledger
  starts at rollout and the projection continues from the current value (an opening
  `manual_adjustment` movement per tracked product may seed the baseline — decided at
  implementation). Documented limitation.

## 10. Implementation order (for the plan)

1. Migrations: `inventory_movements`, `ai_action_log`, `customers.tags` (+ rollbacks, RLS).
2. Registry + dispatcher in `action-validator.ts` (registry-first, legacy fallback);
   `AIResponse` gains `idempotency_key`/`requires_confirmation`. Regression tests on legacy.
3. Capability map + server-side gating + `command.denied` events.
4. Idempotency guard via `ai_action_log`; wire `handleOwnerCommand` to log every message.
5. Product handlers.
6. Inventory handlers + movement ledger + stock projection.
7. Retail-sale + refund handlers (reusing `retail_orders`, atomic transactions).
8. Order handlers.
9. Customer + staff-extra handlers.
10. Deterministic Pidgin/Naira parsing helpers + extraction-prompt updates.
11. Docs update.

Ship as small reviewable units; do not land all steps in one change set.
