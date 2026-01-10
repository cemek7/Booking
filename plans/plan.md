# Booka — Development Plan (aligned to updated PRD)

Version: 1.1
Date: 2025-11-03
Owner: TechClave Engineering

This document implements the updated PRD direction for Booka: a Beauty-first conversational booking MVP with a single multi-tenant core and pluggable vertical modules (Beauty, Hospitality, Medicine). It contains the engineering roadmap, sprint breakdowns, pilot plan (30/60/90), acceptance criteria, architecture notes, and operational controls (including AI cost-control and compliance plan).

---

## SYSTEM Reminder

- Keep iterating until the job is solved; apply minimal, safe changes and validate with type checks and tests.
- When making runtime-facing changes, prefer runtime guards over broad type relaxations to avoid regressions.
- Plan before editing and present diffs for approval when changes affect scope or behavior.

---

## Executive summary (short)

Booka is a multi-tenant, chat-first appointment and revenue-capture platform built for markets where WhatsApp is the primary customer channel. We will deliver a Beauty-first MVP (core booking + messaging + payments + Beauty module) that is horizontally extensible to Hospitality and Medicine via installable modules. Primary 90-day outcomes:

- Onboard 10 Beauty pilot merchants with concierge onboarding.
- Process ≥100 bookings across pilots and measure deposit conversion and no-show reduction.
- Instrument per-tenant LLM spend and enforce quotas/alerts to protect margins.

---


---

## SYSTEM Reminder

- keep going until the job is completely solved before ending your turn 
- if you are sure about code or files, open them do not hallucinate 
- plan thoroughly before every tool call then reflect on the outcome after
  
---


## High-level goals (preserved)

- Deliver a Beauty vertical MVP that reliably handles conversational bookings on WhatsApp, handles deposits, and surfaces an admin console for tenant settings and LLM usage.
- Keep the core multi-tenant and modular so Hospitality and Medicine modules can be installed per-tenant.
- Ensure secure data practices (RLS, audit logs), and per-tenant LLM cost controls.

---

## 30/60/90 Pilot plan (concrete)

Days 0–30 (Build & recruit)
- Deliver core booking engine (API + DB schema), messaging adapter (WhatsApp + email), payments adapter (Paystack/Stripe sandbox), and admin console minimal.
- Implement dialog manager (slot-fill FSM), small classifier & paraphraser, and a simple retrieval vector DB for freemium behavior.
- Prepare and install Beauty module manifest, templates, and intake schemas.
- Recruit 10 Beauty pilot merchants and perform concierge onboarding.

Days 30–60 (Optimize & extend)
- Add deposit flows and payment-webhook reconciliation; schedule reminders with retry fallbacks (SMS/email).
- Add staff scheduling and conflict-resolution improvements; measure deposit conversion and no-show rates and iterate templates.
- Begin light Hospitality pilot (3 merchants) with minimal templates.

Days 60–90 (Monetize & scale)
- Launch first pricing plan for pilot-exit merchants; enable per-tenant billing and usage metering.
- Run Medicine LITE trials (scheduling-only, no sensitive data) for 2–3 clinics.
- Publish 2–3 case studies and prepare for scaled onboarding.

Pilot acceptance metrics (must be met for pilot to succeed):
- 10 active Beauty merchants, ≥100 bookings across pilots.
- Deposit conversion ≥20% where deposits were enabled.
- No-show reduction ≥25% compared to baseline.
- Freemium conversation resolves ≥70% of routine booking intents without premium LLM.

---

## Scope: Core MVP + Vertical Modules

Core MVP (shared capabilities)
- Multi-tenant auth, tenant & location models, billing metadata, RBAC (owner, manager, staff, receptionist).
- Booking engine: availability, conflict detection, staff routing strategies.
- Messaging adapter: pluggable providers (WhatsApp primary, email/SMS fallback).
- Payments adapter: Paystack/Flutterwave (local), Stripe (global), deposit flows, webhooks.
- Dialog manager: slot-fill FSM, Redis session store, idempotency for booking actions.
- Freemium paraphraser + retrieval vector DB for cheap conversational feel.
- Worker queue & retry (Redis + Bull or similar) for reminders, retries, and backoff.
- Admin console: tenant settings, module install, templates, LLM usage meter, billing UI.

Vertical modules (installable per tenant)
- Beauty: intake schema (preferences, allergies), stylist routing, upsells, loyalty attachments.
- Hospitality: guest intake, dynamic availability, deposits, PMS/room/table sync.
- Medicine: patient consent, limited non-sensitive scheduling, results delivery (expiring links), compliance plan and isolation for sensitive workflows.

---

## Engineering roadmap & sprint plan (recommended)

Sprint length: 2 weeks. Focus the first 3 sprints on Beauty core flows so the MVP is usable by pilot merchants.

Sprint 0 — Prep (week 0)
- Create `plan.md` (this file), CI skeleton, `env.example` and secrets checklist, developer onboarding docs.

Sprint 1 — Booking core + messaging (weeks 1-2)
- Booking API endpoints, DB migrations (tenants, users, reservations, messages, transactions, reservation_logs, templates).
- Messaging adapter skeleton (WhatsApp/Evolution + email fallback) and incoming webhook handler.
- Simple admin console page: tenant settings and module install.

Sprint 2 — Payments + Beauty module bootstrap (weeks 3-4)
- Payments adapter (Paystack + Stripe sandbox), deposit flow, payment webhook handlers.
- Beauty module: manifest, templates, intake schema, sample templates.
- Dialog manager basics (slot fill + paraphraser integration).

Sprint 3 — Realtime + worker queue + LLM basics (weeks 5-6)
- Realtime dashboard (reservations list + calendar) using Supabase Realtime or Socket layer.
- Worker queue with Redis for reminders and retries; reminder scheduler and basic worker handlers.
- Small-model classifier + paraphraser + vector retrieval; OpenRouter premium path and per-tenant budget controls.

Sprint 4 — Stabilize booking flows & admin (weeks 7-8)
- Conflict resolution improvements, staff routing strategies, and booking idempotency.
- Admin console: LLM usage meter, tenant billing metadata, module install UX.

Sprint 5 — Pilot readiness: testing & onboarding (weeks 9-10)
- E2E tests (simulated WhatsApp -> booking -> payment -> reminders).
- Pilot scripts and concierge onboarding checklist; instrumentation dashboard for pilot metrics.

Sprint 6 — Pilot launch & monitor (weeks 11-12)
- Onboard merchants, monitor metrics, iterate on templates and heuristics.
- Prepare pricing and go-to-market playbook.

Longer-term (post-pilot)
- Add Hospitality + Medicine modules, calendar adapters (Google/Outlook), POS/PMS adapters, and scaling efforts (containers, autoscaling workers).

---

## Technical architecture (concise)

- Frontend: Next.js (App router) for Admin Console and merchant-facing pages.
- API layer: Next.js serverless endpoints / Edge Functions for webhooks and server tasks.
- Database: Postgres (Supabase) with RLS, logical tenancy via `tenant_id` and JSON metadata for vertical fields.
- Worker queue: Redis + Bull/Kue-like workers for reminders, payment reconciliation, and backoff retries.
- Messaging & Payments Adapters: pluggable provider interfaces with contract tests.
- AI stack: local classifier + small paraphraser for freemium; OpenRouter adapter for premium LLMs; vector DB (Chroma/FAISS) for retrieval.
- Observability: structured logs, Sentry, metrics (Prometheus/Grafana) and per-tenant LLM token counters.

---

## AI & cost-control design (explicit)

- Freemium UX: use a local classifier (small model) + paraphraser and retrieval to resolve routine intents without invoking premium LLM.
- Premium LLM: enabled per-tenant via feature flag and per-tenant monthly token quota. Admin console shows current spend and warnings.
- Enforcement: request-level checks in the LLM adapter that decrement the tenant's quota; if quota exhausted, fallback to paraphraser or ask for human escalation.
- Caching: paraphrase and retrieval caching layer to reduce duplicated LLM calls.

---

## Data, security, and compliance notes

- Encrypt PII at rest where required; store consent logs for messaging channels with timestamps.
- For Medicine vertical: scheduling-only initial scope; plan isolated tenancy or dedicated hosting for HIPAA-like compliance in later phases.
- RLS for tenant scoping and audit logs for booking changes and messaging history.

---

## Event contracts & tenant config (appendix)

- `booking.created` event contract (JSON) — used across workers and analytics (see PRD appendix).
- `TenantConfig` sample: modules, templates, feature flags, and form schemas (see PRD appendix).

---

## Testing & QA

- Unit tests: booking lifecycle, adapters, dialog manager state machine.
- Integration tests: webhook -> intent -> booking -> payment -> reminder flow (with mocked providers).
- Contract tests for adapter interfaces (messaging, payments).
- Pilot acceptance tests: conversation tests per tenant and instrumentation-based checks.

---

## Pilot onboarding checklist (engineering + ops)

- Pre-provision tenant rows, seed Beauty templates/forms, and set deposit rules for merchants participating in the deposit trial.
- Perform concierge onboarding and run end-to-end booking tests with each merchant.
- Monitor metrics dashboard and adjust paraphraser/heuristic thresholds based on pilot data.

---

## Acceptance criteria (mapped to PRD KPIs)

- Core: Booking flow succeeds end-to-end (WhatsApp -> booking row -> confirmation) in non-sensitive cases.
- Pilot: 10 Beauty merchants onboarded, ≥100 bookings, deposit conversion ≥20% where enabled, no-show reduction ≥25%.
- Cost control: Freemium resolves ≥70% of routine intents without premium LLM; per-tenant LLM budget enforcement in place.

---

## Risks & mitigations (updated)

- WhatsApp provider policy/cost changes — mitigate via multi-channel fallback and provider abstraction.
- High LLM costs — mitigate with paraphraser + retrieval, per-tenant quotas, and admin alerts.
- Compliance exposure in Medicine — mitigate by limiting scope to scheduling-only initially and planning isolated tenancy for full EMR integrations.

---

## Immediate next steps (actionable)

1. Freeze MVP scope: Core booking + Messaging + Payments + Beauty module basics.
2. Assign the first 3 sprints (designate owners, PRs, and backlog items) and schedule 2-week sprint cadence.
3. Implement instrumentation for LLM token usage and create the admin meter UI (Sprint 2/3 priority).
4. Recruit and schedule 10 Beauty pilot merchants for concierge onboarding (parallel ops work).

---

## Frontend Navigation & Schedule Alignment (2025-11-14)

Consensus changes applied:

- Collapsed tenant owner & staff navigation to a unified `Schedule` page combining Calendar and Reservations list (`/schedule`).
- Enhanced Calendar component with lightweight week & day layouts; retained existing props for backward compatibility.
- Added Billing placeholder route (`/billing`) deferring invoices/deposit UI until after core booking alignment.
- Documented plan to extract UI primitives into a design-system package later (`@booka/ui`)—currently in-place.
- Established direction: Booking detail side panel & composer will integrate next using these primitives.

Impact: Simplifies user focus for tenant owners, reduces navigation sprawl, sets foundation for PRD-aligned components without breaking existing imports.

---

## Change log

- v1.1 (2025-11-03): Rewrote plan to align with updated PRD — Beauty-first pilot, vertical modules, 30/60/90 pilot plan, AI cost-control, worker queue design, and revised sprint roadmap.

---

Generated by engineering assistant on 2025-11-03. Edits applied with user approval.
