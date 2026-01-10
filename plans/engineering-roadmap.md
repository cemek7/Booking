# Booka — Engineering Roadmap

Version: 1.0
Date: 2025-11-03
Owner: TechClave Engineering

Purpose
-------
A developer-facing engineering roadmap derived from the PRD. This file is the single source-of-truth for implementation sequencing, epics, sprint backlog, acceptance criteria, and immediate dev tasks to deliver the Beauty-first MVP and provide a repeatable path to Hospitality and Medicine modules.

How to use
---------
- Follow Epics → Milestones → Sprint stories. Keep scope tight for pilot.
- Make small PRs, include tests and types. Run `npx tsc --noEmit` before opening PRs.
- Track progress in the repo's issue tracker and link PRs to epic cards.

Top-level objectives
-------------------
1. Deliver Beauty vertical MVP: conversational booking via WhatsApp, deposits, reminders, admin console and LLM cost controls.
2. Instrument per-tenant metrics (bookings, deposits, LLM tokens, no-shows) and hit pilot KPIs.
3. Keep core modular and multi-tenant so modules can be installed per-tenant.

Success criteria (developer measurable)
---------------------------------------
- E2E booking flow tests pass: incoming message -> dialog manager -> booking row created -> confirmation sent.
- LLM metering implemented with per-tenant quotas and alerts.
- Pilot instrumentation dashboard shows bookings and deposits for first 10 merchants.

High-level epics
---------------
1. Core Data & Auth
2. Booking Engine & Conflict Resolution
3. Messaging Adapter (WhatsApp primary) + Webhooks
4. Payments Adapter (deposits + webhooks)
5. Dialog Manager & Freemium AI (paraphraser + retrieval)
6. Worker Queue (reminders, retries, reconciliation)
7. Admin Console & Observability
8. Vertical Modules (Beauty → Hospitality → Medicine)

Milestones & recommended sprint mapping (2-week sprints)
--------------------------------------------------------
- Sprint 0 (Prep): repo skeleton, CI, env.example, dev on-boarding.
- Sprint 1: Core Data & Messaging webhook (tenants/users/reservations/messages)
- Sprint 2: Payments + Beauty module bootstrap + dialog manager basics
- Sprint 3: Realtime + worker queue + LLM basics (metering & quotas)
- Sprint 4: Stabilize booking flows and admin console features
- Sprint 5: Pilot readiness (E2E tests, onboarding scripts)
- Sprint 6: Pilot launch and monitoring

Detailed epic -> stories (first 6 sprints)
-----------------------------------------
Epic A — Core Data & Auth (Sprint 1)
- Story A1: Create Postgres schema migrations (tenants, users, reservations, messages, transactions, reservation_logs, templates).
  - Deliverable: SQL migration files + seed script for sample tenant and services.
  - Acceptance: `npx prisma migrate` or migration runner applies cleanly in CI.
- Story A2: Implement multi-tenant auth patterns (RLS policies + JWT flow) and Magic Link signup.
  - Deliverable: RLS policy SQL + Magic Link auth flow working locally.
- Story A3: Add minimal tenant settings API and tenant creation endpoint.

Epic B — Messaging Adapter + Webhooks (Sprint 1)
- Story B1: Implement incoming webhook endpoint (Edge Function or API route) for Evolution/WhatsApp.
  - Deliverable: `/api/webhooks/evolution` receives messages, validates signature, persists to `messages`.
  - Acceptance: unit tests for signature verification + sample request recorded.
- Story B2: Messaging provider abstraction interface + default Evolution adapter.

Epic C — Payments & Deposits (Sprint 2)
- Story C1: Payments adapter (Paystack + Stripe sandbox) basic flows and webhook handlers.
  - Deliverable: `/api/payments/webhook` verifies and updates `transactions` and `reservations` statuses.
- Story C2: Deposit flow: create payment link flow and attach payment intent to booking.

Epic D — Beauty Module Bootstrap (Sprint 2)
- Story D1: Module manifest schema, sample templates, and intake JSON-schema.
- Story D2: Install manifest API and sample seed for Beauty module.

Epic E — Dialog Manager & Freemium AI (Sprint 2-3)
- Story E1: Implement slot-fill FSM runtime, session persistence (Redis), and idempotency keys.
- Story E2: Paraphraser + retrieval layer integration for freemium responses; local classifier for intent.
- Story E3: LLM adapter to OpenRouter with quota checks: decrement tenant budget and fallback behavior.

Epic F — Worker Queue & Reminders (Sprint 3)
- Story F1: Implement Redis-backed worker queue (Bull or similar) and an initial reminder job.
- Story F2: Add retry/backoff policy and admin-visible job logs.

Epic G — Realtime Dashboard & Admin Console (Sprint 3-4)
- Story G1: Reservations list/calendar with realtime updates (Supabase Realtime or sockets).
- Story G2: Admin console: tenant settings, module install, LLM usage meter and billing metadata.

Epic H — Testing, Instrumentation, and Pilot (Sprint 5)
- Story H1: E2E tests for booking flow including mocked messaging and payments.
- Story H2: Instrumentation dashboard (Prometheus/Grafana or simple UI) showing bookings, deposits, no-shows, LLM tokens.
- Story H3: Pilot onboarding scripts and concierge checklist.

Verticals roadmap (post-core)
-----------------------------
- Beauty (first): intake forms, stylist routing, upsell templates, loyalty features.
- Hospitality: PMS sync, room/table allocation, group booking flows.
- Medicine: scheduling-only pilot; plan isolated tenancy for sensitive workflows later.

Infrastructure & operational tasks
---------------------------------
- Containerization: Dockerfiles for API and workers.
- CI: lint, typecheck, unit tests, migrations apply check.
- Secrets: document `env.example` and recommended store (GitHub Secrets/Secrets Manager).
- Backups & migration runbook: scheduled DB backups and restore instructions.

Acceptance criteria & testing guidance
--------------------------------------
- Type safety: run `npx tsc --noEmit` before opening PRs.
- Unit tests: use Vitest/Jest for business logic and adapter contract tests.
- Integration/E2E: use playwright or scripts to simulate inbound messages and payment flows.
- Performance: run a light load test for reminder bursts to validate worker scaling.

Developer checklist for PRs
--------------------------
- Include unit tests and at least one integration test for critical flows.
- Add or update migration files when schema changes.
- Run `npx tsc --noEmit` and ensure CI passes typechecks.
- Provide a short testing plan in PR description to reproduce feature.

Initial tasks (today / next commit)
----------------------------------
1. Add SQL migrations and seed data for `tenants`, `users`, `reservations`, `messages`, `transactions`.
2. Create `/api/webhooks/evolution` endpoint with signature verification and persistence.
3. Scaffold payments webhook handler and empty adapter implementation.
4. Add `src/lib/dialogManager.ts` skeleton and Redis session store wiring.

Commands & local dev quickstart
-------------------------------
- Install dependencies:  
```powershell
npm install
```
- Type-check:  
```powershell
npx tsc --noEmit
```
- Run dev server (Next.js):  
```powershell
npm run dev
```
- Run unit tests:  
```powershell
npx vitest
```

Risks & mitigations (developer focus)
-------------------------------------
- Risk: high LLM cost during development — mitigation: implement and test with local paraphraser emulator and set low quotas in dev/test envs.
- Risk: provider webhooks flaky — mitigation: create robust replay tooling and idempotent handlers.
- Risk: multi-tenant data leaks — mitigation: strict RLS policies and contract tests for access patterns.

Owner suggestions & roles
-------------------------
- Tech lead / architect: design booking engine and event contracts.
- Backend: data model, webhooks, workers, payments.
- Frontend: admin console, realtime dashboard, module install UX.
- DevOps: CI, secrets, backups, deployment.

Next steps
----------
- Create issue/epic cards from the above stories and prioritize Sprint 0/1.
- Assign owners and add acceptance tests per story.
- Start with the initial tasks listed above and open small PRs for review.

---

This file is a living developer roadmap. Update it as epics are completed or priorities shift during pilot.
