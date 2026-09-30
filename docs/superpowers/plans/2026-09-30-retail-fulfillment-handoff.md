# Retail Fulfilment and Human Handoff Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use executing-plans task by task, test-driven-development for each behavior change, and verification-before-completion before any completion claim.

**Goal:** Let product-selling tenants configure pickup/delivery, prevent collection of an unresolved delivery-dependent total, and route uncertain or paid-but-unresolved orders to a human without losing context.

**Architecture:** Store a strict policy in tenant settings and a bounded context on each retail order. A central resolver gates payment. Existing Orders, Chats and escalation surfaces handle operator work. Migration 159 adds order-scoped escalation identity and an explicit canonical `until_released` mode. Payment and webhook effects remain server-enforced and idempotent; Bolt/inDrive are manual providers.

**Tech stack:** Next.js 16, React 19, TypeScript, Zod 4, Supabase/PostgreSQL, Jest/Testing Library, Paystack lifecycle abstractions.

---

### Task 1: Model and test deterministic fulfilment decisions

**Files:**
- Create: `src/lib/commerce/retail-fulfillment.ts`
- Create: `src/lib/commerce/retail-fulfillment.test.ts`
- Create: `src/lib/commerce/retail-fulfillment-rollout.ts`
- Create: `src/lib/commerce/retail-fulfillment-rollout.test.ts`

1. Write failing tests for pickup, own dispatch with included/fixed fee, quoted/manual own dispatch, third-party manual, missing/inconsistent settings, confirmed order context, exactly-once fee calculation, and exclusion of addresses from customer memory. Add rollout tests for global `off | shadow | live`, invalid values defaulting to off, tenant opt-in, and tenant live being ignored while global mode is off.
2. Run `npm test -- --runInBand src/lib/commerce/retail-fulfillment.test.ts src/lib/commerce/retail-fulfillment-rollout.test.ts`; expect module-not-found failures.
3. Export strict settings/context Zod schemas and `resolveRetailFulfillment(settings, context)` returning `ready | awaiting_customer | awaiting_human`, a bounded reason code and fee. Add an immutable merge helper for order context. Implement rollout resolution with the safe default `off` so no intermediate commit can activate effects.
4. Re-run both focused tests; expect PASS.
5. Commit: `feat(commerce): model retail fulfillment decisions`.

### Task 2: Validate the canonical tenant setting

**Files:**
- Modify: `src/app/api/tenants/[tenantId]/settings/route.ts`
- Create: `src/__tests__/app/api/tenant-settings-retail-fulfillment.test.ts`

1. Write failing route tests that accept one complete valid nested object and reject unknown methods/providers, provider without third-party method, missing/negative/non-integer fixed fee, oversized areas/note, and cross-tenant access.
2. Run the new test; expect failure because the field is not supported.
3. Reuse `RetailFulfillmentSettingsSchema` in `SettingsSchemaBase`. Preserve the current shallow top-level merge, so clients send the complete nested object.
4. Run the new test plus `src/__tests__/app/api/tenant-settings-business-hours.test.ts`; expect PASS.
5. Commit: `feat(settings): validate retail fulfillment policy`.

### Task 3: Add progressive disclosure to Offerings onboarding

**Files:**
- Create: `src/components/onboarding/RetailFulfillmentFields.tsx`
- Create: `src/components/onboarding/RetailFulfillmentFields.test.tsx`
- Modify: `src/app/auth/onboarding/OnboardingClientPage.tsx`
- Create: `src/__tests__/api/onboarding/retail-fulfillment.test.ts`

1. Write failing tests: booking/enquiry with no valid product hides the card; sales/hybrid or a valid product shows it; third-party reveals provider/manual copy; fixed fee converts naira to integer kobo once; labels/fieldset/keyboard/`aria-live` work; a failed save retains values and blocks Next; success sends the complete object.
2. Run the two new tests; expect FAIL.
3. Add the card after Products inside the existing Offerings step. Reuse current card/input/button language, use touch-friendly new controls, and do not add a top-level step. Save before advancing and preserve local state on error.
4. Run the two tests plus onboarding resume/operating-draft regressions; expect PASS.
5. Commit: `feat(onboarding): capture product fulfillment policy`.

### Task 4: Add the same policy to Business Settings

**Files:**
- Create: `src/components/settings/OrderFulfillmentSection.tsx`
- Create: `src/components/settings/OrderFulfillmentSection.test.tsx`
- Modify: `src/components/settings/SettingsWorkspace.tsx`
- Modify: `src/components/settings/BusinessProfileSection.tsx`
- Modify: `src/components/settings/SettingsWorkspace.test.tsx`

1. Write failing tests for safe `Not configured`, parent-draft updates, existing Save Changes flow, retained edits/error on failure, and absence from Payments.
2. Run the focused settings tests; expect FAIL.
3. Compose the card into Business Settings, reuse the onboarding fields where practical, extend the local settings type, and send the whole nested object. Do not create a second save request or new visual system.
4. Run focused tests; expect PASS.
5. Commit: `feat(settings): manage order fulfillment policy`.

### Task 5: Add migration 159 and a verifier

**Files:**
- Create: `db/migrations/159_retail_fulfillment_handoff.sql`
- Create: `db/releases/2026-09-30-retail-fulfillment-handoff.sql`
- Create: `scripts/sql/verify_retail_fulfillment_handoff.sql`
- Create: `src/__tests__/scripts/retailFulfillmentMigration.test.ts`

1. Write a failing static test for migration/release parity; nullable `escalation_queue.retail_order_id`; allowlisted `reason_code`; the partial tenant/order/reason unique index; nullable `conversation_threads.human_handling_mode` checked to `timed | until_released`; RLS/grant safety; pinned `search_path` for any definer function; and replay-safe guards.
2. Run the new test; expect FAIL.
3. Inspect actual retail-order keys before choosing composite-FK versus function/trigger tenant enforcement. Implement migration and a verifier that returns one readiness row or raises with missing objects. Do not modify migrations 153–158.
4. Run the test and `git diff --check`; expect PASS.
5. Commit: `feat(db): add retail fulfillment handoff schema`.

### Task 6: Make until-released handling explicit

**Files:**
- Modify: `src/lib/whatsapp/v2/humanTakeover.ts`
- Modify: `src/lib/whatsapp/v2/humanTakeover.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/handoffContinuity.test.ts`
- Modify: `src/app/api/tenants/[tenantId]/whatsapp/meta/health/route.ts`

1. Add failing tests proving timed mode is unchanged, until-released is active without a future timestamp, clear resets mode and timestamp, terminal threads reject handoff, and compatibility storage is not authoritative.
2. Run the tests; expect FAIL on new assertions.
3. Extend store reads/writes with `humanHandlingMode`, add `setHumanHandlingUntilReleased`, update `isThreadHumanHandling`, and expose mode in health output. Use compatibility timestamp only for timed mode.
4. Run takeover, continuity and chat-release tests; expect PASS.
5. Commit: `feat(chats): support until-released handoffs`.

### Task 7: Create an idempotent order escalation service

**Files:**
- Create: `src/lib/commerce/retail-fulfillment-escalation.ts`
- Create: `src/lib/commerce/retail-fulfillment-escalation.test.ts`
- Modify: `src/app/api/escalation/route.ts`
- Modify: `src/components/chat/EscalationBanner.tsx`
- Modify: `src/components/chat/EscalationBanner.test.tsx`

1. Write failing tests for tenant/order ownership, optional same-tenant thread, threadless public orders, replay reuse, one stable reason, bounded snapshot without raw history/address, until-released hold when a thread exists, and order-aware banner text/link.
2. Run focused tests; expect FAIL.
3. Implement a server-only order escalation helper. Keep the existing thread handoff strict. Use the partial unique index as the final replay guard. Extend only the escalation GET projection with safe fields; never list delivery addresses.
4. Run focused tests; expect PASS.
5. Commit: `feat(orders): add fulfillment escalation path`.

### Task 8: Enforce fulfilment inside payment-link creation

**Files:**
- Modify: `src/lib/commerce/retail-orders.ts`
- Modify: `src/__tests__/lib/commerce/retail-orders.inventory.test.ts`
- Modify: `src/lib/booking/handlers/commerce.ts`
- Modify: `src/lib/booking/handlers/commerce.test.ts`

1. Write failing tests: pickup/known fixed fee creates or reuses one link; fixed fee changes `delivery_fee_cents`/total once; unconfigured/quoted/third-party creates/reuses a handoff and no link; cross-tenant input fails; rollout off preserves current flow; shadow records a sanitized decision without effects.
2. Run focused tests; expect FAIL.
3. Put one server-side gate inside `createRetailOrderPaymentLink`. Load policy/context rather than trusting UI/model input, include `delivery_fee_cents` in the canonical projection, persist bounded context under one metadata key, and set journey stage `awaiting_fulfillment_handoff` when blocked.
4. Run focused tests; expect PASS.
5. Commit: `feat(payments): gate retail links on fulfillment`.

### Task 9: Add operator confirmation to the existing Orders detail

**Files:**
- Create: `src/app/api/retail/orders/[id]/fulfillment/route.ts`
- Create: `src/__tests__/app/api/retail-order-fulfillment.route.test.ts`
- Modify: `src/components/orders/RetailOrdersWorkspace.tsx`
- Modify: `src/components/orders/RetailOrdersWorkspace.test.tsx`

1. Write failing route tests for tenant authorization, strict method/fee/note validation, exactly-once fee, link reuse, escalation resolution and release only after durable confirmation. Write UI tests for the attention card, human-readable context, disabled conflicting actions, double-submit protection, retained values/error, and mobile wrapping.
2. Run focused tests; expect FAIL.
3. Implement a narrow subresource endpoint and inline order-detail card using existing status/button patterns. The service rechecks tenant/order state, applies fee once, persists confirmed context, creates/reuses a link, resolves escalation and releases the thread. A retry must not add the fee again.
4. Run focused tests; expect PASS.
5. Commit: `feat(orders): resolve fulfillment handoffs`.

### Task 10: Preserve public-storefront address only on the order

**Files:**
- Modify: `src/lib/publicStorefrontService.ts`
- Modify: `src/app/api/public/[slug]/order/route.ts`
- Create: `src/__tests__/lib/publicStorefrontFulfillment.test.ts`

1. Write failing tests: address is trimmed/bounded and stored only in order fulfilment metadata; absent stays null; no verified-memory/customer metadata write; threadless order can be escalated later.
2. Run the new test; expect FAIL because the payload omits address.
3. Extend the payload and route parser. Do not log or copy the address into reusable memory.
4. Run the new test and storefront regressions; expect PASS.
5. Commit: `feat(storefront): retain order delivery context`.

### Task 11: Add the post-payment safety net and replay proof

**Files:**
- Modify: `src/lib/payments/lifecycle.ts`
- Modify: `src/__tests__/lib/payments/lifecycle.retail.test.ts`
- Modify: `src/__tests__/app/api/payments/paystack-webhook.test.ts`

1. Add failing tests proving paid unresolved orders stay paid/unfulfilled, create one escalation, hold one existing thread, send one accurate receipt, and set the handoff journey. A threadless order escalates without a fake chat. Webhook replay duplicates no inventory, ledger/balance, receipt, escalation or hold. Resolved methods keep factual method-specific copy.
2. Run focused lifecycle/webhook tests; expect FAIL.
3. Invoke the shared resolver/escalation after verified payment success, inside existing idempotency boundaries. On handoff persistence failure, return a retryable error without reverting payment truth or decrementing inventory twice.
4. Run lifecycle, webhook and inventory tests; expect PASS.
5. Commit: `feat(payments): hand off unresolved paid orders`.

### Task 12: Surface fulfilment and explicit holds in existing Chats

**Files:**
- Modify: `src/hooks/useChatRealtime.ts`
- Modify: `src/components/chat/ChatsPanel.tsx`
- Modify: `src/components/chat/ChatContextPanel.tsx`
- Modify: `src/components/chat/ChatContextPanel.test.tsx`
- Create: `src/components/chat/ChatsPanel.test.tsx`

1. Write failing tests: until-released is active without timestamp; timed still expires; desktop context shows method/fee/status; mobile main panel shows unresolved handoff; Release clears state; missing context is safe.
2. Run focused tests; expect FAIL.
3. Project canonical `humanHandlingMode` and a bounded fulfilment summary into `ChatSummary`. Reuse current responsive surfaces, claim/release behavior and visual language; do not use a far-future timestamp sentinel.
4. Run chat panel/context/composer tests; expect PASS.
5. Commit: `feat(chats): show fulfillment handoff context`.

### Task 13: Add sanitized observability and environment documentation

**Files:**
- Modify: `src/lib/commerce/retail-fulfillment-rollout.ts`
- Modify: `src/lib/commerce/retail-fulfillment-rollout.test.ts`
- Modify: `.env.example`
- Modify: `src/lib/commerce/retail-orders.ts`
- Modify: `src/lib/payments/lifecycle.ts`

1. Extend the rollout tests first to prove shadow causes no customer/order mutation and telemetry excludes address, phone, free text and payment data.
2. Run the extended test; expect FAIL on the new observability assertions.
3. Document the environment variable and integrate sanitized metrics. Shadow may calculate and emit only fixed allowlisted reason/status/provider labels; it cannot block links, create handoffs or message customers.
4. Run rollout and domain tests; expect PASS.
5. Commit: `feat(commerce): gate fulfillment rollout`.

### Task 14: Full self-review and staging handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-retail-fulfillment-handoff-design.md`
- Create: `docs/runbooks/retail-fulfillment-pilot.md`

1. Run every introduced/modified test file with `--runInBand`, then `npm run typecheck:ci` and `git diff --check`.
2. Re-run booking, deposit, wallet, retail payment, inventory, timed takeover, continuity, Orders, Settings, escalation and chat regressions. No feature completion claim is allowed with failures.
3. Review the real UI at desktop and mobile widths: progressive disclosure, settings save/error, Orders attention/confirmation, desktop chat context and mobile notice. Check keyboard/focus, labels, contrast, 44px targets, long-address wrapping, loading/disabled behavior and no page jump.
4. Search the diff for address/phone/token logging, unscoped mutations, broad grants, model exposure of unrelated order data and client-only payment gates; resolve every finding.
5. Write the pilot runbook with migration/verifier order, flags, tenant opt-in, pickup/fixed/manual/paid-replay cases, expected server evidence, rollback, and confirmation that no Bolt/inDrive API is called.
6. Mark the design implemented and commit: `docs: add retail fulfillment pilot runbook`.

**Deployment gate:** Do not run migration 159 or enable this in production from the implementation session. Merge to staging, run the release SQL and verifier there, deploy global `shadow`, inspect sanitized decisions, opt in only the pilot tenant, then execute payment/replay/handoff smoke tests with UTC timestamps and server-side ledger evidence.
