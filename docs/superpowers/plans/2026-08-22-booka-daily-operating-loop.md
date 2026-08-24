# Booka Daily Operating Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Booka owners a safe, sales-and-booking-focused daily operating objective while preserving the existing dashboard.

**Architecture:** Add a tenant-scoped operational evaluator that derives explainable objectives from existing booking, lead, payment, and message signals. Persist state/action/audit records in Supabase; expose owner-authorized APIs; render the loop as a feature-flagged dashboard module. Owner execution atomically writes an action and a direction-specific operating-delivery outbox; a dedicated worker sends it only through the governed WhatsApp sender, never through the inbound WhatsApp queue.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres + RLS, Zod, Jest/Testing Library, existing route-handler/auth helpers, governed WhatsApp sender, and VPS cron.

**Spec:** `docs/superpowers/specs/2026-08-21-booka-daily-operating-loop-design.md`

## Global Constraints

- Booka is a sales and booking front desk: lead response, qualification, recommendations, deposits, conversion, confirmation, recovery, and follow-up are in scope.
- Keep the existing dashboard; ship the loop as an owner-only, tenant-flagged module first.
- Reuse existing delivery governance and cron infrastructure; do not add microservices, reuse the inbound WhatsApp queue for outbound work, or permit autonomous policy changes.
- Execute only active owner-approved policies; sensitive, bespoke, high-value, refund, complaint, or out-of-policy work requires approval.
- Every objective/action must be tenant-scoped, explainable, deduplicated, and auditable.

---

## File structure

- `supabase/migrations/042_operating_loop.sql`: original tenant-scoped tables, constraints, indexes, and RLS policies.
- `supabase/migrations/043_operating_loop_delivery_safety.sql`: durable controls, suppression, atomic action/outbox RPCs, and RLS.
- `supabase/migrations/044_operating_loop_delivery_worker.sql`: atomic claim/reconciliation RPCs for the dedicated operating outbox.
- `src/lib/operating-loop/types.ts`: stable objective, source-fingerprint, policy, action, and view types.
- `src/lib/operating-loop/evaluator.ts`: deterministic candidate derivation, scoring, and primary selection.
- `src/lib/operating-loop/service.ts`: persistence, validated policy/proposal construction, and defer/dismiss/execute orchestration.
- `src/lib/operating-loop/delivery-worker.ts`: claimed operating-outbox dispatch through `sendGovernedInitiated`.
- `src/app/api/worker/operating-loop/route.ts`: cron-protected operating-delivery worker entrypoint.
- `src/app/api/operating-loop/**/route.ts`: owner-authorized read and mutation contracts.
- `src/components/dashboard/DailyOperatingLoop.tsx`: focused primary-objective module.
- `src/app/dashboard/page.tsx`: feature-flagged owner placement without removing current dashboard content.
- `src/lib/onboarding/operating-draft.ts` and `src/app/api/onboarding/operating-draft/route.ts`: conversational onboarding draft/evidence state.

### Task 1: Database foundation and tenant isolation

**Files:** Create migration `042_operating_loop.sql`; test with migration/schema checks.

- [ ] Write schema assertions for `operating_loop_state`, `operating_objectives`, `operating_actions`, `automation_policies`, and `onboarding_evidence`, including tenant indexes and owner-only RLS mutation policies.
- [ ] Run the schema test against local Supabase; expect failure because the tables do not exist.
- [ ] Create tables with UUID primary keys, `tenant_id`, timestamps, JSON evidence/payload, status check constraints, and unique dedupe key `(tenant_id, dedupe_key)` for active objectives.
- [ ] Add RLS: tenant members may read their tenant; only `owner` may mutate policies/actions; service role retains worker access.
- [ ] Re-run migration/schema tests; expect pass. Commit `feat(operating-loop): add tenant-scoped operational records`.

### Task 2: Deterministic evaluator

**Files:** Create `types.ts`, `evaluator.ts`, `evaluator.test.ts`.

**Interfaces:** `evaluateOperatingObjectives(input: OperatingSignals, now: Date): OperatingObjectiveDraft[]`; `selectPrimaryObjective(candidates): OperatingObjectiveDraft | null`.

- [ ] Write failing tests proving: unanswered current enquiry outranks revenue risk; an imminent unconfirmed booking outranks ordinary follow-up; abandoned high-intent lead produces a sales-recovery objective; expired/dismissed candidates are excluded.
- [ ] Run focused Jest test; expect missing module/function failure.
- [ ] Implement explicit score factors (`customerUrgency`, `revenueRisk`, `growthValue`, `deadline`) and objective kinds `reply_to_lead`, `qualify_lead`, `recover_lead`, `collect_deposit`, `confirm_booking`, `recover_booking`, `follow_up`.
- [ ] Include `evidence`, `affectedRecordIds`, `amountAtRisk`, `expiresAt`, and deterministic `dedupeKey` in every draft.
- [ ] Run focused tests and TypeScript check; expect pass. Commit `feat(operating-loop): derive prioritized sales objectives`.

### Task 3: Policies, persistence, and safe execution — superseded

The original Task 3 implementation is intentionally not accepted. Its use of `whatsapp_message_queue` sends a proposed outbound action into the inbound `processMessageV2` worker. No later task may consume that implementation.

### Task 3R-A: Atomic controls, action audit, and durable outbox

**Files:** Create `043_operating_loop_delivery_safety.sql` and migration integration tests; modify `types.ts`, `service.ts`, and `service.test.ts`.

**Interfaces:** `queueOperatingDelivery(p_tenant_id UUID, p_actor_id UUID, p_objective_id UUID, p_policy_id UUID, p_payload JSONB, p_idempotency_key TEXT) -> { action_id UUID, outbox_id UUID }`; `replaceOperatingPolicies(...)`; `applyOperatingSuppression(...)`. Service methods remain `getLoop`, `executeObjective`, `deferObjective`, `dismissObjective`, `getPolicies`, `replacePolicies`, and `persistObjectiveDrafts`.

- [ ] Write failing migration/service tests proving that one RPC transaction rejects stale, cross-tenant, paused, revoked, invalid-policy, and duplicate execution; otherwise it creates one action and one `operating_delivery_outbox` row with the exact intended recipient/payload/idempotency key.
- [ ] Run the migration integration and focused service tests; expect the new RPC/tables and service seam to be absent.
- [ ] Add `operating_loop_settings`, `operating_objective_suppressions`, and `operating_delivery_outbox`. Add a deterministic `sourceFingerprint` to every draft/objective, tenant-aware foreign keys, restrictive RLS/grants, bounded retry fields, a unique `(tenant_id, idempotency_key)`, and composite action references. Add SECURITY DEFINER RPCs with a fixed `search_path` that atomically verify actor ownership, objective status/expiry, policy active/approved/action type, and durable pause before changing records.
- [ ] Make the service validate policy JSON fail-closed (recognized `maxAmountAtRisk`, optional IANA quiet-hours timezone, and no unknown executable fields), build a proposal from the tenant objective, and call the transaction RPC. It must not import or call `queueWhatsAppMessage`.
- [ ] Persist defer as a suppression until `scheduled_for`; persist dismissal for the same `dedupeKey` and `sourceFingerprint` only. Make evaluator persistence skip matching active suppressions so a material source change can re-open the work. Replace policies and durable pause in one RPC transaction so no old active policy becomes visible during replacement.
- [ ] Run migration integration, focused service/evaluator tests, typecheck, lint, and `git diff --check`; expect pass. Commit `fix(operating-loop): atomically queue governed deliveries`.

### Task 3R-B: Governed delivery worker and reconciliation

**Files:** Create `src/lib/operating-loop/delivery-worker.ts`, `delivery-worker.test.ts`, `src/app/api/worker/operating-loop/route.ts`, and route tests; modify VPS cron documentation/configuration only if a matching protected schedule is absent.

**Interfaces:** `runOperatingDeliveryBatch({ admin, limit, now }): Promise<{ claimed: number; sent: number; held: number; failed: number }>`; `claimOperatingDeliveries(p_limit INTEGER)` and `completeOperatingDelivery(...)` RPCs.

- [x] Write failing tests proving the worker claims only due operating-outbox rows once; sends to `recipient` rather than any inbound `from_number`; uses `sendGovernedInitiated`; preserves service-window, consent, opt-out, template, number-quality, and send-governor blocks as a held audit outcome; and records provider message ID/attempt outcome without falsely completing the objective.
- [x] Run focused tests; observe the expected missing worker/module/RPC failures.
- [x] Implement a cron-protected worker that claims with `FOR UPDATE SKIP LOCKED` via RPC, loads the recipient conversation, tenant provider, branding, and sends through `sendGovernedInitiated`. The provider interface does not expose an idempotency argument, so the deterministic outbox key is retained for audit/reconciliation and ambiguous provider outcomes are held rather than retried.
- [x] Atomically reconcile sent, held, retry, and dead-letter outcomes to both outbox and action audit. Only a provider-ID-confirmed send marks its objective completed; missing providers retry with bounded backoff while ambiguous sends are held.
- [x] Add the protected GET schedule to `deployment/vps-crontab.txt` using `Authorization: Bearer $CRON_SECRET`; verify its route rejects missing/wrong bearer tokens and do not create a public worker endpoint.
- [x] Run worker/governed-sender/route tests, typecheck, lint, database schema/RLS/concurrency harnesses, and `git diff --check`; commit `feat(operating-loop): deliver approved actions through governed sender`.

### Task 4: Owner APIs

**Files:** Create `src/app/api/operating-loop/route.ts`, objective execute/defer/dismiss routes, policy route, and route tests.

- [x] Write failing route tests for validation, successful GET, execute, defer, dismiss, policy update, tenant scoping, and owner-only route registration. Framework-level unauthenticated/non-owner enforcement remains provided by `createHttpHandler` with `auth: true, roles: ['owner']`.
- [x] Run tests; observe the expected missing-route failure.
- [x] Implement routes with `createHttpHandler`, strict Zod bodies, and the corrected service interfaces from Task 3R-A/B.
- [x] Return the compact loop view supplied by the service, containing primary objective, supporting signals, state (`setup|active|clear`), and automation pause.
- [x] Run route tests, ESLint, scoped typecheck, and `git diff --check`; commit `feat(operating-loop): add owner operational APIs`.

### Task 5: Dashboard module and feature flag

**Files:** Create `DailyOperatingLoop.tsx` and component tests; modify `src/app/dashboard/page.tsx`; add tenant flag storage/read path.

- [ ] Write failing component tests: one primary objective, three-or-fewer supporting signals, clear state, disabled unsafe action, defer/dismiss interactions, and no rendering for flag-off/non-owner tenants.
- [ ] Run component tests; expect missing component failure.
- [ ] Implement accessible module copy: “Today’s Front Desk”, primary explanation/evidence summary, **Let Booka handle it**, **Remind me later**, and **Not relevant**. Do not remove KPIs, links, or dashboard sections.
- [ ] Wire owner dashboard placement behind `daily_operating_loop_enabled`; use the new API and invalidate/refetch after actions.
- [ ] Run component/API integration tests, lint, and typecheck; expect pass. Commit `feat(dashboard): add daily operating loop module`.

### Task 6: Conversational onboarding draft

**Files:** Create `operating-draft.ts`, onboarding draft routes/tests; modify onboarding UI only where it can present a conversational next question and approval summary.

- [ ] Write failing tests for evidence-backed draft fields, plain-language answer recording, skipped questions, explicit approval requirement, and launch-readiness calculation.
- [ ] Run tests; expect missing module/route failure.
- [ ] Implement draft state backed by `onboarding_evidence`; accept source references and owner answers, but keep extraction/investigation asynchronous and draft-only.
- [ ] Render one conversational next question plus readiness progress; show final operating summary before enabling policies or launch state.
- [ ] Run onboarding tests, typecheck, and lint; expect pass. Commit `feat(onboarding): add conversational front-desk setup`.

### Task 7: Observability, acceptance, and rollout controls

**Files:** Create evaluator/service integration tests; modify analytics event registry and tenant settings/feature flag admin surface as needed; update documentation.

- [ ] Write failing end-to-end service tests for: setup objective; safe automatic confirmation; sensitive action requiring approval; clear state reopening on urgent lead; audit/dedupe; feature-flag-off behavior.
- [ ] Run test suite; expect failure before instrumentation/rollout hooks.
- [ ] Emit tenant-safe events for objective shown/completed/deferred/dismissed, execution outcome, and onboarding readiness; expose feature flag only to authorized tenant/admin controls.
- [ ] Add runbook documentation for policy pause, objective diagnosis, queue failure, and rollback (disable flag; no data deletion).
- [ ] Run targeted tests, full CI test command, ESLint, typecheck, migration validation, and `git diff --check`; expect all pass. Commit `test(operating-loop): cover rollout and safety controls`.

## Self-review

- Spec coverage: Tasks 1–7 cover onboarding, sales/booking objectives, owner-only controls, policies, dashboard preservation, rollout, observability, and acceptance criteria.
- Placeholder scan: no TBD/TODO or undefined cross-task interfaces.
- Type consistency: Task 2 produces drafts consumed by Task 3R-A; Task 3R-A creates durable outbox records consumed by Task 3R-B; corrected Task 3 service is consumed by Task 4 APIs; Task 4 view is consumed by Task 5 UI.
