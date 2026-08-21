# Booka Daily Operating Loop — Design

## Purpose

Make Booka the owner’s daily sales-and-front-desk operating layer. It presents the single most important item to resolve, explains why, and safely handles eligible work. It complements rather than replaces the existing dashboard, calendar, inbox, booking engine, and analytics.

Booka is a **sales and booking front desk**. The loop covers lead response, qualification, recommendations, objections, deposits, booking conversion, confirmations, follow-up, recovery, and repeat-sales opportunities.

## Scope

### Included in v1

- Owner-only loop, delivered as a prominent dashboard module.
- One primary objective and up to three supporting progress signals.
- Objective types: answer lead, qualify/recommend, recover abandoned lead, collect deposit, confirm booking, recover at-risk booking, and follow up.
- Policy-based automation through existing jobs and WhatsApp delivery.
- Audit trail, defer/dismiss, and immediate automation pause.
- Conversational, investigation-assisted onboarding.
- Tenant-level feature flag; opted-in new tenants may use the loop as home.

### Excluded from v1

- Replacing the dashboard, staff loops, procurement, benchmarking, leaderboards, healthcare/EHR functions, and microservices.
- Autonomous policy changes or customer-facing actions without owner approval.

## Experience

### Onboarding: interview → investigate → confirm → launch

Booka opens with a short conversation, not a form. The owner shares a business name and one or more sources: website, Instagram, Google listing, WhatsApp export, or price list. Booka investigates in the background and asks only for facts public sources cannot reliably answer: what customers buy/book, sales and booking hand-off rules, staff/service availability, prohibited claims/actions, escalation rules, and deposit/confirmation/follow-up policy.

Booka returns evidence-backed drafts for the business profile, services, pricing, hours, staff, sales tone, booking rules, and automation policies. The owner can answer naturally, edit, skip, and return later. Nothing is published, sent, or automated until explicitly approved.

The loop communicates readiness: “Your Front Desk is taking shape — 4 of 6 essentials ready. Next: confirm how Booka should handle deposits.” On approval, Booka presents its operating summary and marks the front desk live.

### Live daily loop

The owner sees one primary objective, such as: “₦45,000 in tomorrow’s appointments need confirmation. Ada and Fatima have not confirmed. [Let Booka handle it].” It also shows up to three quiet progress signals, for example confirmed bookings, answered enquiries, and scheduled follow-ups.

Actions: **Let Booka handle it**, **Remind me later**, and **Not relevant** with optional feedback. When there is no current work, show “Today’s front desk is clear.” New urgent work reopens the loop. The dashboard remains the reporting and exploration surface.

## Architecture

Existing booking, enquiry, payment, notification, queue, and analytics signals feed an operational evaluator. It derives explainable objective candidates, selects one primary item, and re-evaluates after every event/action. This is application modules, database records, and existing queues/jobs—not independent services.

Priority bands, in order:

1. Customer urgency: unanswered live enquiries and imminent service failures.
2. Revenue risk: unconfirmed bookings, high-intent abandoned leads, deposits, likely no-shows, and recoverable lost sales.
3. Growth: ordinary follow-up, reactivation, and repeat-booking opportunities.

Revenue is the strongest economic signal, but it never outranks an active customer waiting for a response.

## Data and contracts

- `operating_loop_state`: current tenant/day state and completion mode.
- `operating_objectives`: derived candidate/action evidence, priority, expiry, status, and affected lead/booking/payment references.
- `operating_actions`: immutable proposal, execution, defer, dismiss, failure, and completion audit trail.
- `automation_policies`: owner-approved eligibility rules and quiet hours.
- `onboarding_evidence`: source, extracted fields, confidence, edits, and approval status.

API boundaries: `GET /api/operating-loop`; execute/defer/dismiss an objective; `GET/PUT /api/automation-policies`; and investigate/read/approve onboarding drafts. All routes are tenant-scoped and owner-authorized. Execute re-checks objective freshness and policy server-side.

## Automation and safety

- Only actions covered by active owner-approved policy may auto-send.
- Require approval for refunds, pricing exceptions, complaints, sensitive requests, bespoke/high-value sales, or anything outside a policy.
- Deduplicate by tenant, action type, target, and active time window.
- Respect consent, channel limits, quiet hours, existing retry behavior, and a tenant-level immediate automation pause.
- Completed sends remain auditable. Dismissal never deletes a lead or booking. Repeated dismissals may suggest a policy change but never alter it.

## Rollout and success measures

- Tenant-level feature flag; existing owners first see a dashboard module.
- New opted-in tenants may land on the loop, with dashboard always one click away.
- Track onboarding completion/time-to-first-value, objective completion, action success/failure, dismissals, lead response time, sales conversion, deposit collection, confirmation rate, no-show reduction, recovered revenue, and owner retention.

## Acceptance criteria

1. New tenants see a concrete conversational readiness objective, never an empty dashboard.
2. Objectives preserve evidence, affected records, risk score, and expiry.
3. An approved routine action executes once through existing delivery infrastructure, writes an audit record, and recalculates the loop.
4. Sensitive or out-of-policy work cannot auto-send.
5. A cleared loop reopens for new urgent work.
6. Non-owners cannot execute actions or alter policies.
7. The dashboard remains available and operational during rollout.
