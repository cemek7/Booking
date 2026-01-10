# Product Requirements Document — **Booka: Verticalized Conversational Booking Platform**

*(Founder's brief: concise, decisive, built-for-scale — no fluff. This PRD captures scope, success metrics, architecture, rollout, and pilot plan for Beauty, Hospitality, and Medicine verticals with a single multi-tenant core and pluggable vertical modules.)*

---

# 1 — Executive summary

Booka is a multi-tenant, chat-first appointment, engagement, and revenue-capture platform built for markets where WhatsApp is the primary customer channel. The product delivers a conversational freemium experience (cheap local models + heuristics + retrieval) and premium LLM-powered features for power users. We ship a single core (booking, payments, messaging, scheduler, admin) and three vertical modules — Beauty, Hospitality, Medicine — that install as configurable feature bundles. Goal: prove unit economics in Beauty, then scale to Hospitality and Medicine with vertical-specific add-ons.

Primary outcomes in 90 days:

* 10 pilot merchants onboarded (Beauty first)
* Measured improvement in no-show rates and deposit conversion
* Instrumented LTV:CAC and per-tenant LLM costs

---

# 2 — Problem & opportunity

* SMBs in target markets rely on WhatsApp + phone calls for bookings; manual processes lead to no-shows, missed revenue, and poor data capture.
* Existing scheduling tools are generic and fail to integrate conversation-first UX, local payment gateways, and vertical operational workflows.
* Opportunity: provide lightweight conversational booking + deposits + reminders + vertical workflows to reduce revenue leakage and create stickiness.

Target customers (initial): independent salons & medspas (Beauty), boutique hotels and restaurants (Hospitality), private clinics & diagnostics labs (Medicine).

---

# 3 — Core value propositions

* Conversational booking via WhatsApp + email + web fallback that feels human on the free tier.
* Immediate revenue capture: deposits & payments integrated into booking flows.
* Vertical workflows: pre-built forms, consent, recall/recare, sample tracking, staff routing.
* Cost-managed AI: cheap heuristics + small paraphraser for freemium; premium LLM for complex tasks.
* Single codebase, multi-tenant with per-tenant configuration and module installs.

---

# 4 — Success metrics (KPIs)

Primary:

* Bookings per merchant / week
* Deposit conversion rate (%) for merchants using deposits
* No-show rate (%) before vs after Booka
* MRR and ARPU per merchant
* LTV:CAC ratio (target > 3 at scale)
* % sessions resolved without premium LLM

Operational:

* Average messages per booking (cost proxy)
* Support hours per merchant / month
* Premium LLM token usage per tenant and per booking

Pilot acceptance:

* 10 pilot merchants active, ≥100 total bookings, deposit conversion ≥20% where enabled, no-show reduction ≥25% (pilot average).

---

# 5 — Scope & features

## 5.1 Core MVP (shared across verticals)

* Multi-tenant auth, tenant and location models, billing metadata.
* Booking engine: availability, conflict resolution, staff routing strategies (round-robin, preferred, skill-based).
* Calendar adapters: Google/Outlook sync; basic PMS adapter.
* Messaging adapter: WhatsApp provider integration + email provider + SMS fallback. Abstract interface to switch providers.
* Payments adapter: Paystack/Flutterwave (Nigeria) + Stripe (global) with webhooks. Deposit flows & payment status.
* Template & form service: store channel templates; admin editor (WYSIWYG + token previews).
* Dialog manager for conversational flows (slot-fill FSM, Redis session store).
* Small-model paraphraser + retrieval vector DB for freemium conversational feel.
* Worker queue & retry logic for reminders, fallbacks.
* Admin console: tenant settings, templates, module installs, billing info, LLM usage meter.
* Audit & consent logs, opt-in/out management.
* Basic analytics dashboard (bookings, deposits, no-shows, messages).

## 5.2 Vertical modules (installable per tenant)

Each module bundles templates, JSON-schema for intake, workflows, reports, and optional integrations.

### Beauty

* Intake: client preferences, stylist notes, allergy flags.
* Workflows: stylist assignment, package upsells, retail product attachments, tips capture.
* Features: before/after gallery, appointment rebooking encouragement, loyalty credits.
* KPIs: bookings/stylist/week, add-on attach rate, tip capture rate.

### Hospitality

* Intake: guest info, special requests, group booking.
* Workflows: dynamic availability, pre-arrival messages, deposit for reservation, upsell packages (birthday, breakfast).
* Integrations: basic PMS sync, room/table allocation.
* KPIs: ADR lift via upsells, no-show % for reservations.

### Medicine

* Intake: patient consent, limited medical history (non-sensitive), sample pickup scheduling.
* Workflows: secure results delivery (expiring links), follow-up/recall scheduling, appointment triage (non-diagnostic via bot).
* Compliance: audit logs, data retention settings; initial focus on scheduling & non-sensitive comms; plan for isolated tenancy for full EMR integrations.
* KPIs: test turnaround, results delivered digitally %, patient follow-up rate.

---

# 6 — User journeys (high-level)

## Booking via WhatsApp — standard flow

1. Customer messages WhatsApp.
2. Preprocessor normalizes text and extracts entities.
3. Intent classifier routes to dialog manager.
4. Dialog manager performs slot-fill (one micro-turn per slot).
5. System suggests available slots from Booking Engine.
6. If deposit required: Payment Adapter sends payment link; webhook updates booking.
7. Messaging Adapter sends confirmation (WhatsApp + email receipt).
8. Worker schedules reminders; triggers fallback via SMS if necessary.

## Admin onboarding (concierge-first)

1. Merchant signs up; chooses vertical module.
2. Setup wizard installs templates, sample forms, deposit rule.
3. Founder/CS does guided onboarding: define services, staff, working hours, PSP connect.
4. First booking test and go-live.

---

# 7 — Technical architecture overview

* Single repo monolith initially (modular packages), containerized services for scale.
* Core services:

  * API Gateway / Edge (Next.js serverless or FastAPI)
  * Auth & Tenant Service (Postgres + Supabase patterns)
  * Booking Engine (Postgres, optimistic locking, idempotency)
  * Worker Queue (Redis + Bull/Sidekiq-like)
  * Messaging Adapter (pluggable providers)
  * Payments Adapter (PSP connectors)
  * AI Engine: classifier + dialog manager + paraphraser + retrieval (Chroma/FAISS)
  * Template & Form Service (JSON Schema storage + safe renderer)
  * Admin Console (Next.js)
  * Analytics & Logs (Prometheus + Grafana + structured logs)
* Data model: tenant_id scoping; metadata_json fields for vertical-specific fields.
* Event bus: structured events (booking.created, booking.confirmed, booking.noshow, payment.succeeded) published to worker consumers.

---

# 8 — AI & cost control design

* **Freemium conversational UX**: rule-based + small classifier (local 100M-500M model) + retrieval + small paraphraser. Cache paraphrases and reuse. Micro-turn, slot-fill conversations to feel natural.
* **Premium LLM**: behind per-tenant quota and feature flag. Escalations when classifier confidence < threshold or premium action requested.
* **Instrumentation**: per-tenant token counters, UI meters, auto-notify when nearing budget.
* **Safety**: block any attempt to transmit medical-sensitive data over WhatsApp unless tenant has opted into secure workflows and meets compliance requirements.

---

# 9 — Data & security

* Encrypt PII at rest (column-level or field-level).
* Consent records for each messaging channel with timestamps.
* Retention & purge policies per tenant.
* Role-based access: owner, manager, receptionist, staff.
* Audit logs for booking edits and message history.
* For Medicine: plan for isolated tenant-hosting and additional compliance (HIPAA-like) in later phases.

---

# 10 — API contracts & examples

### booking.created (event)

```json
{
  "event": "booking.created",
  "version": "1.0.0",
  "timestamp": "2025-11-01T12:00:00Z",
  "payload": {
    "booking_id": "b_456",
    "tenant_id": "t_123",
    "location_id": "l_01",
    "service_id": "s_1",
    "customer": {"phone":"+2348012345678","email":"a@b.com"},
    "start":"2025-11-05T10:00:00+01:00",
    "status":"requested",
    "metadata": {}
  }
}
```

### TenantConfig (sample)

```json
{
  "tenant_id": "t_123",
  "modules": {
    "beauty_v1": { "installed": true, "version": "1.0.0", "config": {"deposit_pct": 20} }
  },
  "templates": {
    "booking_confirm_whatsapp": "✅ Your {service} at {merchant} is booked for {date} {time}. Reply YES to confirm."
  },
  "forms": {
    "booking_intake": { "$schema": "http://json-schema.org/draft-07/schema#", "type":"object", "properties": {"phone":{"type":"string"}}}
  },
  "feature_flags": {"ai_assistant": true, "premium_llm": false}
}
```

---

# 11 — Acceptance criteria & success conditions

* Core booking flows work across WhatsApp + email + web fallback with deposit verification via PSP webhooks.
* Admin console can install a vertical module and populate tenant templates and forms in under 10 minutes (manual onboarding excluded).
* Freemium conversation resolves >70% of routine booking intents without premium LLM.
* Pilot merchants report measurable reduction in no-shows (target ≥25%) and successful deposit capture (pilot target ≥20%).
* LLM usage is capped per tenant and never exceeds configured budget without explicit consent.

---

# 12 — Pilot plan (30/60/90 days)

## Days 0–30 (Build & recruit)

* Deliver core booking engine + messaging adapter (WhatsApp + Email) + payments adapter + admin console minimal.
* Implement dialog manager (slot-fill), small classifier + paraphraser, vector DB for retrieval.
* Prepare Beauty module manifest, templates, intake schemas.
* Recruit 10 Beauty pilot merchants; offer concierge onboarding for 1–2 months free in exchange for metrics and case studies.

KPIs: 10 merchants onboarded, 100 bookings processed, instrumentation active.

## Days 30–60 (Optimize)

* Add staff scheduling, deposits flows, reminder fallback SMS.
* Tighten heuristics, reduce manual touches, and iterate templates.
* Begin Hospitality light pilot (3 merchants) using same core + hospitality templates.

KPIs: deposit conversion rate, no-show reduction measured, support hours tracked.

## Days 60–90 (Monetize & scale)

* Launch pricing plans; start charging non-pilot tenants.
* Add Medicine LITE module pilot (3 clinics) for scheduling-only features (no sensitive data transfer).
* Publish 3 case studies from Beauty pilots and initiate reseller partnerships (POS, payment aggregators).

KPIs: first paid customers, MRR, LTV:CAC projections, premium LLM revenue funnel.

---

# 13 — Pricing strategy (testable)

* **Starter (free)** — core booking via WhatsApp + email, basic reminders, freemium conversational experience (limited paraphraser calls per day).
* **Core (paid)** — ₦5,000/mo (example) + 0.5% per booking for messaging + payments; includes deposit flow, staff scheduling, analytics, higher paraphraser allowance.
* **Vertical Pro** — ₦15,000/mo + 0.25% per booking; includes vertical module features, POS sync, priority support.
* **Premium AI** — billed usage for premium LLM; per-tenant quota with overage pricing.

Note: localize prices by market; test deposit fees vs subscription to find best ARPU.

---

# 14 — GTM & Sales

* Founder-led outreach for pilot recruitment (Beauty first). Concierge onboarding to create case studies.
* Partnerships: PSPs (Paystack, Flutterwave, Stripe), POS vendors, local trade associations.
* Marketing: webinars, WhatsApp demo sequences, local events, targeted paid social for salons.
* Resellers: small agencies + POS installers sell Booka as add-on service.

---

# 15 — Risks & mitigations

| Risk                                     | Mitigation                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| WhatsApp platform policy or cost changes | Multi-channel fallback (email, SMS, web); abstract messaging provider; maintain vendor relationships. |
| High LLM costs                           | Freemium uses classifier + paraphraser + retrieval; premium gated & metered.                          |
| Support overhead for low-tech merchants  | Concierge onboarding; self-serve templates; onboarding scripts & video guides.                        |
| Regulatory/compliance in medicine        | Start with scheduling-only flows; plan isolated tenant deployments for full compliance.               |
| Over-customization                       | Limit customization surfaces to config + templates + webhooks; charge for plugin development.         |

---

# 16 — Engineering roadmap (initial priorities)

1. Booking Engine (API + event bus)
2. Messaging Adapter (WhatsApp + Email) + Worker Queue
3. Payments Adapter + webhook handling
4. Dialog Manager (slot-fill FSM) + small classifier + paraphraser + vector DB retrieval
5. Admin Console: tenant config, module install, template editor, LLM usage meter
6. One vertical module (Beauty) end-to-end pilot
7. Integrations: Google Calendar, 1 POS/PMS adapter

---

# 17 — Testing & QA

* Unit tests for booking lifecycle and adapters.
* Contract tests for event schemas and provider adapters.
* Integration tests for end-to-end booking -> payment -> confirmation.
* Load tests for messaging bursts (simulate reminders).
* Pilot-driven QA: use pilot merchants to validate UX and edge cases before scaling.

---

# 18 — Operational & support playbook (pilot phase)

* Dedicated onboarding team (founder + 1 CS) for first 10 merchants.
* Triage flow for escalations: 1) quick fix via admin console, 2) developer patch, 3) feature backlog.
* Support KB + one-minute videos for common tasks (connect PSP, add service, test booking).
* Monitor support time per merchant; convert high-touch merchants to paid concierge plan or productize the fix.

---

# 19 — Metrics dashboard & monitoring

* Tenant-level daily metrics: bookings, deposit conversions, no-shows, messages, LLM tokens.
* Alerts: PSP failures, messaging provider outages, high LLM spend.
* Scheduled reports: weekly pilot summary for merchants; monthly investor KPIs for founders.

---

# 20 — Next steps (immediate action items)

1. Freeze scope for MVP: core booking + messaging + payments + Beauty module basics.
2. Assign engineering sprint: 2-week sprint for booking engine + messaging + worker queue.
3. Recruit 10 Beauty pilot merchants; schedule onboarding slots.
4. Build instrumentation (event capture + dashboard) before merchant onboarding.
5. Implement per-tenant LLM budget meter and paraphraser with caching.

---

# Appendix — Useful artifacts to drop into devs’ repo

* `TenantConfig` JSON sample (see section 10)
* `booking.created` event contract (see section 10)
* Module manifest example:

```json
{
  "name":"beauty_v1",
  "version":"1.0.0",
  "ui_templates":["booking_form","confirmations","reminders"],
  "data_schema":{"booking":{"properties":{"stylist":{"type":"string"}}}},
  "workflows":["deposit_required","recall_reminder"],
  "integrations":["payments","google_calendar"]
}
```

---

This PRD is a working document: implement the pilot, instrument everything, iterate based on real merchant behavior. If you want, I’ll convert the “engineering roadmap” into a sprint backlog (epics + stories) and produce the initial GraphQL/REST API spec for the Booking Engine so devs can start coding immediately. Which do you want first?

---

# LLM context manager (design note)

To make LLM calls tenant-safe and provide useful conversation context to the LLM, Booka will include a server-side LLM context-manager utility. Its responsibilities:

- Assemble tenant LLM settings (preferred model, token rates, feature flags).
- Collect the last N conversation messages for the tenant (configurable, default 20) and provide them in chronological order.
- Optionally include a short recent LLM-call history (model, tokens) for telemetry and cost-estimation.
- Ensure returned payloads are truncated / size-limited to avoid sending large payloads to LLMs.

Implementation notes:

- The context-manager runs server-side only and requires a server-side DB client (Supabase/Postgres) to fetch tenant-scoped rows.
- The context is returned as a small JSON object intended to be merged into the prompt assembly step by the LLM adapter.
- The design supports retention policies: only keep the last N messages for context and use obfuscation/removal for any PII-sensitive payloads.

This utility will be added to the repo as `src/lib/llmContextManager.ts` and referenced in the dev plan and engineering roadmap (see plan.md and dev-plan.md updates). It is designed to be small, auditable, and to enforce tenant scoping at the DB access level.
