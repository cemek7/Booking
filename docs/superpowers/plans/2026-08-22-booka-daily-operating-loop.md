# Booka Daily Operating Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Booka owners a safe, sales-and-booking-focused daily operating objective while preserving the existing dashboard.

**Architecture:** Add a tenant-scoped operational evaluator that derives explainable objectives from existing booking, lead, payment, and message signals. Persist state/action/audit records in Supabase; expose owner-authorized APIs; render the loop as a feature-flagged dashboard module; execute only policy-approved actions through the existing WhatsApp queue.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/Postgres + RLS, Zod, Jest/Testing Library, existing route-handler/auth helpers, existing WhatsApp worker queue.

**Spec:** `docs/superpowers/specs/2026-08-21-booka-daily-operating-loop-design.md`

## Global Constraints

- Booka is a sales and booking front desk: lead response, qualification, recommendations, deposits, conversion, confirmation, recovery, and follow-up are in scope.
- Keep the existing dashboard; ship the loop as an owner-only, tenant-flagged module first.
- Reuse existing queues/jobs; do not add microservices or autonomous policy changes.
- Execute only active owner-approved policies; sensitive, bespoke, high-value, refund, complaint, or out-of-policy work requires approval.
- Every objective/action must be tenant-scoped, explainable, deduplicated, and auditable.

---

## File structure

- `supabase/migrations/042_operating_loop.sql`: tables, constraints, indexes, RLS policies.
- `src/lib/operating-loop/types.ts`: stable objective, policy, action, and view types.
- `src/lib/operating-loop/evaluator.ts`: deterministic candidate derivation, scoring, and primary selection.
- `src/lib/operating-loop/service.ts`: persistence, freshness, policy checks, defer/dismiss/execute orchestration.
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

### Task 3: Policies, persistence, and safe execution

**Files:** Create `service.ts`, `service.test.ts`; modify existing WhatsApp queue adapter only if needed.

**Interfaces:** `getLoop(tenantId)`, `executeObjective({ tenantId, actorId, objectiveId })`, `deferObjective(...)`, `dismissObjective(...)`, `getPolicies(tenantId)`, `replacePolicies(...)`.

- [ ] Write failing tests for stale-objective rejection, tenant mismatch rejection, policy-required execution, dedupe, audit creation, defer scheduling, and immediate automation pause.
- [ ] Run test; expect failure before implementation.
- [ ] Implement service reads/writes using existing Supabase server/admin patterns. Re-check tenant/owner authorization and policy eligibility immediately before queueing.
- [ ] Queue only approved routine confirmation, deposit, and follow-up sends through the existing WhatsApp queue; persist proposed payload and delivery reference in `operating_actions`.
- [ ] Run focused suite plus queue-adapter tests; expect pass. Commit `feat(operating-loop): safely execute approved objectives`.

### Task 4: Owner APIs

**Files:** Create `src/app/api/operating-loop/route.ts`, objective execute/defer/dismiss routes, policy route, and route tests.

- [ ] Write failing route tests for unauthenticated, non-owner, cross-tenant, validation, successful GET, execute, defer, dismiss, and policy update requests.
- [ ] Run tests; expect failure because routes do not exist.
- [ ] Implement routes with `createHttpHandler`, Zod bodies, and the service interfaces from Task 3.
- [ ] Return a compact loop view containing primary objective, supporting signals, state (`setup|active|clear`), and action eligibility/reason.
- [ ] Run route tests, ESLint, and typecheck; expect pass. Commit `feat(operating-loop): add owner operational APIs`.

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
- Type consistency: Task 2 produces drafts consumed by Task 3; Task 3 service is consumed by Task 4 APIs; Task 4 view is consumed by Task 5 UI.
