# Booka — Missing-Tables Migration & Staging Deploy — Handoff

**Date:** 2026-07-26 · **Branch:** `staging` · **Status:** ✅ Migration applied + deployed to staging, `/api/ready` all-green. One manual verification (real booking) open.

---

## TL;DR

Goal: launch **Booka** (multi-tenant booking SaaS, `https://staging.app.techclave.cloud`) by fixing schema-drift "ghost table" errors before go-live. The DB was missing ~33 tables the code expected. This session shipped a 31-table migration + RLS, corrected the identity model, deployed it, and confirmed `/api/ready` is green. Remaining: one real end-to-end booking through the UI.

---

## Hard constraints from the user (MUST honor)

- **Never run opaque things on their VPS/DB** — show reviewable plaintext SQL/code first; **never apply migrations to their DB yourself** — they review and run.
- **Test locally before pushing to staging** (typecheck + tests) — "so we dont keep going in cycles."
- **RLS is required** on migrations.
- **No ghost tables** — queries must hit real, existing tables.

---

## Identity model (settled this session)

Booka has **no `public.users` or `public.profiles` table**. Two layers:

| Layer | Table | Schema | Written by | When populated |
|---|---|---|---|---|
| Auth ("who are you?") | `auth.users` | `auth` | Supabase Auth (never you) | Magic-link request — `signInWithOtp` creates row; `exchangeCodeForSession` (`src/app/api/auth/callback/route.ts:264`) verifies |
| Authz ("what/where?") | `public.tenant_users` | `public` | Your code | First owner at onboarding via service-role (`src/app/api/onboarding/tenant/route.ts:69-77`); others via invites + staff routes |

- One human = **one** `auth.users` row, **many** `tenant_users` rows (one per tenant).
- `tenant_users` carries `tenant_id, user_id, role (default 'staff'), email, name, phone`. Roles: superadmin(0)/owner(1)/manager(2)/staff(3).
- Auth flow (`src/lib/auth/api-request.ts:22-35`): validate JWT vs `auth.users` → trusted `user.id` → look up `tenant_users` → match `x-tenant-id`.
- `public.users` would duplicate `auth.users` → that's why it was removed.
- **Stale doc:** `CLAUDE.md` "### Database" still lists `users` — not fixed, low priority.

---

## Migration: `db/migrations/2026-07-24_missing_tables.sql`

**31 tables**, all `CREATE TABLE IF NOT EXISTS`, 496 lines, applied by user in Supabase SQL editor (success).

- **AI usage/billing:** llm_usage, llm_quotas, llm_usage_alerts, llm_alert_notifications
- **Per-staff scheduling:** staff_availability, provider_schedule, provider_services, staff_schedule_overrides, staff_locations
- **Booking core:** business_hours, reservation_locks
- **WhatsApp:** whatsapp_messages
- **Notifications/config:** in_app_notifications, tenant_settings, user_preferences, usage_daily
- **Fraud:** fraud_assessments, suspicious_activities, flagged_devices
- **Analytics/recs/commerce:** booking_analytics, customer_profiles, service_products, service_pricing_history, booking_items
- **Integrations/misc:** calendar_blocks, tenant_webhooks, automation_rules, items
- **Platform:** modules, superadmin_audit_log, event_processing_log

**RLS (idempotent — `DROP POLICY IF EXISTS` before each `CREATE POLICY`):**
- 28 tenant-scoped tables → `tenant_isolation`: `USING (tenant_id IN (SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()))`
- modules / superadmin_audit_log / event_processing_log → RLS on, **no policy** = service-role-only
- **service_role bypasses RLS**, so server writes are unaffected; RLS only gates authenticated direct access

**Skipped deliberately:** `templates` (AI replaces canned replies); telemetry `traces`/`error_logs`/`alert_events`/`business_metrics`/`system_metrics` (PostHog + Sentry cover those).

**`-- review` tables** (columns inferred from code, not a live insert): `automation_rules`, `customer_profiles` — create fine, eyeball columns before relying on them.

**Validated** pre-delivery in a throwaway `postgres:16-alpine` container (stub `auth.uid()`, `tenants`, `tenant_users`): 31 tables, 28 policies, no users/profiles.

---

## Code changes (commit `a57e755`)

| File | Was | Now |
|---|---|---|
| `src/lib/llmAlertService.ts` | `.from('profiles')` (owner contact) | `.from('tenant_users').eq('role','owner')` → email, phone |
| `src/app/api/ready/route.ts:120` | `.from('users').select('id')` | `.from('tenant_users').select('user_id')` |
| `src/app/api/auth/finish/route.ts` | upsert `public.users` mirror | block removed; returns `{success, userId, email}` |

No direct unit tests for these three. Verified: `typecheck:ci` 0 errors; `auth-handler` 12/12; full jest passed in CI.

---

## Shipped, in order

1. User applied migration in Supabase → success.
2. Local gate: `NODE_OPTIONS="--max-old-space-size=6144" npm run typecheck:ci` → 0 errors; `jest --testPathPatterns auth-handler` → 12/12.
3. Commit `a57e755` (3 code files + migration) on `staging`; `git push origin staging`.
4. CI "VPS Deploy" run `30106449284` → success (typecheck + full jest + Docker build/push to `ghcr.io/cemek7/booking:staging-latest`). Does NOT auto-deploy.
5. VPS: `sudo bash /tmp/booka-deploy.sh deploy` → image `sha256:9d75d34b9a7b` up & healthy; rollback point `f23b26d117b8` saved.
6. Smoke: `/api/ready` → `status: ready`, `database_migrations: true` (was false), all checks green, `failed: []`, `warnings: []`.

---

## Deploy / ops reference

- **Image:** `ghcr.io/cemek7/booking:staging-latest`
- **VPS:** stack `/opt/techclave/staging`; containers `booka-staging-app` (127.0.0.1:3100→3000), `booka-staging-redis`
- **Deploy script:** `sudo bash /tmp/booka-deploy.sh {deploy|check|verify|rollback}`
- **Pipeline:** push `staging` → GH Actions builds+pushes to GHCR (no auto-deploy) → run deploy script on VPS to pull+recreate
- **Rollback:** `sudo bash /tmp/booka-deploy.sh rollback`
- **Local gate:** `npm run typecheck:ci` (needs `NODE_OPTIONS=--max-old-space-size=6144` or tsc OOMs, exit 134); jest (~1681 tests); `npx next build --webpack`

---

## OPEN — pick up here

1. **Real end-to-end booking** (only go-live gate left). Walk one booking in the UI; tail logs while clicking:
   ```bash
   docker logs -f booka-staging-app 2>&1 | grep -iE "error|relation .* does not exist|PGRST|schema cache"
   ```
   Confirm it persists (shows in dashboard) and, if AI features on, that usage metered (rows in `llm_usage`). Exercises write paths (`business_hours`, `reservation_locks`, `usage_daily`, metering) the readiness probe doesn't cover.
2. *Optional:* verify columns on `automation_rules`, `customer_profiles` before relying on those features.
3. *Low-priority:* remove `users` from `CLAUDE.md` "### Database" line (schema drift).
4. *Deferred:* visual polish — analytics dropdown z-index, empty states, staff/analytics tidy.

---

## Read first (next session)

- `db/migrations/2026-07-24_missing_tables.sql` — the migration (applied)
- `src/lib/auth/api-request.ts` — two-step auth resolution
- `src/app/api/auth/callback/route.ts` — magic-link callback + `classifyUser`
- `src/app/api/onboarding/tenant/route.ts` — first `tenant_users` row via service-role
- `src/app/api/ready/route.ts` — readiness probe (11 core tables)
