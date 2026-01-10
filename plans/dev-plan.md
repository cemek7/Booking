# Booka — Detailed Development Plan (Approved)

Version: 1.1
Date: 2025-11-04
Owner: TechClave Engineering

This `dev-plan.md` contains the approved, actionable development plan derived from `plan.md` v1.1 and the repository scan. It is intended to be the single source of truth for implementation tasks, priorities, and verification steps. Do not modify without creating a PR and linking to the related sprint card.

## Goals
- Deliver the Beauty-first MVP: core booking engine, messaging adapters (WhatsApp/Evolution), payments (Paystack/Stripe sandbox), dialog manager (slot-fill FSM), worker queue for reminders and LLM reservation processing, and admin console for tenant settings and LLM metering.

## Minimal contract for implementation
- Inputs: current repo source, migrations, `plan.md` v1.1, and approved dev-plan here.
- Outputs: code changes per-scope, migrations, and manual verification steps. CI must pass typecheck (`npx tsc --noEmit`) and linting before merging.

---

## Scopes and per-scope TODOs (actionable)

Scope A — Core Booking Engine & Reservations (priority: high)
- Tasks:
  1. Audit reservation endpoints and components for correct Supabase factory usage (no module-level client).
     - Files: `src/pages/api/reservations/*`, relevant `src/app/*` pages.
  2. Add Zod schemas for reservation payloads and wire validation in API handlers.
  3. Add DB transaction/constraint for double-book prevention (migration if needed).
  4. Add manual Postman verification plan (create → fetch → cancel flows).

Scope B — Messaging Adapters & Webhooks (priority: high)
- Tasks:
  1. Move webhook utilities into `src/lib/webhooks.ts` (helpers: `readRawBody`, `verifyHmac`, `normalizePayload`).
  2. Standardize Evolution webhook implementation to use new helpers and persist inbound `messages` rows with metadata.
  3. Harden additional adapters (if used) with provider-specific signature verification and durable persistence.
  4. Ensure webhooks enqueue background jobs for heavy LLM work instead of doing LLM calls synchronously.
  5. Postman checks: sample signed payloads, and verify `messages` store and job row creation.

Scope C — Payments (Stripe, Paystack) (priority: high)
- Tasks:
  1. Implement proper signature verification using vendor SDKs (Stripe CLI locally) and persist `payment_events` with dedupe by event id.
  2. Map payment events to internal `transactions` and finalize booking deposits on success.
  3. Admin reconcile endpoints for manual correction.
  4. Postman/Stripe CLI test flows for webhook verification and reconciliation.

Scope D — Dialog Manager & Conversation State (priority: high)
- Tasks:
  1. Implement `src/lib/dialogManager.ts` with a small slot-fill FSM API: `startSession`, `getSession`, `updateSlot`, `nextStep`, `endSession`.
  2. Implement a session store backed by Redis (recommended) with a Postgres fallback, and add `REDIS_URL` to env checklist.
  3. Integrate dialog manager with messaging webhook flows to create/update sessions.
  4. Manual test: step through multi-turn booking via Postman or simulated messages.

Scope E — Workers, Job Queue, Reminders, LLM Processing (priority: high)
- Tasks:
  1. Create a `jobs` table (migration) with columns: `id, type, payload jsonb, attempts, status, scheduled_at, last_error`.
  2. Implement `src/lib/workerRunner.ts` that polls `jobs` and dispatches to job handlers via `tinypool` or an alternative worker runtime.
  3. Ensure `dist/worker.js` exports the expected handler shape (named `handler`) if tinypool dynamic import is used in runtime.
  4. Add retries, exponential backoff, and a dead-letter queue for failed jobs.
  5. Implement reminder scheduler that enqueues reminder jobs; add endpoint `src/pages/api/reminders/trigger.ts` for manual triggers.

  Scope E-1 — LLM Context Manager (small, server-side)
  - Tasks:
    1. Add `src/lib/llmContextManager.ts` which returns tenant LLM settings and the last N messages for a tenant. It must accept a server-side Supabase/Postgres client and return a compact context object.
    2. Wire the context-manager into the LLM adapter so that every premium LLM call receives tenant-scoped settings + recent conversation history when constructing prompts.
    3. Enforce size limits and implement simple PII-safety truncation (strip or redact very large message bodies before sending to LLM).
    4. Document the context-manager usage in `README.md`, `PRD.md`, and `plan.md` and add a short runbook for developers.

  Rationale: providing tenant-scoped recent messages and LLM settings avoids stateless prompts that miss tenant context and centralizes retention and PII rules. Implement this before broad LLM integration so adapters can rely on a single source of truth.

Scope F — Admin UI & Tenant Settings (priority: medium)
- Tasks:
  1. Verify and complete `TenantSettings` UI to persist `preferred_llm_model` and `llm_token_rate` to `tenant_settings`.
  2. Expose LLM usage dashboard via `src/pages/api/admin/llm-usage.ts` and a simple table in admin UI.
  3. Manual verification: change tenant LLM settings and confirm `llm_calls` records reflect model and token counts.

Scope G — Tests, CI, and Cleanup (deferred for now per user request)
- Tasks (deferred):
  1. Remove leftover Jest artifacts and consolidate tests under Vitest.
  2. Clean `src/pages/api/webhooks/__tests__/evolution.test.ts` to use Vitest only.
  3. Validate `vitest.config.ts` mapping for `tinypool` and `dist/worker.js` stub shape.

Scope H — Security, Secrets, and Deployment (priority: high)
- Tasks:
  1. Audit code for accidental exposure of Supabase service role key; ensure all server-only code uses `createServerSupabaseClient`.
  2. Ensure provider secrets (Evolution HMAC secret, Stripe webhook secret, Paystack secret) are only in env and not committed.
  3. Add runtime guards that return 503 with actionable messages when a required secret is missing.
  4. Create a deployment checklist for staging: envs, applying migrations, worker process, and scheduled jobs.

---

## Verification / Manual test checklist (Postman-focused)
- Webhooks:
  - Send signed Evolution webhook sample -> confirm `messages` persisted and response 200.
  - Confirm background job row enqueued (no LLM call in webhook sync path).
- Payments:
  - Use Stripe CLI to send signed events to `src/pages/api/payments/stripe.ts` and confirm event persistence and transaction reconciliation.
- Dialog flow:
  - Simulate multi-turn booking messages, verify session state transitions and final booking row.

## Next steps (immediate)
1. Implement Scope B helpers (`src/lib/webhooks.ts`) and stabilize `src/pages/api/webhooks/evolution.ts` to call the helpers.
2. Create the `jobs` table migration and basic `workerRunner` scaffolding (Scope E) to avoid blocking LLM work on webhook requests.
3. Wire React Query and Zustand in the app (you approved adding dependencies) — create `src/lib/queryClient.ts` and a small store `src/lib/store.ts` (I can add these next if you'd like).

## Change log
- v1.1-approval (2025-11-04): Dev plan approved by user and written to `dev-plan.md`.

---

Generated and written on 2025-11-04.
