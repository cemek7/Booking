# Prod Database Separation — Second Supabase Project

**Status:** Planned, not started. Execute *before* onboarding the first paying customer.
**Date:** 2026-09-08
**Owner:** ccemeka
**Related:** `db:validate` schema gate (PR #103), `verify-live-fixes.sql` (in `~/`)

---

## Why

Today **staging and prod share ONE Supabase project** (`plcilpej…`). Consequences:

- You cannot rehearse a migration on staging before it hits real customer data — they are the same database.
- The live DB has already drifted from the migrations (a recurring 500 source). Sharing makes every drift/experiment a prod risk.

This plan gives prod its own database so migrations can be tested on staging first.

## Decision (and what we rejected)

**Chosen: a second *managed* Supabase project = prod; keep `plcilpej…` as staging.**

- **Cost: $0/month now.** Supabase free plan allows **2 active projects**. Both stay free until there is revenue. Upgrade *only the prod project* to Pro ($25/mo, incl. $10 compute credit) at the first paying customer — that is when managed backups / PITR become worth paying for.
- **Do it now, while empty.** No customers = no data to migrate. Just run migrations against the fresh project. This is the cheapest this task will ever be; every day of real traffic makes it harder.
- **Zero VPS load.** Managed and off-box — does not touch the 8GB RAM budget.

**Rejected — self-hosting Supabase on the VPS:** app (build wants 4GB) + full Supabase stack (~9 containers) will choke an 8GB box (already hit this). Also owns backups/DR/patching, and is a single point of failure for a money platform. Revisit only later, as a cost play, with the DB on its own box and tested off-box backups.

**Rejected — Convex:** not Postgres → full rewrite of queries, RLS/tenant isolation, auth, storage. Throws away the multi-tenant work.

**Rejected — Neon:** is Postgres, and its branching is ideal for migration rehearsal, but it is *only* the database — no GoTrue auth, no PostgREST, no Storage, no Realtime. This app uses all four. Would require rebuilding them.

The app is architecturally welded to Supabase (`supabase-js`, `auth.users` + `tenant_users`, PostgREST, RLS multi-tenancy, Storage for media, Realtime for the calendar). That lock-in is exactly why a second Supabase project is the only cheap answer.

## Free-tier caveat + mitigation

Free projects **pause after 7 days of inactivity** (limits: 500MB DB, 1GB storage, 5GB egress). Pre-launch that is fine:

- Add a **keep-warm ping** (a scheduled GET to `https://app.techclave.cloud/api/health`) so free-tier prod does not pause. Options: a GitHub Actions `schedule` cron, or a VPS cron. Every ~3 days is enough.
- On first paying customer: flip the prod project to Pro (removes pause + raises limits). Staging can stay free.

---

## Preconditions

- [ ] Confirm there are still **no paying customers / no data worth preserving** in `plcilpej…`. If any real data exists, add a data-migration step (currently assumed empty).
- [ ] Have the Supabase account login and access to DNS for `app.techclave.cloud`.
- [ ] Have SSH access to the VPS (runtime env lives there, not in CI).

## Cutover steps

> Notation: **[manual]** = only you can do it; **[claude]** = an agent can prep/verify.

### 1. Create the new prod project — [manual]
- Supabase dashboard → new project (same region as staging for parity). Name it clearly, e.g. `booka-prod`.
- Record: Project URL, `anon` key, `service_role` key, and the **Postgres connection string** (Project Settings → Database → Connection string — direct + pooled). Keep these secret.

### 2. Run migrations against the new project — [manual, claude can stage the command list]
- Migrations are applied **by hand** (per repo norms — never run against the real DB from an agent).
- **Two dirs, both required, in order:** `db/migrations/` (88 files) then `supabase/migrations/` (27 files) — confirm the intended apply order against `db/README.md`; some `supabase/migrations` may predate `db/migrations`. Apply with `psql "<new-prod-connection-string>" -f <file>` for each, or the repo's existing apply tooling.
- Seeds are **sample data** (`db/seeds/seed_sample.sql`, `products_catalog_sample.sql`) — do **not** seed prod with samples. Seed only genuinely-required config (see step 4).

### 3. Validate the new schema — [claude, run by user due to prod-read guardrail]
```bash
cd /home/ccemeka/Techclave/Booking/Booking
SUPABASE_URL="<new-prod-url>" SUPABASE_SERVICE_ROLE_KEY="<new-prod-service-role>" \
  node scripts/validate-schema.js
```
Expect `✅ Schema validation PASSED`. Any `❌` = a migration missing from step 2 → fix before proceeding.

### 4. Recreate what migrations do NOT create — [manual]
A fresh project is empty beyond the migrated tables. Recreate:
- **Auth users:** `auth.users` starts empty. Create the superadmin/owner accounts you need (dashboard → Auth, or your signup flow), and their matching `public.tenant_users` rows.
- **Storage buckets + policies:** buckets are **not defined in migrations** (dashboard-created). Recreate every bucket the app writes to (WhatsApp media handler, avatars, etc.) with matching RLS/storage policies. Cross-check against the existing staging project's Storage settings.
- **Realtime:** confirm the `postgres_changes` publication covers the tables the app subscribes to (e.g. `reservations` for the calendar). Verify a realtime subscription fires.
- **Any per-project secrets/config** the app reads from the DB (e.g. `whatsapp_provider_secrets`) — none needed until a tenant connects.

### 5. Repoint prod runtime env — [manual]
- Runtime env is on the **VPS**, injected via `deployment/docker-compose.production.yml` / `docker-compose.vps.yml` from `deployment/env/.env.production` (template: `deployment/env/.env.production.example`). **CI does not hold these** — `deploy-vps.yml` only builds/pushes the image.
- On the VPS, update `.env.production`: set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, anon key, and `SUPABASE_SERVICE_ROLE_KEY` to the **new prod** project. Leave staging's env pointed at `plcilpej…`.
- Redeploy prod (pull `production-latest` image, `docker compose … up -d`, or the repo's `deployment/scripts/deploy-vps.sh` / `booka-deploy.sh`).

### 6. Verify prod end-to-end — [claude prep, user runs]
- `curl -s https://app.techclave.cloud/api/health` → 200.
- `curl -s https://app.techclave.cloud/api/version` → commit matches the deployed image.
- Log in as the superadmin created in step 4; load the tenant dashboard and calendar (exercises auth + RLS + realtime).
- Synthetic checks for the two recent fixes (this also finally closes the #2 behavior verification): send one WhatsApp media message to a connected tenant number, trigger one service-context event, then run `~/verify-live-fixes.sql` against the **new prod** project — expect non-zero `event_outbox` and `messages.media_url`.

### 7. Keep-warm — [claude can build, user enables]
- Add a scheduled ping to `/api/health` (GitHub Actions `schedule`, every ~3 days) so free-tier prod does not pause. Remove/relax once prod is on Pro.

### 8. Record the new topology — [claude]
- Update the memory note (`project_boka_booking_platform.md`) and any deploy docs: prod = `booka-prod`, staging = `plcilpej…`; they are now separate DBs; migrations rehearse on staging first.

## Rollback

Prod's old data lived in `plcilpej…` and is untouched by this cutover. To roll back: revert `.env.production` on the VPS to the `plcilpej…` values and redeploy. No data loss (the shared project is unchanged). Keep the new project until the cutover is confirmed stable, then it simply becomes the sole prod DB.

## Upgrade trigger (later)

At first paying customer: upgrade the **prod** project to Pro ($25/mo) for managed backups/PITR and to remove the inactivity pause and raise limits. Re-evaluate whether staging needs anything beyond free at that point.

## New workflow this unlocks

Migrations get written and applied to **staging** (`plcilpej…`) first, exercised there, then applied to **prod** (`booka-prod`) only once validated — with `npm run db:validate` run against each as the gate.
