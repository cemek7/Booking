# Concierge Onboarding Runbook — Launch Test Salon

**Audience:** the operator onboarding the first real (beauty vertical) salon for the 30-day launch.
**Goal:** the salon runs the full loop live — inbound WhatsApp → booking → Paystack deposit →
reminder → no-show recovery → rebooking — with one real ₦-denominated deposit completed.
**Rail:** Paystack only. **Channel:** WhatsApp only (Instagram deferred).

This is high-touch by design. SMBs do not self-serve a front desk; concierge setup is both the
onboarding mechanism and the first retention lever.

## Pre-flight (before touching the salon)

- [ ] Core-path tests green locally — see `docs/runbooks/launch-test-triage.md`.
- [ ] `db/audits/core_path_audit.sql` run against prod and clean (no-show columns present,
      `webhook_events` unique constraint present). See `migration-collision-resolution.md`.
- [ ] Paystack live keys configured: `PAYSTACK_SECRET_KEY` (server) set; webhook endpoint
      registered in the Paystack dashboard → `https://<prod-host>/api/payments/webhook`.

## 1. Tenant + owner

- [ ] Create the `tenants` row (name, vertical = `beauty`, currency `NGN`, timezone).
- [ ] Create the owner's `tenant_users` membership (role `owner`, linked to their auth user).

## 2. WhatsApp channel

- [ ] Choose the provider (Evolution / WAHA / Meta) and provision the instance.
- [ ] Set the tenant's WhatsApp config + webhook URL so inbound messages reach
      `/api/webhooks/whatsapp/[tenantId]` (or the meta route, per provider).
- [ ] Send a test inbound message and confirm it lands in the worker queue.

## 3. Paystack settlement

- [ ] Set the tenant's `metadata.paystack_subaccount_code` (for split settlement) if used.
- [ ] Set the deposit policy: deposit percentage (or flat amount) and currency NGN.

## 4. Catalog + staff

- [ ] Load services: name, duration, price, deposit %, and `rebooking_interval_days` (powers the
      nightly rebooking nudge — set it for services with a natural repeat cycle).
- [ ] Add staff and their `staff_services` mappings.
- [ ] Set staff schedules / availability.

## 5. Policy timing

- [ ] Reminder timing (how long before `start_at` the reminder fires).
- [ ] No-show / auto-cancel window: the auto-cancel job sweeps reservations in
      `[pending, pending_approval, unconfirmed]` whose `start_at` is within the cutoff
      (`autoCancelUnconfirmedEnabled` must be ON for the tenant, default window 2h). Set to match
      the salon's policy.

## 6. Go-live smoke (the proof)

Run this end-to-end with the real salon:
- [ ] Real customer (or operator's phone) sends a WhatsApp booking request.
- [ ] AI completes a booking → reservation created.
- [ ] Deposit link issued via Paystack; pay a **real ₦100** deposit.
- [ ] Webhook marks the transaction successful and confirms the reservation (verify in dashboard).
- [ ] Reminder fires at the configured time.
- [ ] (Optional, time-permitting) leave a test booking unconfirmed past the window → confirm
      auto-cancel sweeps it to `cancelled`.
- [ ] Record the reservation id + Paystack transaction reference in the launch log.

## Week-4 buffer

Reserve the remaining days for live-fire fixes from real traffic. Any bug found gets a **failing
test first** (using the verified route-testing pattern in the payments test files), then a fix.
