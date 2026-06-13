# Tenant Off-boarding — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design) — pending implementation plan
**Topic:** Tenant lifecycle off-boarding (leaving the platform)

## Problem

Today the only way for a tenant to leave is `DELETE /api/tenants/[tenantId]` — an
irreversible hard cascade delete that:

- has no soft-delete, grace period, or recovery,
- does **no data export** before destroying everything,
- does **no billing/subscription teardown** (tenant can keep being charged; Paystack
  subaccount left dangling),
- tears down the WhatsApp/Evolution instance **fire-and-forget** (if it fails, the
  instance is orphaned and keeps consuming provider resources/billing),
- predates Instagram, so never revokes IG tokens,
- writes no audit trail and has no confirmation safeguard.

There is no off-boarding plan or implementation beyond this. This spec defines a proper
lifecycle.

## Decisions (locked during brainstorming)

1. **Scenarios in scope (all four):** voluntary self-serve, non-payment/involuntary,
   GDPR/data-erasure, superadmin-initiated.
2. **Data model:** soft-delete + grace period, with a **data export** (chats +
   transaction history + relevant records) offered on the way out.
3. **Billing at teardown:** cancel recurring billing; refund unused **cash** wallet
   balance; **AI tokens/credits are forfeited** (token→cash conversion out of scope).
4. **Financial retention:** keep **full** transaction records (with identifiers) for a
   fixed term (default 7 years), then purge. PII/operational data purges at grace-period
   end. GDPR erasure honors the financial-retention term (financial-record retention is a
   recognized lawful basis).
5. **Architecture:** Approach A — lifecycle state machine + scheduled purge worker, with
   a tracked/retryable teardown checklist (the resilience idea borrowed from an
   event-driven approach) so a failed integration revoke is retried by the nightly job
   rather than silently orphaned.

## Architecture

### Section 1 — Lifecycle state machine + schema

Additive columns on `tenants` (the existing `status` flag — active/suspended/inactive —
stays; lifecycle is a separate, explicit axis):

```
tenants.lifecycle_state    TEXT NOT NULL DEFAULT 'active'
  -- active → scheduled_for_deletion → purging → purged
tenants.offboarding_reason TEXT          -- 'voluntary' | 'non_payment' | 'gdpr_erasure' | 'superadmin'
tenants.offboarded_by      UUID          -- user id, or sentinel for 'system'
tenants.scheduled_purge_at TIMESTAMPTZ   -- grace deadline (NULL until scheduled)
tenants.financials_purge_at TIMESTAMPTZ  -- grace deadline + retention term (e.g. +7y)
tenants.offboarded_at      TIMESTAMPTZ
```

Transitions:

| From | To | Trigger |
|------|----|---------|
| `active` | `scheduled_for_deletion` | any of the 4 entry points; sets `scheduled_purge_at = now + grace` (grace=0 for GDPR), `financials_purge_at = scheduled_purge_at + retention_term` |
| `scheduled_for_deletion` | `active` | reactivation within window (owner self-serve, or superadmin) |
| `scheduled_for_deletion` | `purging` | nightly job, when `now ≥ scheduled_purge_at` **and** all non-financial teardown tasks `done`/`skipped` |
| `purging` | `purged` | operational/PII purge completes |
| `purged` | *(row deleted)* | financial-retention sweep, when `now ≥ financials_purge_at` |

Access control: the moment lifecycle leaves `active`, middleware / the unified route
handler treats the tenant as unavailable (HTTP 423/403). The signed export link remains
usable during the grace window.

### Section 2 — Data export artifact

Generated at off-boarding time (reflects state at exit), stored in a private bucket,
delivered as a signed, expiring download link (emailed to owner + shown on the
confirmation screen).

- **Contents:** reservations/bookings, customers, services, staff, transaction history,
  chat transcripts (WhatsApp + Instagram messages), tenant settings.
- **Format:** ZIP containing JSON (complete, machine-readable) + CSV (per table,
  human-readable). Chat exported as readable transcript + JSON.
- **Generation:** async (queued via the `export_data` teardown task) — chat/transaction
  volume can be large, so it must not block the request. Link valid for the grace window.

### Section 3 — Teardown checklist (`offboarding_tasks`)

One row per integration/side-effect to tear down, each independently tracked and
retryable. Replaces the fire-and-forget pattern.

```
offboarding_tasks
  id            UUID PK
  tenant_id     UUID  FK → tenants (NOT cascade-deleted by Phase 1 purge; see below)
  task_type     TEXT
  status        TEXT  -- 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'
  attempts      INT   DEFAULT 0
  max_attempts  INT   DEFAULT 5
  last_error    TEXT
  payload       JSONB -- identifiers snapshotted BEFORE purge
  created_at    TIMESTAMPTZ DEFAULT now()
  updated_at    TIMESTAMPTZ DEFAULT now()
```

Task types created when state → `scheduled_for_deletion`:

| task_type | action | notes |
|-----------|--------|-------|
| `export_data` | generate ZIP, store, email link | blocks purge until `done` |
| `cancel_billing` | cancel Stripe/Paystack recurring subscription | retry; alert superadmin if capped |
| `refund_wallet_cash` | refund cash wallet balance (tokens forfeited) | manual-payout fallback flag |
| `revoke_whatsapp` | delete Evolution/WAHA instance or Meta config | the old orphan bug |
| `revoke_instagram` | revoke IG token in `whatsapp_provider_secrets` | |
| `revoke_calendar` | revoke Google Calendar tokens | |
| `close_paystack_subaccount` | deactivate payments subaccount | |

The nightly job retries `pending`/`failed` tasks; on hitting `max_attempts` it marks
`failed` and emits an alert. `payload` snapshots identifiers (instance name, subaccount
code, IG id, token refs) **before** any purge so teardown still works afterward.

Purge gating: a tenant only advances `scheduled_for_deletion → purging` when all
non-financial teardown tasks are `done`/`skipped` **and** `scheduled_purge_at` has passed.

### Section 4 — Two-phase purge job

Runs inside `/api/cron/nightly`, guarded by `cron_locks`.

- **Phase 1 — operational purge** (at `scheduled_purge_at`): delete PII + operational
  data — customers, reservations, chats/messages, staff, services, settings,
  WhatsApp/IG conversations, leads, knowledge articles, etc. Flip `purging → purged`.
  **Keep** the `tenants` row (lifecycle=`purged`), full `transactions`, and the
  `offboarding_tasks` rows.
- **Phase 2 — financial purge** (at `financials_purge_at`): delete remaining
  `transactions`, `offboarding_tasks`, and the `tenants` row itself. The only point the
  tenant fully disappears.

Every transition writes to the existing audit-log system (who / what / when / reason).

### Section 5 — API + UI surface

| Endpoint | Who | Purpose |
|----------|-----|---------|
| `POST /api/tenants/[id]/offboard` | owner | self-serve leave; body `{reason, confirmText}` — must type tenant name to confirm |
| `POST /api/tenants/[id]/reactivate` | owner / superadmin | undo within grace window |
| `GET /api/tenants/[id]/export` | owner (signed) | fetch export artifact |
| `PATCH /api/superadmin/tenants/[id]` | superadmin | extend existing PATCH to drive non_payment / superadmin / gdpr_erasure entry |

`DELETE /api/tenants/[id]` is repurposed to enter the off-boarding flow (no more instant
cascade), or deprecated in favor of `/offboard` — decided in the plan.

UI: a "Close account" section in tenant settings — typed-confirmation modal; clear
statement of grace length, what's refunded (cash wallet), what's forfeited (tokens), and
the export download. A `scheduled_for_deletion` banner with a "Reactivate" button during
the grace window.

### Section 6 — Per-scenario wiring (one backbone)

- **Voluntary:** owner → `/offboard`, reason=`voluntary`, grace=30d, full export + cash refund.
- **Non-payment:** billing webhook/cron detects lapse → auto `scheduled_for_deletion`,
  reason=`non_payment`, grace=30d, dunning emails; reactivate on payment.
- **GDPR erasure:** superadmin → reason=`gdpr_erasure`, **grace=0** (immediate operational
  purge); financials retained for the fixed term.
- **Superadmin (abuse/ToS):** reason=`superadmin`, immediate access cut, evidence
  retained, configurable grace.

### Section 7 — Error handling & testing

- **Idempotency:** every teardown task and purge step is safe to re-run (check-then-act;
  provider calls tolerate "already gone").
- **Partial failure:** isolated per task row; one failed provider call never blocks the
  others or the export.
- **Guards:** can't purge if `export_data` not `done`; can't reactivate after `purged`;
  typed-confirmation required for voluntary.
- **Tests:** state-machine transitions (valid + invalid); each teardown task
  (success/failure/retry/cap); purge gating (won't purge early / with pending tasks);
  two-phase timing; reactivation window; GDPR grace=0; audit-log emission. Reuse the
  queue-based Supabase mock pattern from the WhatsApp v2 tests.

## Configuration (defaults; confirm in plan)

- `OFFBOARDING_GRACE_DAYS` = 30 (voluntary, non-payment)
- `FINANCIAL_RETENTION_YEARS` = 7
- Export link TTL = grace window length
- `offboarding_tasks.max_attempts` = 5

## Open items for the plan

- Whether to deprecate or repurpose the existing `DELETE` route.
- Exact billing-lapse detection for the non-payment path (webhook vs cron) — depends on
  current Stripe/Paystack subscription wiring.
- Storage bucket choice for the export artifact (Supabase Storage private bucket).
- Confirm `FINANCIAL_RETENTION_YEARS` and grace defaults with the business/legal owner.
- Verify which child tables already cascade vs need explicit purge ordering (FK audit).

## Non-goals

- Token → cash conversion.
- Cross-tenant data merge or account transfer.
- Self-serve GDPR erasure by end-customers (handled via tenant/superadmin for v1).
